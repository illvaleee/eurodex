import os, sys
os.makedirs(os.environ.get('PROVE_FOTO', '/tmp/prove-foto'), exist_ok=True)
import asyncio, json, sys
from playwright.async_api import async_playwright
SH=os.environ.get('PROVE_FOTO', '/tmp/prove-foto') + '/uso-completo/'
import os; os.makedirs(SH, exist_ok=True)
CSV=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dati', 'esportazione-vecchia-app.csv')
FAIL=[]
def check(c, what):
    print(('OK  ' if c else 'NO  ')+what); 
    if not c: FAIL.append(what)

CONTRAST_JS = r"""
() => {
  function rgb(s){ const m = s.match(/rgba?\(([^)]+)\)/); if(!m) return null; const p=m[1].split(',').map(x=>parseFloat(x)); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
  function lum(c){ const f=v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function bgOf(el){ let e=el; while(e){ const c=rgb(getComputedStyle(e).backgroundColor); if(c && c.a>0.5) return c; e=e.parentElement; } return rgb(getComputedStyle(document.body).backgroundColor)||{r:255,g:255,b:255,a:1}; }
  const bad=[];
  const els=[...document.querySelectorAll('button, a, span, b, div, dt, dd, td, th, label, h2, h3, p, summary, small, em, i')].filter(e=>{ const r=e.getBoundingClientRect(); if(r.width<2||r.height<2) return false; if(r.bottom<0||r.top>innerHeight) return false; const t=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).length; return t>0; });
  for (const e of els){ const cs=getComputedStyle(e); if(cs.visibility==='hidden'||+cs.opacity<0.3) continue; const fg=rgb(cs.color); if(!fg) continue; const bg=bgOf(e); const L1=lum(fg),L2=lum(bg); const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); if(ratio<2.6) bad.push((e.className||e.tagName)+' «'+e.textContent.trim().slice(0,30)+'» '+ratio.toFixed(2)); }
  // pulsanti senza sfondo né bordo (sembrano testo)
  const flat=[...document.querySelectorAll('.btn')].filter(b=>{const r=b.getBoundingClientRect(); if(r.width<2) return false; const cs=getComputedStyle(b); const c=rgb(cs.backgroundColor); return (!c||c.a<0.05) && !b.classList.contains('ghost');}).map(b=>b.textContent.trim().slice(0,30));
  return {bad:[...new Set(bad)].slice(0,15), flat};
}
"""

async def pick(pg, sel, value):
    # tocca il pulsante del menu e poi la voce con quel valore
    idx = await pg.evaluate("""([sel, v]) => { const s = document.querySelector(sel); return [...s.options].findIndex(o => o.value === v); }""", [sel, value])
    assert idx >= 0, f'voce {value} non trovata in {sel}'
    await pg.evaluate("(sel) => document.querySelector(sel).nextElementSibling.click()", sel)
    await pg.wait_for_selector('.pklist', state='visible'); await pg.wait_for_timeout(300)
    await pg.click(f'.pklist button[data-i="{idx}"]'); await pg.wait_for_timeout(450)

