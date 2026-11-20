import os, sys
os.makedirs(os.environ.get('PROVE_FOTO', '/tmp/prove-foto'), exist_ok=True)
# Prova "come una persona": si usa l'app toccando i pulsanti, e dopo ogni azione si controlla che TUTTO quello
# che si vede sia aggiornato (anche la pagina sotto una scheda appena chiusa), su più schermi e in chiaro/scuro.
import asyncio, json, sys
from playwright.async_api import async_playwright

NASCOSTI = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nascosti.js')).read()
TOCCO = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tocco.js')).read()
CONTRASTO = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'contrasto.js')).read()
cat = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www', 'data', 'catalog.json')))
IT = [t for t in cat['types'] if t['cc'] == 'IT' and len(t['p']) >= 3]
FR = [t for t in cat['types'] if t['cc'] == 'FR' and len(t['p']) >= 3]
POSS = [p[0] for t in IT[:8] for p in t['p'][:2] if not p[3]] + [p[0] for t in FR[:4] for p in t['p'][:1] if not p[3]]
ERR, NOTE = [], []
def ok(c, m):
    print(('✓ ' if c else '✗ ') + m, flush=True)
    if not c: ERR.append(m)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=1.5, reduced_motion='reduce')
        await ctx.add_init_script("if (!localStorage.getItem('collezioneEuro.v3')) localStorage.setItem('collezioneEuro.v3', JSON.stringify({app:'collezione-euro', versione:3, possedute:" + json.dumps(POSS) + ", meta:{benvenuto:1, novitaVista:999}}))")
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8791/index.html'); await pg.wait_for_timeout(2500)
        T = lambda s: pg.locator(s)
        async def tab(n): await T(f'#nav button:has-text("{n}")').click(); await pg.wait_for_timeout(500)
        async def chiudi(): await T('.backdrop').click(position={'x': 200, 'y': 40}); await pg.wait_for_timeout(500)
        async def testo(sel): return (await T(sel).first.inner_text()).strip() if await T(sel).count() else ''
        num = lambda s: int(''.join(ch for ch in s if ch.isdigit()) or -1)
        possedute = lambda: pg.evaluate("__eurodex.possedute.size")

        # ---------- PREFERITE ----------
        ok(await T('.card h3:has-text("Preferite")').count() == 0, 'Collezione: senza preferite non c\'è la sezione Preferite')
        await tab('Catalogo'); await T('[data-act="catmode"][data-v="paesi"]').click(); await pg.wait_for_timeout(300)
        await T('[data-act="go"][data-cc="IT"]').first.click(); await pg.wait_for_timeout(600)
        a, b2 = IT[0]['id'], IT[1]['id']
        for i in (a, b2):
            await T(f'#main [data-detail="{i}"]').first.click(); await pg.wait_for_timeout(600)
            await T('#sheetbody .starbtn').click(); await pg.wait_for_timeout(300)
            ok(await testo('#sheetbody .starbtn') == '★', f'scheda {i}: la stella diventa piena subito')
            await chiudi()
        await tab('Collezione')
        ok(await T('.card:has(h3:has-text("Preferite")) .hrow > *').count() == 2, 'Collezione: compaiono le 2 preferite')
        # il caso segnalato: dalla Collezione apro una preferita e tolgo la stella → chiudendo deve sparire subito
        await T('.card:has(h3:has-text("Preferite")) [data-detail]').first.click(); await pg.wait_for_timeout(600)
        await T('#sheetbody .starbtn').click(); await pg.wait_for_timeout(300); await chiudi()
        ok(await T('.card:has(h3:has-text("Preferite")) .hrow > *').count() == 1, 'Collezione: tolta la stella, chiusa la scheda la moneta sparisce SUBITO dalle preferite')
        await T('.card:has(h3:has-text("Preferite")) [data-detail]').first.click(); await pg.wait_for_timeout(600)
        await T('#sheetbody .starbtn').click(); await pg.wait_for_timeout(300); await chiudi()
        ok(await T('.card h3:has-text("Preferite")').count() == 0, 'Collezione: tolta anche l\'ultima, la sezione Preferite sparisce subito')
        # dall'elenco "Tutte"
        for i in (a, b2): await pg.evaluate(f"__eurodex.preferite.add('{i}'); __eurodex.salva()")
        await pg.evaluate("__eurodex.ridisegna()"); await T('[data-act="go"][data-v="favs"]').click(); await pg.wait_for_timeout(500)
        n0 = await T('#main [data-detail]').count()
        await T('#main .coinbtn[data-detail], #main [data-detail]').first.click(); await pg.wait_for_timeout(600)
        await T('#sheetbody .starbtn').click(); await pg.wait_for_timeout(300); await chiudi()
        ids_dopo = await pg.evaluate("[...new Set([...document.querySelectorAll('#main [data-detail]')].map(e => e.dataset.detail))]")
        ok(len(ids_dopo) == 1, f'Preferite (tutte): tolta una, l\'elenco si aggiorna subito ({ids_dopo})')
        await pg.evaluate("__eurodex.tornaIndietro()"); await pg.wait_for_timeout(400)

        # ---------- MONETE SEGNATE DA UNA SCHEDA, VISTE DALLE ALTRE PAGINE ----------
        await tab('Mancanti')
        m0 = num(await testo('[data-misscount]'))
        tid = await pg.evaluate("document.querySelector('#main .mrow [data-detail]').dataset.detail")
        await T('#main .mrow [data-detail]').first.click(); await pg.wait_for_timeout(600)
        k = await pg.evaluate("[...document.querySelectorAll('#sheetbody [data-key]')].find(e => !e.classList.contains('on')).dataset.key")
        await T(f'#sheetbody [data-key="{k}"]').click(); await pg.wait_for_timeout(300)
        ok(await pg.evaluate(f"document.querySelector('#sheetbody [data-key=\"{k}\"]').classList.contains('on')"), 'scheda: il pezzo toccato diventa "ce l\'ho" subito')
        await chiudi()
        m1 = num(await testo('[data-misscount]'))
        ok(m1 == m0 - 1, f'Mancanti: chiusa la scheda il numero scende di 1 ({m0} → {m1})')
        ok(await T(f'#main [data-key="{k}"]').count() == 0, 'Mancanti: il pezzo segnato dalla scheda non è più in elenco')
        await tab('Le mie')
        ok(await T(f'#main [data-key="{k}"].on').count() == 1, 'Le mie: il pezzo segnato c\'è')
        tot0 = num(await testo('[data-minetot]'))
        ok(tot0 == await pg.evaluate("__eurodex.pezzi.filter(p => __eurodex.possedute.has(p.key)).length"), f'Le mie: il totale in alto è giusto ({tot0})')
        # tocco sul posto in "Le mie": il pezzo resta (per poterlo rimettere) ma i numeri scendono subito
        await T(f'#main [data-key="{k}"]').click(); await pg.wait_for_timeout(400)
        tot1 = num(await testo('[data-minetot]'))
        ok(tot1 == tot0 - 1, f'Le mie: tolto un pezzo, il totale in alto scende subito ({tot0} → {tot1})')
        ok(await T('#toast.show.act').count() == 1, 'Le mie: compare "Annulla"')
        await T('#tundo').click(); await pg.wait_for_timeout(400)
        ok(num(await testo('[data-minetot]')) == tot0, 'Le mie: "Annulla" rimette il pezzo e il totale')
        # in Mancanti, segnato sul posto: il numero in alto scende subito
        await tab('Mancanti'); m2 = num(await testo('[data-misscount]'))
        kk = await pg.evaluate("[...document.querySelectorAll('#main [data-key]')].find(e => !e.classList.contains('on')).dataset.key")
        await T(f'#main [data-key="{kk}"]').click(); await pg.wait_for_timeout(400)
        ok(num(await testo('[data-misscount]')) == m2 - 1, 'Mancanti: segnato sul posto, il numero in alto scende subito')
        await T('#tundo').click(); await pg.wait_for_timeout(400)
        # in Collezione il totale torna
        await tab('Collezione')
        ok(num(await testo('[data-scope="all"] [data-o]')) == await pg.evaluate("__eurodex.pezzi.filter(p => __eurodex.possedute.has(p.key)).length"), 'Collezione: il numero di monete è giusto dopo tutti i tocchi')

        # ---------- NOTE ----------
        await tab('Le mie'); nid = await pg.evaluate("document.querySelector('#main [data-detail]').dataset.detail")
        await T(f'#main [data-detail="{nid}"]').first.click(); await pg.wait_for_timeout(600)
        await T('#sheetbody textarea[data-note]').fill('presa a Roma'); await pg.wait_for_timeout(700); await chiudi()
        await T(f'#main [data-detail="{nid}"]').first.click(); await pg.wait_for_timeout(600)
        ok(await T('#sheetbody textarea[data-note]').input_value() == 'presa a Roma', 'nota: riaprendo la scheda la nota c\'è')
        await chiudi(); await pg.reload(); await pg.wait_for_timeout(2500)
        ok(await pg.evaluate(f"__eurodex.note['{nid}']") == 'presa a Roma', 'nota: resta anche riaprendo l\'app')

        # ---------- SCHEDA "LE MIE": raggruppamenti ----------
        await tab('Le mie')
        for modo in ('paese', 'anno', 'taglio'):
            await T(f'[data-act="minemode"][data-v="{modo}"]').click(); await pg.wait_for_timeout(400)
            await pg.evaluate("__eurodex.disegnaTutto()")
            vis = await pg.evaluate("new Set([...document.querySelectorAll('#main [data-key].on')].map(e => e.dataset.key)).size")
            attese = await pg.evaluate("__eurodex.pezzi.filter(p => __eurodex.possedute.has(p.key)).length")
            ok(vis == attese, f'Le mie per {modo}: ci sono tutte le monete che hai della serie base ({vis}) e solo quelle')
            ok(await T('#main [data-key]:not(.on)').count() == 0, f'Le mie per {modo}: nessuna moneta che manca')
        await pg.reload(); await pg.wait_for_timeout(2500); await tab('Le mie')
        ok(await T('[data-act="minemode"].on').get_attribute('data-v') == 'taglio', 'Le mie: la scelta resta riaprendo l\'app')

        # ---------- EXTRA (varianti) ----------
        n_extra = await pg.evaluate("__eurodex.tuttiPezzi.filter(p => p.extra).length")
        ok(n_extra > 80 and await pg.evaluate("__eurodex.pezzi.every(p => !p.extra)"), f'varianti: {n_extra} varianti, nessuna nella serie base (impostazione accesa di serie)')
        ok(await pg.evaluate("__eurodex.tipi.every(t => t.pieces.length > 0)"), 'varianti: ogni moneta resta con la sua serie base')
        gr = await pg.evaluate("__eurodex.tuttiPezzi.filter(p => p.t.cc === 'GR' && /lettera nella stella/.test(p.m)).map(p => p.extra)")
        ok(gr and all(gr), f'Grecia "lettera nella stella": tutte in Extra ({len(gr)})')
        ok(await pg.evaluate("__eurodex.tuttiPezzi.filter(p => p.t.cc === 'DE' && /^[ADFGJ]$/.test(p.m)).every(p => !p.extra)"), 'i segni di zecca normali (A D F G J) restano nella serie base')
        await tab('Extra')
        ok(await T('#main .mrow').count() > 0 and await T('#main [data-key]:not(.on)').count() > 0, 'Extra: c\'è l\'elenco delle varianti')
        tx0 = num(await testo('[data-extratot]'))
        kx = await pg.evaluate("document.querySelector('#main [data-key]:not(.on)').dataset.key")
        await T(f'#main [data-key="{kx}"]').click(); await pg.wait_for_timeout(400)
        ok(num(await testo('[data-extratot]')) == tx0 + 1, 'Extra: segnata una variante, il numero in alto sale subito')
        await tab('Collezione')
        ok(num(await testo('[data-scope="all"] [data-o]')) == await pg.evaluate("__eurodex.pezzi.filter(p => __eurodex.possedute.has(p.key)).length"), 'Collezione: la variante segnata non conta nella serie base')
        await tab('Extra'); await T('[data-act="extrafiltro"][data-v="mie"]').click(); await pg.wait_for_timeout(400)
        ok(await T(f'#main [data-key="{kx}"].on').count() == 1 and await T('#main [data-key]:not(.on)').count() == 0, 'Extra → Ce l\'ho: solo quelle che hai')
        await T('[data-act="extrafiltro"][data-v="mancano"]').click(); await pg.wait_for_timeout(400)
        ok(await T(f'#main [data-key="{kx}"]').count() == 0, 'Extra → Mi mancano: quella segnata non c\'è')
        await T('[data-act="extrafiltro"][data-v="tutte"]').click(); await pg.wait_for_timeout(300)
        # impostazione spenta: le varianti tornano anche in collezione
        await T('#hright [data-act="settings"]').click(); await pg.wait_for_timeout(700)
        await T('label.tgl:has([data-pref="noExtra"])').click(); await pg.wait_for_timeout(600)
        ok(await pg.evaluate("__eurodex.pezzi.some(p => p.extra) && __eurodex.pezzi.filter(p => __eurodex.possedute.has(p.key)).some(p => p.extra)"), 'impostazione spenta: le varianti contano di nuovo in collezione')
        await T('label.tgl:has([data-pref="noExtra"])').click(); await pg.wait_for_timeout(600)
        ok(await pg.evaluate("__eurodex.pezzi.every(p => !p.extra)"), 'impostazione riaccesa: di nuovo solo serie base')
        # impostazioni ridisegnate dopo un'azione fatta dentro (es. Drive collegato): restano nel punto in cui si era
        await pg.mouse.move(206, 600); await pg.mouse.wheel(0, 700); await pg.wait_for_timeout(500)
        pos0 = await pg.evaluate("document.querySelector('.sheet .in').scrollTop")
        await pg.evaluate("__eurodex.apriImpostazioni()"); await pg.wait_for_timeout(500)
        pos1 = await pg.evaluate("document.querySelector('.sheet .in').scrollTop")
        ok(pos0 > 100 and abs(pos1 - pos0) <= 2, f'impostazioni ridisegnate: restano nel punto in cui erano ({pos0} → {pos1})')
        await chiudi()
        await T('#hright [data-act="settings"]').click(); await pg.wait_for_timeout(700)
        ok(await pg.evaluate("document.querySelector('.sheet .in').scrollTop") == 0, 'impostazioni riaperte da capo: partono dall\'inizio')
        await chiudi()
        await pg.evaluate(f"__eurodex.possedute.delete('{kx}'); __eurodex.salva(); __eurodex.ridisegna()")
        # scheda di una moneta con varianti: le varianti sono in fondo, segnabili anche da lì
        gid = await pg.evaluate("__eurodex.tuttiPezzi.find(p => p.t.cc === 'GR' && /lettera nella stella/.test(p.m)).t.id")
        await pg.evaluate(f"__eurodex.apriScheda('{gid}')"); await pg.wait_for_timeout(600)
        ok(await T('#sheetbody .sec:has-text("Varianti")').count() == 1, 'scheda della moneta greca: c\'è la parte "Varianti · nella scheda Extra"')
        await chiudi()

        # ---------- CATALOGO → COMM.: griglia degli anni ----------
        await tab('Catalogo'); await T('[data-act="catmode"][data-v="comm"]').click(); await pg.wait_for_timeout(500)
        anni = await T('.ycard').count()
        ok(anni >= 20, f'Comm.: griglia con un riquadro per ogni anno ({anni})')
        y = await T('.ycard').nth(2).get_attribute('data-y')
        n_card = num(await T(f'.ycard[data-y="{y}"] .yl').first.inner_text())
        await T(f'.ycard[data-y="{y}"]').click(); await pg.wait_for_timeout(500)
        ok(await testo('#htitle') == f'Commemorativi {y}', f'Comm.: toccando {y} si apre la pagina di quell\'anno')
        righe = await pg.evaluate(f"[...document.querySelectorAll('#main [data-detail]')].map(e => __eurodex.tipoPerId[e.dataset.detail]).every(t => t.commem && t.from === {y})")
        ok(righe, f'Comm. {y}: ci sono solo le commemorative del {y}')
        kc = await pg.evaluate("document.querySelector('#main [data-key]:not(.on)').dataset.key")
        await T(f'#main [data-key="{kc}"]').click(); await pg.wait_for_timeout(300)
        await pg.evaluate("__eurodex.tornaIndietro()"); await pg.wait_for_timeout(500)
        ok(num(await T(f'.ycard[data-y="{y}"] [data-o]').inner_text()) >= 1, 'Comm.: tornando alla griglia, "possedute" di quell\'anno è aggiornato')
        await pg.evaluate(f"__eurodex.possedute.delete('{kc}'); __eurodex.salva(); __eurodex.ridisegna()")

        # ---------- "solo mancanti", proof, azzera ----------
        await tab('Collezione'); await T('#hright [data-act="onlymiss"]').click(); await pg.wait_for_timeout(400)
        ok(await T('.omnote').count() == 1, 'occhio: in Collezione compare "Stai vedendo solo le mancanti"')
        await tab('Le mie')
        ok(await T('.omnote').count() == 0 and await T('#hright [data-act="onlymiss"]').count() == 0, 'occhio: in Le mie non c\'è (lì non avrebbe senso)')
        await tab('Collezione'); await T('#hright [data-act="onlymiss"]').click(); await pg.wait_for_timeout(300)
        await T('#hright [data-act="settings"]').click(); await pg.wait_for_timeout(700)
        await T('#resetbtn').scroll_into_view_if_needed(); await T('#resetbtn').click(); await T('#resetbtn').click(); await pg.wait_for_timeout(500)
        ok(await possedute() == 0 and num(await testo('[data-scope="all"] [data-o]')) == 0, 'azzera: la collezione va a 0 e la Collezione lo mostra subito')
        await tab('Le mie')
        ok(await T('#main .empty').count() == 1, 'azzera: Le mie mostra il messaggio "qui trovi solo le monete che hai"')
        await pg.evaluate("__eurodex.avviso('x')")  # (il toast di prima è scaduto: si ripristina dal codice)
        await pg.evaluate(f"__eurodex.sostituisci(__eurodex.possedute, {json.dumps(POSS)}); __eurodex.salva(); __eurodex.ridisegna()")

        # ---------- finestre sopra la pagina: con TalkBack/tastiera si raggiunge solo quella in cima ----------
        inerti = lambda: pg.evaluate("[...document.body.children].filter(e => e.inert).map(e => e.id || e.className.split(' ')[0])")
        ok(await inerti() == [], f'nessuna finestra aperta: tutto raggiungibile ({await inerti()})')
        await pg.evaluate(f"__eurodex.apriScheda('{a}')"); await pg.wait_for_timeout(600)
        i1 = await inerti()
        ok('app' in i1 and 'tabs' in i1 and 'sheetwrap' not in i1 and 'toast' not in i1, f'scheda aperta: pagina e barra sotto non raggiungibili, "Annulla" sì ({i1})')
        await T('#sheetbody [data-act="zoom"]').first.click(); await pg.wait_for_timeout(500)
        i2 = await inerti()
        ok('sheetwrap' in i2 and 'zoom' not in i2 and 'app' in i2, f'foto ingrandita sopra la scheda: la scheda sotto non è raggiungibile ({i2})')
        await T('#zoom [data-act="zclose"]').click(); await pg.wait_for_timeout(400)
        i3 = await inerti()
        ok('sheetwrap' not in i3 and 'app' in i3, f'chiusa la foto: si torna alla scheda, la pagina resta isolata ({i3})')
        await chiudi()
        ok(await inerti() == [], f'chiusa la scheda: tutto di nuovo raggiungibile ({await inerti()})')

        # ---------- catalogo in PDF dalle impostazioni ----------
        await T('#hright [data-act="settings"]').click(); await pg.wait_for_timeout(700)
        await T('[data-act="pdfcat"]').scroll_into_view_if_needed()
        async with pg.expect_download(timeout=30000) as scarico:
            await T('[data-act="pdfcat"]').click()
        file = await scarico.value
        percorso = await file.path()
        byte = open(percorso, 'rb').read()
        pagine = byte.count(b'/Type /Page') - byte.count(b'/Type /Pages')
        attese = await pg.evaluate("""new Set(__eurodex.tuttiPezzi.filter(p => !p.t.commem && !p.proof && !p.extra).map(p => p.t.cc)).size - 1 + 5 + 1""")
        ok(byte[:5] == b'%PDF-' and file.suggested_filename.endswith('.pdf'), f'catalogo in PDF: si scarica un PDF ({file.suggested_filename}, {len(byte) // 1024} kB)')
        ok(pagine == attese, f'catalogo in PDF: copertina e una pagina per paese, Germania una per zecca ({pagine} pagine, attese {attese})')
        ok(await T('[data-act="pdfcat"]').inner_text() == 'Crea il PDF del catalogo' and not await T('[data-act="pdfcat"]').is_disabled(), 'catalogo in PDF: finito, il pulsante torna come prima')
        await chiudi()

        # ---------- messaggio in basso: quando sparisce, sparisce anche per TalkBack ----------
        await pg.evaluate("__eurodex.avviso('Prova del messaggio')"); await pg.wait_for_timeout(400)
        ok(await pg.evaluate("document.querySelector('#tmsg').textContent") == 'Prova del messaggio', 'messaggio in basso: compare con il suo testo')
        await pg.wait_for_timeout(3600)
        ok(await pg.evaluate(NASCOSTI) == [], f'messaggio sparito: TalkBack non lo legge più ({await pg.evaluate(NASCOSTI)})')

        # ---------- impaginazione: niente che esce dallo schermo, in chiaro e in scuro ----------
        for sc in ('light', 'dark'):
            for w, h in ((360, 740), (412, 915), (800, 1280), (1100, 700)):
                c2 = await b.new_context(viewport={'width': w, 'height': h}, color_scheme=sc, reduced_motion='reduce')
                await c2.add_init_script("localStorage.setItem('collezioneEuro.v3', JSON.stringify({app:'collezione-euro', versione:3, possedute:" + json.dumps(POSS) + ", preferiti:['" + str(a) + "'], meta:{benvenuto:1, novitaVista:999}}))")
                q = await c2.new_page(); e2 = []; q.on('pageerror', lambda e: e2.append(str(e)))
                await q.goto('http://localhost:8791/index.html'); await q.wait_for_timeout(1800)
                fuori, vuoti, contrasti, troppo_piccoli, invisibili = [], [], [], [], []
                for t in ('Collezione', 'Le mie', 'Catalogo', 'Mancanti', 'Extra', 'Cerca', 'Impostazioni', 'Scheda moneta'):
                    if t == 'Impostazioni':
                        await q.locator('#hright [data-act="settings"]').click(); await q.wait_for_timeout(700)
                    elif t == 'Scheda moneta':
                        await q.evaluate(f"__eurodex.apriScheda('{a}')"); await q.wait_for_timeout(900)
                    else:
                        await q.locator(f'#nav button:has-text("{t}")').click(); await q.wait_for_timeout(400)
                    r = await q.evaluate("""() => { const W = innerWidth; const out = [...document.querySelectorAll('#main *, header *, nav *')].filter(e => { const r = e.getBoundingClientRect();
                        return r.width > 0 && r.right > W + 1 && !e.closest('.hscroll, .hrow, .chips') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(e => e.tagName + '.' + e.className);
                        return {scroll: document.documentElement.scrollWidth > W + 1, out}; }""")
                    if r['scroll'] or r['out']: fuori.append((t, r))
                    # ogni disegno che occupa spazio deve disegnare qualcosa: forme SVG vere (non tag HTML finiti dentro
                    # un <svg>, che il browser non disegna) e un'area non nulla
                    v = await q.evaluate("""() => [...document.querySelectorAll('svg')].filter(s => {
                        const r = s.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || getComputedStyle(s).visibility === 'hidden') return false;
                        if ([...s.querySelectorAll('*')].some(e => e.namespaceURI !== 'http://www.w3.org/2000/svg')) return true;
                        try { const b = s.getBBox(); return b.width === 0 && b.height === 0; } catch { return false; }
                      }).slice(0, 3).map(s => s.closest('[aria-label]')?.getAttribute('aria-label') || s.closest('button')?.textContent?.trim().slice(0, 20) || s.parentElement?.className || 'svg')""")
                    if v: vuoti.append((t, v))
                    # scelte tra più opzioni: per TalkBack ogni gruppo ha un nome e una sola opzione scelta
                    g = await q.evaluate("""() => [...document.querySelectorAll('[role=radiogroup]')].filter(g => g.getClientRects().length).map(g => ({
                        nome: g.getAttribute('aria-label') || document.getElementById(g.getAttribute('aria-labelledby') || '')?.textContent || '',
                        scelte: g.querySelectorAll('[role=radio][aria-checked=true]').length, opzioni: g.querySelectorAll('[role=radio]').length,
                        fuori: [...document.querySelectorAll('[role=radio]')].filter(r => !r.closest('[role=radiogroup]')).length }))
                        .filter(x => !x.nome || x.scelte !== 1 || x.opzioni < 2 || x.fuori)""")
                    if g: vuoti.append((t, 'scelte', g[:2]))
                    bassi = await q.evaluate(CONTRASTO)
                    if bassi: contrasti.append((t, bassi[:4]))
                    piccoli = await q.evaluate(TOCCO)
                    if piccoli: troppo_piccoli.append((t, piccoli[:4]))
                    fantasmi = await q.evaluate(NASCOSTI)
                    if fantasmi: invisibili.append((t, fantasmi))
                    if t in ('Impostazioni', 'Scheda moneta'):
                        await q.evaluate('__eurodex.chiudiFoglio()'); await q.wait_for_timeout(400)
                ok(not fuori and not e2, f'{sc} {w}×{h}: niente esce dallo schermo in nessuna scheda {fuori[:2]} {e2[:1]}')
                ok(not invisibili, f'{sc} {w}×{h}: niente di invisibile che TalkBack legge o si può toccare {invisibili[:3]}')
                ok(not troppo_piccoli, f'{sc} {w}×{h}: tutto quello che si tocca è almeno 48×48 dp {troppo_piccoli[:3]}')
                ok(not contrasti, f'{sc} {w}×{h}: tutto il testo si legge bene (contrasto WCAG AA) {contrasti[:3]}')
                ok(not vuoti, f'{sc} {w}×{h}: tutte le icone e i disegni si vedono, ogni gruppo di scelte ha nome e una sola opzione scelta {vuoti[:2]}')
                await c2.close()
        ok(not errs, f'nessun errore JavaScript durante l\'uso ({errs[:2]})')
        print('\nRISULTATO:', 'TUTTO OK' if not ERR else f'{len(ERR)} PROBLEMI'); [print('  -', e) for e in ERR]
        await b.close()
asyncio.run(main())
sys.exit(1 if ERR else 0)
