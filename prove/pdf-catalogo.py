"""Catalogo in PDF, come lo crea una persona: importa la collezione della vecchia app, tocca "Crea il PDF del
catalogo" nelle impostazioni e guarda il file che esce (pagine, testi, copertina, numeri di pagina).
Il PDF e le immagini delle pagine restano tra le foto delle prove, così si può guardare com'è davvero.
Si avvia con il server delle prove già acceso (prove/esegui.sh)."""
import asyncio, os, re, shutil, subprocess
from playwright.async_api import async_playwright

DIR = os.path.join(os.environ.get('PROVE_FOTO', '/tmp/prove-foto'), 'catalogo-pdf')
os.makedirs(DIR, exist_ok=True)
CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dati', 'esportazione-vecchia-app.csv')
PDF = os.path.join(DIR, 'catalogo.pdf')
errori = []


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        errori.append(m)


async def crea_pdf():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True)
        pg = await ctx.new_page()
        js = []
        pg.on('pageerror', lambda e: js.append(str(e)))
        await pg.goto('http://localhost:8791/index.html')
        await pg.wait_for_selector('.hero')
        await pg.wait_for_selector('.welc', timeout=8000)
        await pg.click('.welc >> text=Inizia')
        await pg.wait_for_timeout(500)
        # una collezione vera: quella esportata dalla vecchia app (2.121 monete)
        await pg.click('[data-act=settings]')
        await pg.wait_for_timeout(300)
        await pg.set_input_files('#csvfile', CSV)
        await pg.wait_for_timeout(1500)
        possedute = await pg.evaluate('__eurodex.possedute.size')
        ok(possedute == 2121, f'collezione importata ({possedute} monete)')
        await pg.click('.sheet [data-act=close]')
        await pg.wait_for_timeout(300)
        await pg.click('[data-act=settings]')
        await pg.wait_for_timeout(400)
        pulsante = pg.locator('[data-act="pdfcat"]')
        ok(await pulsante.count() == 1, 'nelle impostazioni c\'è "Crea il PDF del catalogo"')
        await pulsante.scroll_into_view_if_needed()
        await pg.screenshot(path=os.path.join(DIR, 'impostazioni.png'))
        async with pg.expect_download(timeout=60000) as d:
            await pulsante.click()
        scaricato = await d.value
        ok(re.fullmatch(r'eurodex-catalogo-\d{4}-\d{2}-\d{2}\.pdf', scaricato.suggested_filename or '') is not None,
           f'nome del file: {scaricato.suggested_filename}')
        await scaricato.save_as(PDF)
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(DIR, 'dopo-il-pdf.png'))
        ok(not js, f'nessun errore JavaScript {js[:1]}')
        await b.close()
    return possedute


def leggi_pdf():
    dati = open(PDF, 'rb').read()
    ok(dati.startswith(b'%PDF-') and len(dati) > 20_000, f'è un PDF vero ({len(dati) // 1024} KB)')
    try:
        from pypdf import PdfReader
    except ImportError:
        print('  (pypdf non c\'è: controllo solo il file)')
        return
    r = PdfReader(PDF)
    n = len(r.pages)
    testi = [pag.extract_text() or '' for pag in r.pages]
    ok(n >= 10, f'{n} pagine (copertina e una tabella per paese)')
    ok(all(round(float(pag.mediabox.width)) == 595 and round(float(pag.mediabox.height)) == 842 for pag in r.pages),
       'tutte le pagine in formato A4 verticale')
    ok((r.metadata or {}).get('/Title') == 'Catalogo base delle monete in euro', 'titolo del documento giusto')
    ok('Catalogo' in testi[0], 'copertina: c\'è il titolo')
    ok(all(f'{i} / {n}' in t for i, t in enumerate(testi, 1)), 'ogni pagina ha il suo numero "i / n"')
    ok(all('Eurodex · creato il' in t for t in testi), 'ogni pagina ha il piè di pagina con la data')
    # copertina con l'elenco dei paesi, poi una pagina per paese con il nome in maiuscolo (Germania: una per zecca)
    for paese in ('Italia', 'Francia', 'Croazia'):
        ok(paese in testi[0] and any(paese.upper() in t for t in testi[1:]), f'c\'è la tabella di {paese}')
    zecche = [z for z in 'ADFGJ' if f'Germania · zecca {z}' in testi[0]]
    ok(len(zecche) == 5 and sum(t.lstrip().startswith('GERMANIA') for t in testi[1:]) == 5,
       f'Germania: una tabella per ogni zecca ({", ".join(zecche)})')
    ok(re.search(r'La collezione al \d{2}/\d{2}/\d{4}: \d+ monete su \d+', testi[0]) is not None,
       'copertina: quante monete hai su quante')
    ok(all(len(t.strip()) > 80 for t in testi), 'nessuna pagina vuota')


def immagini_pagine():
    # le pagine come immagini (piccole), per guardarle senza aprire il PDF
    if not shutil.which('pdftoppm'):
        print('  (pdftoppm non c\'è: niente immagini delle pagine)')
        return
    subprocess.run(['pdftoppm', '-r', '50', '-png', PDF, os.path.join(DIR, 'pagina')], check=False)
    print(f'  immagini delle pagine: {len([f for f in os.listdir(DIR) if f.startswith("pagina")])}')


asyncio.run(crea_pdf())
if os.path.exists(PDF):
    leggi_pdf()
    immagini_pagine()
else:
    ok(False, 'il PDF non è stato scaricato')
print('RISULTATO:', 'TUTTO OK' if not errori else f'{len(errori)} PROBLEMI')
raise SystemExit(1 if errori else 0)