async def run(scheme):
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, color_scheme=scheme, has_touch=False, accept_downloads=True)
        pg=await ctx.new_page()
        errs=[]
        pg.on('pageerror', lambda e: errs.append('PAGE '+str(e)))
        # l'interruttore del muro (config/accesso) si legge dal server vero: finché le regole nuove non sono
        # pubblicate risponde 403, poi 404 finché Valerio non lo tocca. L'app va avanti lo stesso (muro spento)
        interruttore = lambda m: 'firestore.googleapis.com' in ((m.location or {}).get('url') or '')
        pg.on('console', lambda m: errs.append('CONSOLE '+m.text)
              if m.type == 'error' and '404' not in m.text and not interruttore(m) else None)
        n=[0]
        async def shot(name):
            n[0]+=1; await pg.screenshot(path=f'{SH}{scheme}_{n[0]:02d}_{name}.png')
            r=await pg.evaluate(CONTRAST_JS)
            if r['bad']: print(f'   contrasto basso in {name}:', r['bad'][:6])
            if r['flat']: print(f'   pulsanti senza sfondo in {name}:', r['flat'][:6]); FAIL.append(f'{scheme}: pulsanti senza sfondo in {name}')
        await pg.goto('http://localhost:8791/index.html'); await pg.wait_for_selector('.hero')
        # primo avvio: compare il benvenuto (dopo l'animazione), con i consigli e l'importazione
        await pg.wait_for_selector('.welc', timeout=8000); await shot('benvenuto')
        check('Importa la collezione' in await pg.inner_text('.welc'), 'primo avvio: benvenuto con importazione dalla vecchia app')
        await pg.click('.welc >> text=Inizia'); await pg.wait_for_timeout(500)
        check(not await pg.evaluate("document.body.classList.contains('open-sheet')"), 'il benvenuto si chiude con "Inizia"')
        await shot('home_vuota')
        # importazione CSV
        await pg.click('[data-act=settings]'); await pg.wait_for_timeout(300); await shot('impostazioni')
        await pg.set_input_files('#csvfile', CSV); await pg.wait_for_timeout(1500); await shot('importazione')
        txt=await pg.inner_text('#sheetbody'); check('2.122' in txt or '2122' in txt, f'{scheme}: importazione riepilogo')
        owned=await pg.evaluate('__eurodex.possedute.size'); check(owned==2121, f'{scheme}: dopo importazione 2121 monete (trovate {owned})')
        await pg.click('.sheet [data-act=close]'); await pg.wait_for_timeout(300)
        await shot('home_piena')
        # persistenza
        await pg.reload(); await pg.wait_for_selector('.hero'); owned2=await pg.evaluate('__eurodex.possedute.size'); check(owned2==owned, f'{scheme}: la collezione resta dopo il riavvio')
        # catalogo: paesi, mappa, anni, tagli, comm
        await pg.click('[data-act=tab][data-tab=cat]'); await pg.wait_for_timeout(200); await shot('cat_paesi')
        await pg.click('[data-act=pmap][data-v="1"]'); await pg.wait_for_timeout(300); await shot('cat_mappa')
        fills=await pg.evaluate("[...document.querySelectorAll('[data-mapcc]')].map(e=>e.style.fill).filter(Boolean).length"); check(fills>=25, f'{scheme}: mappa colorata ({fills})')
        await pg.click('[data-act=pmap][data-v="0"]')
        await pg.click('[data-act=catmode][data-v=anni]'); await pg.wait_for_timeout(200); await shot('cat_anni')
        await pg.click('[data-act=go][data-v=year][data-y="2012"]'); await pg.wait_for_timeout(400); await shot('anno_2012')
        await pg.click('[data-act=album][data-v="1"]'); await pg.wait_for_timeout(400); await shot('anno_2012_album')
        await pg.click('[data-act=album][data-v="0"]'); await pg.click('[data-act=back]')
        await pg.click('[data-act=catmode][data-v=tagli]'); await pg.wait_for_timeout(200); await shot('cat_tagli')
        await pg.click('[data-act=go][data-v=denom][data-d="2e"]'); await pg.wait_for_timeout(400); await shot('taglio_2e')
        await pg.click('[data-act=back]'); await pg.click('[data-act=catmode][data-v=comm]'); await pg.wait_for_timeout(600); await shot('cat_comm')
        await pg.click('[data-act=catmode][data-v=paesi]'); await pg.click('[data-act=go][data-v=country][data-cc=FI]'); await pg.wait_for_timeout(400); await shot('finlandia')
        await pg.click('[data-act=mode][data-mode=anno]'); await pg.wait_for_timeout(300); await shot('finlandia_anni')
        await pg.click('[data-act=mode][data-mode=taglio]')
        # scheda moneta con dati completi
        await pg.click('.tcard [data-detail]'); await pg.wait_for_timeout(1500); await shot('scheda_fi')
        note=await pg.inner_text('#sheetbody'); check('non pubblica la foto' in note or 'Tocca una moneta' in note, f'{scheme}: nota sulla foto della scheda')
        await pg.fill('[data-note]', 'prova nota'); await pg.wait_for_timeout(600)
        await pg.click('.starbtn'); await pg.wait_for_timeout(200)
        await pg.evaluate("document.querySelector('.sheet .in').scrollTop=99999"); await pg.wait_for_timeout(200); await shot('scheda_fi_fondo')
        await pg.click('.sheet [data-act=close]')
        # zoom
        await pg.click('[data-act=back]'); await pg.click('[data-act=go][data-v=country][data-cc=IT]'); await pg.wait_for_timeout(300)
        await pg.click('.tcard [data-detail]'); await pg.wait_for_timeout(1200)
        await pg.click('[data-act=zoom][data-side=nat]'); await pg.wait_for_timeout(300); await shot('zoom')
        await pg.click('[data-act=zflip]'); await pg.wait_for_timeout(200); await pg.click('[data-act=zclose]'); await pg.click('.sheet [data-act=close]')
        # chip, annulla
        before=await pg.evaluate('__eurodex.possedute.size')
        cards=await pg.query_selector_all('[data-toggle]'); await cards[1].click(); await pg.wait_for_timeout(200)
        chip=await pg.query_selector('.tcard.open .chip:not(.on)'); await chip.click(); await pg.wait_for_timeout(200)
        check(await pg.evaluate('__eurodex.possedute.size')==before+1, f'{scheme}: toccare un pezzo lo segna')
        await pg.click('#tundo'); await pg.wait_for_timeout(200)
        check(await pg.evaluate('__eurodex.possedute.size')==before, f'{scheme}: Annulla toglie la modifica')
        # pressione lunga su una scheda
        el=await pg.query_selector('.tcard .thead'); bb=await el.bounding_box()
        await pg.mouse.move(bb['x']+bb['width']-40, bb['y']+20); await pg.mouse.down(); await pg.wait_for_timeout(700); await pg.mouse.up(); await pg.wait_for_timeout(300)
        await shot('pressione_lunga')
        await pg.click('[data-act=lpall][data-v="1"]'); await pg.wait_for_timeout(300)
        after=await pg.evaluate('__eurodex.possedute.size'); check(after>before, f'{scheme}: "Segna tutte" con pressione lunga')
        await pg.click('#tundo'); await pg.wait_for_timeout(200); check(await pg.evaluate('__eurodex.possedute.size')==before, f'{scheme}: Annulla dopo "Segna tutte"')
        # solo mancanti
        await pg.click('[data-act=onlymiss]'); await pg.wait_for_timeout(300); await shot('solo_mancanti')
        vis=await pg.evaluate("[...document.querySelectorAll('.chip.on')].length"); check(vis==0, f'{scheme}: solo mancanti nasconde le possedute ({vis})')
        await pg.click('.omnote'); await pg.wait_for_timeout(200)
        # mancanti
        await pg.click('[data-act=tab][data-tab=miss]'); await pg.wait_for_timeout(500); await shot('mancanti')
        for srt in ['anno','taglio','rari','valore']:
            await pick(pg, '[data-sort=sortMiss]', srt); await pg.wait_for_timeout(600); await shot('mancanti_'+srt)
        await pg.click('[data-act=miss][data-f=cc][data-v=IT]'); await pg.wait_for_timeout(300)
        nm=await pg.evaluate("__eurodex.mancantiFiltrate().length"); check(nm>0 and all(x for x in [True]), f'{scheme}: filtro paese nelle mancanti ({nm})')
        async with pg.expect_download() as dl: 
            await pg.click('[data-act=exportmiss]'); await pg.wait_for_timeout(200); await pg.click('[data-act=csvmiss]')
        d=await dl.value; path=await d.path(); data=open(path,encoding='utf-8-sig').read().splitlines()
        check(len(data)-1==nm and all(l.startswith('it;') for l in data[1:]), f'{scheme}: CSV mancanti con i filtri ({len(data)-1} righe)')
        await pg.click('.sheet [data-act=close]')
        # cerca
        await pg.click('[data-act=tab][data-tab=search]'); await pg.wait_for_timeout(200)
        await pick(pg, '[data-qc=cc]', 'IT'); await pick(pg, '[data-qc=y]', '2012'); await pick(pg, '[data-qc=d]', 'comm'); await pg.wait_for_timeout(200); await shot('celho')
        await pg.fill('[data-exq]', 'italia 2 euro 2012'); await pg.wait_for_timeout(1200); await shot('cerca')
        ok=await pg.evaluate("[...document.querySelectorAll('.xrow')].length>0 && [...document.querySelectorAll('.xrow .chip')].every(c=>{const p=__eurodex.pezzoPerChiave[c.dataset.key]; return p.t.cc==='IT'&&p.t.denom==='2e'&&p.y===2012})")
        check(ok, f'{scheme}: ricerca "italia 2 euro 2012" dà solo quelle monete')
        await pg.fill('[data-exq]', 'Dante'); await pg.wait_for_timeout(1500)
        nd=await pg.evaluate("document.querySelectorAll('.xrow').length"); check(nd>=3, f'{scheme}: ricerca per tema "Dante" ({nd})')
        # statistiche, storico, preferite
        await pg.click('[data-act=tab][data-tab=coll]'); await pg.wait_for_timeout(300); await shot('home_dopo')
        await pg.click('[data-act=go][data-v=stats]'); await pg.wait_for_timeout(800); await shot('statistiche')
        await pg.click('[data-act=go][data-v=hist]'); await pg.wait_for_timeout(300); await shot('storico')
        await pg.click('[data-act=back]'); await pg.click('[data-act=back]')
        fv=await pg.query_selector('[data-act=go][data-v=favs]'); check(fv is not None, f'{scheme}: le preferite compaiono nella home')
        # backup: scarica e ripristina
        await pg.click('[data-act=settings]'); await pg.wait_for_timeout(300)
        async with pg.expect_download() as dl2: await pg.click('[data-act=export]')
        d2=await dl2.value; bpath=await d2.path(); bj=json.load(open(bpath))
        check(len(bj['possedute'])==await pg.evaluate('__eurodex.possedute.size') and bj.get('note',{}).get(await pg.evaluate("Object.keys(__eurodex.note)[0]")) == 'prova nota', f'{scheme}: il file di backup contiene monete e note')
        await pg.click('[data-act=reset]'); await pg.click('[data-act=reset]'); await pg.wait_for_timeout(300)
        check(await pg.evaluate('__eurodex.possedute.size')==0, f'{scheme}: azzera la collezione')
        await pg.click('[data-act=settings]'); await pg.wait_for_timeout(300)
        await pg.set_input_files('#bkfile', bpath); await pg.wait_for_timeout(500); await shot('ripristino')
        await pg.click('[data-act=dorestore]'); await pg.wait_for_timeout(500)
        check(await pg.evaluate('__eurodex.possedute.size')==len(bj['possedute']), f'{scheme}: ripristino dal file')
        check(await pg.evaluate("__eurodex.note[Object.keys(__eurodex.note)[0]]")=='prova nota', f'{scheme}: le note tornano col ripristino')
        print(scheme, 'ERRORI JS:', errs[:5]); 
        if errs: FAIL.append(f'{scheme}: errori JS {errs[:3]}')
        await b.close()

async def main():
    await run('light'); await run('dark')
    print('\nRISULTATO:', 'TUTTO OK' if not FAIL else 'PROBLEMI: '+' | '.join(FAIL))
asyncio.run(main())
sys.exit(1 if FAIL else 0)
