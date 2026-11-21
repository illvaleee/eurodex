"""Accesso su approvazione nell'app, come lo userebbero Valerio e chi chiede l'accesso: l'app vera in più browser (uno
per persona), con i servizi di Firebase in versione locale (emulatori di Authentication e Firestore, con le regole
vere del progetto e l'UID vero di Valerio).

Si avvia dentro gli emulatori, con l'app servita su http://localhost:8791 (come in prove/esegui.sh):
  firebase emulators:exec --only auth,firestore --project collezione-euro-24ecd "python3 prove/accesso-app.py"
"""
import asyncio
import json
import os
import re
import time
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

PROGETTO = 'collezione-euro-24ecd'
APP = 'http://localhost:8791/index.html?emulatori=localhost:9099:8080'
FS = f'http://localhost:8080/v1/projects/{PROGETTO}/databases/(default)/documents'
AUTH_ADMIN = f'http://localhost:9099/identitytoolkit.googleapis.com/v1/projects/{PROGETTO}'
REGOLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'firebase', 'firestore.rules')
FOTO = os.environ.get('PROVE_FOTO', '/tmp/prove-foto')
os.makedirs(FOTO, exist_ok=True)
ESITI = []


def ok(cond, cosa):
    ESITI.append((bool(cond), cosa))
    print(('✓ ' if cond else '✗ ') + cosa, flush=True)


