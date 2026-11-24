import os, sys
os.makedirs(os.environ.get('PROVE_FOTO', '/tmp/prove-foto'), exist_ok=True)
# Backup e ripristino "completi": monete, preferite, note, storico e (a scelta) aspetto e impostazioni con la foto di sfondo
import asyncio, json, base64
from playwright.async_api import async_playwright
ERR = []
# il muro vero (config/accesso sul server) qui non conta: queste prove non usano gli emulatori, e col muro acceso da
# Valerio vedrebbero solo la schermata per accedere. Il muro lo provano accesso-app.py (emulatori) e la 7b dell'APK
async def muro_spento(ctx):
    await ctx.route('**/documents/config/accesso*', lambda r: r.fulfill(status=404, body='{}'))


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m, flush=True)
    if not c: ERR.append(m)
cat = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www', 'data', 'catalog.json')))
IT = [t for t in cat['types'] if t['cc'] == 'IT' and t['p']]
POSS = [t['p'][0][0] for t in IT[:15]]
# una vera immagine JPEG piccola (generata nel browser)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def dispositivo(dati):
            ctx = await b.new_context(viewport={'width': 412, 'height': 915}, reduced_motion='reduce', accept_downloads=True)
            await muro_spento(ctx)
            await ctx.add_init_script("if (!localStorage.getItem('collezioneEuro.v3')) localStorage.setItem('collezioneEuro.v3', JSON.stringify(" + json.dumps(dati) + "))")
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://localhost:8791/index.html'); await pg.wait_for_timeout(2500)
            return pg, errs
        # telefono: collezione completa, preferite, note, sfondo a foto, vista album, proof nascoste
        A, ea = await dispositivo({'app': 'collezione-euro', 'versione': 3, 'possedute': POSS, 'preferiti': [str(IT[0]['id']), str(IT[1]['id'])], 'note': {str(IT[2]['id']): 'presa a Roma'}, 'meta': {'benvenuto': 1, 'novitaVista': 999}})
        await A.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 300, 500);
            const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9)); await __eurodex.scegliFoto(new File([blob], 'f.jpg', {type:'image/jpeg'})); }""")
        await A.wait_for_timeout(800)
        await A.evaluate("__eurodex.prefs.album = true; __eurodex.prefs.noProof = true; __eurodex.ricostruisciIndice(); __eurodex.prefs.sfondoVis = 55; __eurodex.salva(); __eurodex.applicaSfondo()")
        foto = await A.evaluate("__eurodex.fotoPerBackup()")
        ok(bool(foto) and foto.startswith('data:image/jpeg'), f'telefono: la foto di sfondo ha la sua copia compatta ({len(foto or "") // 1024} KB)')
        # il file di backup (lo stesso che va su Drive, nelle copie e nel backup di Android)
        async with A.expect_download() as dl:
            await A.evaluate("__eurodex.apriImpostazioni()"); await A.wait_for_timeout(700)
            await A.locator('[data-act="export"]').click()
        path = await (await dl.value).path(); j = json.load(open(path))
        ok(sorted(j['possedute']) == sorted(POSS), 'file di backup: tutte le monete')
        ok(sorted(j['preferiti']) == sorted([str(IT[0]['id']), str(IT[1]['id'])]), 'file di backup: le preferite')
        ok(j['note'].get(str(IT[2]['id'])) == 'presa a Roma', 'file di backup: le note')
        ok(isinstance(j.get('storico'), list), 'file di backup: lo storico')
        ok(j['preferenze'].get('album') is True and j['preferenze'].get('noProof') is True and j['preferenze'].get('sfondo') == 'foto', 'file di backup: le impostazioni (vista, proof, sfondo)')
        ok(j.get('sfondoFoto') == foto, 'file di backup: la foto di sfondo')
        drive = await A.evaluate("JSON.parse(__eurodex.serializza(__eurodex.fotoPerBackup()))")
        ok(drive.get('sfondoFoto') == foto, 'backup automatico (Drive, copie, Android): stesso contenuto completo')
        ok('sfondoFoto' not in await A.evaluate("JSON.parse(localStorage.getItem('collezioneEuro.v3'))"), 'la foto non appesantisce la memoria interna dell\'app (sta a parte)')

        # tablet nuovo: ripristino con "anche aspetto e impostazioni" acceso
        B, eb = await dispositivo({'app': 'collezione-euro', 'versione': 3, 'possedute': [], 'meta': {'benvenuto': 1, 'novitaVista': 999}})
        await B.evaluate("__eurodex.apriImpostazioni()"); await B.wait_for_timeout(700)
        await B.set_input_files('#bkfile', path); await B.wait_for_timeout(700)
        txt = await B.locator('#sheetbody').inner_text()
        ok('15' in txt and '2 preferite' in txt and '1 nota' in txt, 'ripristino: la finestra dice cosa c\'è nel backup (monete, preferite, note)')
        ok(await B.locator('#rstaspetto').is_checked(), 'ripristino: "Anche aspetto e impostazioni" c\'è ed è acceso')
        await B.screenshot(path=os.environ.get('PROVE_FOTO', '/tmp/prove-foto') + '/ripristino.png')
        await B.locator('[data-act="dorestore"]').click(); await B.wait_for_timeout(1500)
        r = await B.evaluate("({o: __eurodex.possedute.size, f: [...__eurodex.preferite].sort(), n: __eurodex.note, album: __eurodex.prefs.album, np: __eurodex.prefs.noProof, sf: __eurodex.prefs.sfondo, vis: __eurodex.prefs.sfondoVis, proofVisibili: __eurodex.pezzi.some(p => p.proof), tema: document.documentElement.classList.contains('tema')})")
        foto_b = await B.evaluate("__eurodex.prendi('sfondo64')")
        ok(r['o'] == 15 and r['f'] == sorted([str(IT[0]['id']), str(IT[1]['id'])]) and r['n'].get(str(IT[2]['id'])) == 'presa a Roma', 'tablet: tornano monete, preferite e note')
        ok(r['album'] and r['np'] and r['sf'] == 'foto' and r['vis'] == 55 and not r['proofVisibili'], 'tablet: tornano vista album, proof nascoste (davvero) e sfondo')
        ok(foto_b == foto and r['tema'], 'tablet: torna anche la foto di sfondo, già applicata')
        await B.locator('#tundo').click(); await B.wait_for_timeout(1200)
        r2 = await B.evaluate("({o: __eurodex.possedute.size, f: __eurodex.preferite.size, n: Object.keys(__eurodex.note).length, album: __eurodex.prefs.album, np: __eurodex.prefs.noProof, sf: __eurodex.prefs.sfondo, proofVisibili: __eurodex.pezzi.some(p => p.proof)})")
        ok(r2 == {'o': 0, 'f': 0, 'n': 0, 'album': False, 'np': False, 'sf': 'predefinito', 'proofVisibili': True} or (r2['o'] == 0 and r2['f'] == 0 and r2['n'] == 0 and not r2['album'] and not r2['np'] and r2['proofVisibili']), f'"Annulla" torna davvero a com\'era prima, impostazioni comprese ({r2})')

        # secondo tablet con il suo aspetto: ripristino con l'interruttore spento → collezione sì, aspetto no
        C, ec = await dispositivo({'app': 'collezione-euro', 'versione': 3, 'possedute': [], 'preferenze': {'sfondo': 'colore', 'colore': '#22AA66'}, 'meta': {'benvenuto': 1, 'novitaVista': 999}})
        await C.evaluate("__eurodex.apriImpostazioni()"); await C.wait_for_timeout(700)
        await C.set_input_files('#bkfile', path); await C.wait_for_timeout(700)
        await C.locator('label.tgl:has(#rstaspetto)').click(); await C.wait_for_timeout(200); await C.locator('[data-act="dorestore"]').click(); await C.wait_for_timeout(1500)
        r3 = await C.evaluate("({o: __eurodex.possedute.size, f: __eurodex.preferite.size, sf: __eurodex.prefs.sfondo, col: __eurodex.prefs.colore, album: !!__eurodex.prefs.album})")
        ok(r3['o'] == 15 and r3['f'] == 2 and r3['sf'] == 'colore' and r3['col'] == '#22AA66' and not r3['album'], f'interruttore spento: torna la collezione, l\'aspetto del tablet resta il suo ({r3})')
        ok(not ea and not eb and not ec, f'nessun errore JavaScript {ea[:1]} {eb[:1]} {ec[:1]}')
        print('\nRISULTATO:', 'TUTTO OK' if not ERR else ERR)
        await b.close()
asyncio.run(main())
sys.exit(1 if ERR else 0)
