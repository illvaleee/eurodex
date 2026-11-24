"""Accesso su approvazione nell'app, come lo userebbero Valerio e gli altri: l'app vera in più browser (uno per
persona), con i servizi di Firebase in versione locale (emulatori di Authentication, Firestore e delle funzioni, con
le regole vere del progetto e l'UID vero di Valerio). Ogni accesso con Google è un tentativo che Valerio vede; chi è
già approvato rientra da solo, chi è stato escluso resta fuori anche con il muro spento (scelte del 21/11).

Si avvia dentro gli emulatori, con l'app servita su http://localhost:8791 (come in prove/esegui.sh):
  firebase emulators:exec --only auth,firestore,functions --project collezione-euro-24ecd \
      "python3 prove/accesso-app.py"
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


def richiesta(uid):
    st, j = rest('GET', f'{FS}/accessi/{uid}')
    if st != 200:
        return {}
    return {k: v.get('stringValue', v.get('integerValue', v.get('timestampValue')))
            for k, v in j.get('fields', {}).items()}


def stato_richiesta(uid):
    return richiesta(uid).get('stato')


def tentativi(uid):
    return int(richiesta(uid).get('tentativi') or 0)


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

        dlg = lambda pg: aspetta(lambda: pg.evaluate("!!document.querySelector('.dlg.show')"), 5)
        lista = lambda: testo(V, '#acclist')
        sul_muro = lambda pg, t: aspetta(lambda: pg.evaluate(
            f"(document.querySelector('#muro')||{{}}).innerText?.includes({json.dumps(t)}) || false"), 20)

        # ── 2. Mario (muro spento) accede dalle impostazioni: arriva da solo a Valerio, in attesa ──
        M_ctx, M = await persona('Mario', 'mario-g', 'mario@example.com', 'Mario Rossi')
        ok(await accedi_sync(M), 'Mario accede con Google (col muro spento sincronizza come prima)')
        MAR = await M.evaluate('__eurodex.sync.uid')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(MAR) == 'in_attesa'), 20),
           'il suo accesso diventa da solo una richiesta in attesa (senza premere niente)')
        r = richiesta(MAR)
        ok(r.get('email') == 'mario@example.com' and r.get('nome') == 'Mario Rossi', 'con email e nome veri dell\'account')
        await impostazioni(M)
        ok(await aspetta(lambda: M.evaluate("(document.querySelector('#accessobox')||{}).innerText.includes('In attesa')")),
           'nelle sue impostazioni: «In attesa dell\'approvazione»')
        ok(not await M.evaluate("!!document.querySelector('#accessobox [data-act=\"accgestisci\"]')"),
           'Mario non vede la sezione di Valerio')
        ok(not await M.evaluate('!!document.querySelector("#muro")'), 'e col muro spento usa Eurodex')
        await foto(M, '2_mario_in_attesa')

        # ── 3. Valerio apre la sua sezione: Mario c'è, con il telefono; lo approva ──
        await impostazioni(V)
        await V.click('#accessobox [data-act="accgestisci"]')
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.toLowerCase().includes('in attesa (1)')")),
           'nella sezione di Valerio c\'è 1 richiesta in attesa')
        t = await lista()
        ok('Mario Rossi' in t and 'mario@example.com' in t and 'ultimo accesso oggi' in t,
           f'con nome, email e ultimo accesso ({t[:160]!r})')
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.includes('Usa Eurodex su')")),
           'e il telefono su cui usa Eurodex')
        await foto(V, '3_valerio_richieste')
        await V.click(f'#acclist [data-act="accok"][data-v="{MAR}"]')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(MAR) == 'approvato')), 'Valerio approva Mario')
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.toLowerCase().includes('approvati (1)')")),
           'l\'elenco si aggiorna da solo (Approvati: 1)')

        # ── 4. Valerio accende il muro ──
        await V.click('label:has([data-muro])')
        ok(await dlg(V), 'per accenderlo chiede conferma')
        t = await testo(V, '.dlg.show')
        ok('Approvati adesso: 1' in t, f'e dice quanti sono approvati ({t[:120]!r})')
        await V.click('.dlg.show button:has-text("Accendi")')
        ok(await aspetta(lambda: asyncio.sleep(0, muro_acceso())), 'muro acceso (config/accesso, obbligatorio = true)')

        # ── 5. Lucia, nuova, col muro acceso: accede e la richiesta parte da sola ──
        L_ctx, L = await persona('Lucia', 'lucia-g', 'lucia@example.com', 'Lucia Verdi')
        ok(await aspetta(lambda: L.evaluate("!!document.querySelector('#muro [data-act=\"muroaccedi\"]')"), 20),
           'Lucia apre l\'app: c\'è il muro con «Accedi con Google»')
        ok('su invito' in await testo(L, '#muro'), 'il muro dice che Eurodex è su invito')
        await foto(L, '4_lucia_muro')
        await L.click('#muro [data-act="muroaccedi"]')
        ok(await sul_muro(L, 'Richiesta inviata'), 'dopo l\'accesso: «Richiesta inviata», senza altri pulsanti da premere')
        ok('lucia@example.com' in await testo(L, '#muro'), 'con l\'email con cui è entrata')
        ok(not await L.evaluate('!!(__eurodex.sync && __eurodex.sync.uid)'), 'senza approvazione la sincronizzazione non parte')
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.includes('lucia@example.com')")),
           'la richiesta di Lucia compare da sola nella sezione di Valerio')
        LUC = await V.evaluate("document.querySelector('#acclist [data-act=\"accno\"]').dataset.v")
        ok(stato_richiesta(LUC) == 'in_attesa', 'in attesa')
        await foto(L, '5_lucia_attesa')

        # ── 6. Valerio la rifiuta: lei può chiedere di nuovo, e lui la vede ──
        await V.click(f'#acclist [data-act="accno"][data-v="{LUC}"]')
        if await dlg(V):
            await V.click('.dlg.show button:has-text("Rifiuta")')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(LUC) == 'rifiutato')), 'Valerio rifiuta Lucia (con conferma)')
        ok(await sul_muro(L, 'non approvato'), 'sul telefono di Lucia il muro dice subito «Accesso non approvato»')
        ok(await L.evaluate("!!document.querySelector('#muro [data-act=\"muroancora\"]:not([disabled])')")
           and await L.evaluate("!!document.querySelector('#muro [data-act=\"muroesci\"]')"),
           'con «Chiedi di nuovo» e «Usa un altro account»')
        await foto(L, '6_lucia_rifiutata')
        prima = tentativi(LUC)
        await L.click('#muro [data-act="muroancora"]')
        ok(await aspetta(lambda: asyncio.sleep(0, tentativi(LUC) == prima + 1), 20),
           'Lucia chiede di nuovo: il tentativo arriva (Valerio ne riceve la notifica)')
        ok(stato_richiesta(LUC) == 'rifiutato', 'e resta rifiutata finché Valerio non decide (rifiutata in automatico)')
        ok(await L.evaluate("!!document.querySelector('#muro [data-act=\"muroancora\"][disabled]')"),
           'il pulsante diventa «Richiesta inviata ✓» (non si preme di continuo)')
        ok(await aspetta(lambda: V.evaluate("(document.querySelector('#acclist')||{}).innerText.includes('rifiutato')")),
           'Valerio la vede tra i non approvati')
        await V.click(f'#acclist [data-act="accok"][data-v="{LUC}"]')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(LUC) == 'approvato')), 'Valerio ci ripensa e la approva')
        ok(await aspetta(lambda: L.evaluate('!document.querySelector("#muro")'), 20), 'il muro di Lucia si toglie da solo')
        ok(await aspetta(lambda: L.evaluate("(document.querySelector('.toast.show')||{}).innerText?.includes('Accesso approvato') || false"), 8),
           'con «Accesso approvato ✓ Benvenuto in Eurodex»')
        ok(await aspetta(lambda: L.evaluate('!!(__eurodex.sync && __eurodex.sync.uid)'), 20),
           'e la sincronizzazione di Lucia parte senza chiederle niente')
        await foto(L, '7_lucia_dentro')

        # ── 7. Lucia esce dall'account: l'app torna bloccata; rientrando entra da sola (approvata in automatico) ──
        await impostazioni(L)
        await L.click('#syncbox [data-act="syncscollega"]')
        if await dlg(L):
            await L.click('.dlg.show button:has-text("Esci")')
        ok(await aspetta(lambda: L.evaluate("!!document.querySelector('#muro [data-act=\"muroaccedi\"]')"), 15),
           'Lucia esce dall\'account: subito la schermata «Accedi con Google» (col muro acceso)')
        prima = tentativi(LUC)
        await L.click('#muro [data-act="muroaccedi"]')
        ok(await aspetta(lambda: L.evaluate('!document.querySelector("#muro")'), 20), 'rientra con lo stesso account: l\'app si apre')
        arrivato = await aspetta(lambda: asyncio.sleep(0, tentativi(LUC) >= prima + 1), 20)
        await asyncio.sleep(2)
        ok(arrivato and tentativi(LUC) == prima + 1 and stato_richiesta(LUC) == 'approvato',
           f'il tentativo arriva a Valerio e lei resta approvata (in automatico) ({prima} → {tentativi(LUC)}, {stato_richiesta(LUC)})')

        # ── 8. Mario (approvato) riapre l'app: niente muro; Valerio gli toglie l'accesso ──
        await M.reload()
        await M.wait_for_function('window.__eurodex && window.__eurodex.pezzi.length > 0', timeout=30000)
        await M.wait_for_timeout(2500)
        ok(not await M.evaluate('!!document.querySelector("#muro")'), 'Mario approvato riapre l\'app: niente muro')
        await V.click(f'#acclist [data-act="accvia"][data-v="{MAR}"]')
        ok(await dlg(V) and 'notifica' in await testo(V, '.dlg.show'), 'per togliere l\'accesso chiede conferma (e dice della notifica)')
        await V.click('.dlg.show button:has-text("Togli")')
        ok(await aspetta(lambda: asyncio.sleep(0, stato_richiesta(MAR) == 'revocato')), 'Valerio toglie l\'accesso a Mario')
        ok(await sul_muro(M, 'Accesso tolto'), 'sul telefono di Mario, con l\'app aperta: subito «Accesso tolto»')
        await foto(M, '8_mario_tolto')

        # ── 9. Valerio spegne il muro: tutti dentro, tranne chi ha escluso ──
        await V.click('label:has([data-muro])')
        ok(await aspetta(lambda: asyncio.sleep(0, not muro_acceso())), 'Valerio spegne il muro (senza conferme)')
        await M.evaluate('__eurodex.muro.aggiorna()')
        await M.wait_for_timeout(1500)
        ok(await sul_muro(M, 'Accesso tolto'), 'Mario (accesso tolto) resta fuori anche col muro spento')
        await L.evaluate('__eurodex.muro.aggiorna()')
        ok(not await L.evaluate('!!document.querySelector("#muro")'), 'Lucia (approvata) dentro')
        prima = tentativi(MAR)
        await M.click('#muro [data-act="muroancora"]')
        ok(await aspetta(lambda: asyncio.sleep(0, tentativi(MAR) == prima + 1), 20), 'Mario chiede di nuovo')
        await V.click(f'#acclist [data-act="accok"][data-v="{MAR}"]')
        ok(await aspetta(lambda: M.evaluate('!document.querySelector("#muro")'), 20), 'Valerio lo riapprova: Mario rientra')
        t = await lista()
        ok('approvati (2)' in t.lower() and 'in attesa (0)' in t.lower(), f'alla fine nell\'elenco: 2 approvati ({t[:100]!r})')

        for n, e in errori.items():
            gravi = [x for x in e if 'permission' not in x.lower() and 'Missing or insufficient' not in x]
            ok(not gravi, f'{n}: nessun errore nella pagina' + (f' ({gravi[:2]})' if gravi else ''))
        await b.close()

    falliti = [c for o, c in ESITI if not o]
    print('RISULTATO:', 'TUTTO OK' if not falliti else f'{len(falliti)} PROBLEMI')
    raise SystemExit(1 if falliti else 0)


asyncio.run(main())