def rest(metodo, url, corpo=None):
    req = urllib.request.Request(url, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer owner'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, {}


def gettone(sub, email, nome):
    """Gettone di Google finto: l'emulatore di Authentication lo accetta senza firma."""
    return json.dumps({'sub': sub, 'email': email, 'email_verified': True, 'name': nome})


def stato_richiesta(uid):
    st, j = rest('GET', f'{FS}/accessi/{uid}')
    return j.get('fields', {}).get('stato', {}).get('stringValue') if st == 200 else None


def muro_acceso():
    st, j = rest('GET', f'{FS}/config/accesso')
    return st == 200 and j.get('fields', {}).get('obbligatorio', {}).get('booleanValue') is True


async def aspetta(f, secondi=15):
    fine = time.time() + secondi
    while time.time() < fine:
        try:
            if await f():
                return True
        except Exception:
            pass
        await asyncio.sleep(0.4)
    return False


async def main():
    rest('DELETE', f'http://localhost:8080/emulator/v1/projects/{PROGETTO}/databases/(default)/documents')
    rest('DELETE', f'http://localhost:9099/emulator/v1/projects/{PROGETTO}/accounts')
    # Valerio con il suo UID vero (quello delle regole e dell'app), legato a un account Google di prova
    VAL = re.findall(r"request\.auth\.uid == '([A-Za-z0-9]{20,40})'", open(REGOLE, encoding='utf-8').read())[0]
    st, _ = rest('POST', f'{AUTH_ADMIN}/accounts:batchCreate', {'users': [{
        'localId': VAL, 'email': 'valerio.prova@example.com', 'emailVerified': True, 'displayName': 'Valerio',
        'providerUserInfo': [{'providerId': 'google.com', 'rawId': 'vale-g', 'email': 'valerio.prova@example.com',
                              'displayName': 'Valerio'}]}]})
    ok(st == 200, f'(preparazione: Valerio con il suo UID vero negli emulatori, {st})')

    async with async_playwright() as p:
        b = await p.chromium.launch()
        errori = {}

        async def persona(nome, sub, email, nome_google):
            ctx = await b.new_context(viewport={'width': 412, 'height': 900})
            iniz = {'possedute': [], 'preferiti': [], 'note': {}, 'meta': {'benvenuto': 1, 'propostaSync': 1, 'firma': None}}
            await ctx.add_init_script(
                f"window.__eurodexProva = {{ idToken: {json.dumps(gettone(sub, email, nome_google))} }};"
                f"if (!localStorage.getItem('collezioneEuro.v3')) localStorage.setItem('collezioneEuro.v3', {json.dumps(json.dumps(iniz))});")
            pg = await ctx.new_page()
            errori[nome] = []
            pg.on('pageerror', lambda e, n=nome: errori[n].append(str(e)))
            pg.on('console', lambda m, n=nome: errori[n].append(m.text)
                  if m.type == 'error' and 'Failed to load resource' not in m.text else None)
            await pg.goto(APP)
            await pg.wait_for_function('window.__eurodex && window.__eurodex.pezzi.length > 0', timeout=30000)
            await pg.wait_for_timeout(1500)
            return ctx, pg

        async def foto(pg, nome):
            await pg.screenshot(path=os.path.join(FOTO, f'accesso_{nome}.png'))

        async def impostazioni(pg):
            await pg.evaluate('__eurodex.chiudiFoglio && __eurodex.chiudiFoglio()')
            await pg.evaluate('__eurodex.apriImpostazioni()')
            await pg.wait_for_timeout(600)

        async def accedi_sync(pg):
            await impostazioni(pg)
            await pg.click('#syncbox [data-act="syncaccedi"]')
            return await aspetta(lambda: pg.evaluate('!!(__eurodex.sync && __eurodex.sync.uid)'), 20)

        testo = lambda pg, sel: pg.evaluate(f"(document.querySelector({json.dumps(sel)}) || {{}}).innerText || ''")

        # ── 1. Valerio entra: vede la sua sezione ──
        V_ctx, V = await persona('Valerio', 'vale-g', 'valerio.prova@example.com', 'Valerio')
        ok(await accedi_sync(V), 'Valerio accede con Google')
        ok(await V.evaluate('__eurodex.sync.uid') == VAL, 'Valerio ha il suo UID vero (quello delle regole)')
        await impostazioni(V)
        ok(await aspetta(lambda: V.evaluate("!!document.querySelector('#accessobox [data-act=\"accgestisci\"]')")),
           'nelle impostazioni di Valerio c\'è «Gestisci gli accessi»')
        t = await testo(V, '#accessobox')
        ok('solo per te' in t and 'spento' in t, f'la sezione dice "solo per te" e "muro spento" ({t[:80]!r})')
        await foto(V, '1_valerio_impostazioni')

        # ── 2. Mario (muro spento) chiede l'accesso dalle impostazioni ──
        M_ctx, M = await persona('Mario', 'mario-g', 'mario@example.com', 'Mario Rossi')
        ok(await accedi_sync(M), 'Mario accede con Google (col muro spento sincronizza come prima)')
        MAR = await M.evaluate('__eurodex.sync.uid')
        await impostazioni(M)
        ok(await aspetta(lambda: M.evaluate("!!document.querySelector('#accessobox [data-act=\"accchiedi\"]')")),
           'Mario vede «Chiedi l\'accesso»')
        ok(not await M.evaluate("!!document.querySelector('#accessobox [data-act=\"accgestisci\"]')"),
           'Mario non vede la sezione di Valerio')
        await M.click('#accessobox [data-act="accchiedi"]')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(MAR) == 'in_attesa')), 'la richiesta di Mario arriva ("in attesa")')
        ok(await aspetta(lambda: M.evaluate("(document.querySelector('#accessobox')||{}).innerText.includes('Richiesta inviata')")),
           'e nelle sue impostazioni si legge «Richiesta inviata»')
        await foto(M, '2_mario_richiesta')

        # ── 3. Valerio apre la sua sezione e approva Mario ──
        await V.click('#accessobox [data-act="accgestisci"]')
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.toLowerCase().includes('in attesa (1)')")),
           'nella sezione di Valerio c\'è 1 richiesta in attesa')
        t = await testo(V, '#acclist')
        ok('Mario Rossi' in t and 'mario@example.com' in t, 'con nome ed email di Mario')
        await foto(V, '3_valerio_richieste')
        await V.click(f'#acclist [data-act="accok"][data-v="{MAR}"]')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(MAR) == 'approvato')), 'Valerio approva Mario')
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.toLowerCase().includes('approvati (1)')")),
           'l\'elenco si aggiorna da solo (Approvati: 1)')

        # ── 4. Valerio accende il muro ──
        await V.click('label:has([data-muro])')
        ok(await aspetta(lambda: V.evaluate("!!document.querySelector('.dlg.show')")), 'per accenderlo chiede conferma')
        t = await testo(V, '.dlg.show')
        ok('Approvati adesso: 1' in t, f'e dice quanti sono approvati ({t[:120]!r})')
        await V.click('.dlg.show button:has-text("Accendi")')
        ok(await aspetta(lambda: asyncio.sleep(0, muro_acceso())), 'muro acceso (config/accesso, obbligatorio = true)')

        # ── 5. Lucia, nuova, col muro acceso: vede solo il muro ──
        L_ctx, L = await persona('Lucia', 'lucia-g', 'lucia@example.com', 'Lucia')
        ok(await aspetta(lambda: L.evaluate("!!document.querySelector('#muro [data-act=\"muroaccedi\"]')"), 20),
           'Lucia apre l\'app: c\'è il muro con «Accedi con Google»')
        ok('su invito' in await testo(L, '#muro'), 'il muro dice che Eurodex è su invito')
        await foto(L, '4_lucia_muro')
        await L.click('#muro [data-act="muroaccedi"]')
        ok(await aspetta(lambda: L.evaluate("!!document.querySelector('#muro [data-act=\"murochiedi\"]')")),
           'dopo l\'accesso: «Chiedi l\'accesso»')
        ok('lucia@example.com' in await testo(L, '#muro'), 'con l\'email con cui è entrata')
        ok(not await L.evaluate('!!(__eurodex.sync && __eurodex.sync.uid)'), 'senza approvazione la sincronizzazione non parte')
        await L.click('#muro [data-act="murochiedi"]')
        ok(await aspetta(lambda: L.evaluate("(document.querySelector('#muro')||{}).innerText.includes('Richiesta inviata')")),
           'richiesta mandata: «Richiesta inviata»')
        await foto(L, '5_lucia_attesa')

        # ── 6. Valerio la vede subito, la rifiuta e poi ci ripensa ──
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.includes('lucia@example.com')")),
           'la richiesta di Lucia compare da sola nella sezione di Valerio')
        LUC = await V.evaluate("document.querySelector('#acclist [data-act=\"accno\"]').dataset.v")
        await V.click(f'#acclist [data-act="accno"][data-v="{LUC}"]')
        if await aspetta(lambda: V.evaluate("!!document.querySelector('.dlg.show')"), 5):
            await V.click('.dlg.show button:has-text("Rifiuta")')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(LUC) == 'rifiutato')), 'Valerio rifiuta Lucia (con conferma)')
        ok(await aspetta(lambda: L.evaluate("(document.querySelector('#muro')||{}).innerText.includes('non approvato')")),
           'sul telefono di Lucia il muro dice subito «Accesso non approvato»')
        await foto(L, '6_lucia_rifiutata')
        await V.click(f'#acclist [data-act="accok"][data-v="{LUC}"]')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(LUC) == 'approvato')), 'Valerio ci ripensa e la approva')
        ok(await aspetta(lambda: L.evaluate('!document.querySelector("#muro")'), 20), 'il muro di Lucia si toglie da solo')
        ok(await aspetta(lambda: L.evaluate('!!(__eurodex.sync && __eurodex.sync.uid)'), 20),
           'e la sincronizzazione di Lucia parte senza chiederle niente')
        await foto(L, '7_lucia_dentro')

        # ── 7. Mario (approvato) riapre l'app: niente muro; poi Valerio gli toglie l'accesso ──
        await M.reload()
        await M.wait_for_function('window.__eurodex && window.__eurodex.pezzi.length > 0', timeout=30000)
        await M.wait_for_timeout(2500)
        ok(not await M.evaluate('!!document.querySelector("#muro")'), 'Mario approvato riapre l\'app: niente muro')
        await V.click(f'#acclist [data-act="accvia"][data-v="{MAR}"]')
        if await aspetta(lambda: V.evaluate("!!document.querySelector('.dlg.show')"), 5):
            await V.click('.dlg.show button:has-text("Togli")')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(MAR) == 'revocato')), 'Valerio toglie l\'accesso a Mario')
        await M.evaluate('__eurodex.muro.aggiorna()')
        ok(await aspetta(lambda: M.evaluate("(document.querySelector('#muro')||{}).innerText.includes('non approvato')")),
           'Mario torna nell\'app: il muro')

        # ── 8. Valerio spegne il muro: tutti dentro ──
        await V.click('label:has([data-muro])')
        ok(await aspetta(lambda: asyncio.sleep(0, not muro_acceso())), 'Valerio spegne il muro (senza conferme)')
        await M.evaluate('__eurodex.muro.aggiorna()')
        ok(await aspetta(lambda: M.evaluate('!document.querySelector("#muro")')), 'anche Mario rientra')

        for n, e in errori.items():
            gravi = [x for x in e if 'permission' not in x.lower() and 'Missing or insufficient' not in x]
            ok(not gravi, f'{n}: nessun errore nella pagina' + (f' ({gravi[:2]})' if gravi else ''))
        await b.close()

    falliti = [c for o, c in ESITI if not o]
    print('RISULTATO:', 'TUTTO OK' if not falliti else f'{len(falliti)} PROBLEMI')
    raise SystemExit(1 if falliti else 0)


asyncio.run(main())
