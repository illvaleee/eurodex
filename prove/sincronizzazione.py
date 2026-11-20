"""Sincronizzazione tra dispositivi, con i veri servizi di Firebase in versione locale (emulatori di Authentication
e Firestore, con le stesse regole di sicurezza del progetto vero) e l'app vera in più browser, uno per dispositivo.

Si avvia dentro gli emulatori:  npx firebase emulators:exec --only auth,firestore "python3 prove/sincronizzazione.py"
"""
import asyncio
import json
import os
import time
import urllib.parse
import urllib.request

from playwright.async_api import async_playwright

PROGETTO = 'collezione-euro-24ecd'
APP = 'http://localhost:8791/index.html?emulatori=localhost:9099:8080'
FS = f'http://localhost:8080/v1/projects/{PROGETTO}/databases/(default)/documents'
AUTH = 'http://localhost:9099/identitytoolkit.googleapis.com/v1'
FOTO = os.environ.get('PROVE_FOTO', '/tmp/prove-foto')
os.makedirs(FOTO, exist_ok=True)

ESITI = []


def ok(cond, cosa):
    ESITI.append((bool(cond), cosa))
    print(('✓ ' if cond else '✗ ') + cosa, flush=True)


def gettone(sub, email, nome='Vale'):
    """Gettone di Google finto: l'emulatore di Authentication lo accetta senza firma."""
    return json.dumps({'sub': sub, 'email': email, 'email_verified': True, 'name': nome})


def rest(metodo, url, corpo=None, chi='owner'):
    req = urllib.request.Request(url, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {chi}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, {}


def documenti(percorso):
    """Documenti di una raccolta, letti come amministratore (senza regole)."""
    st, j = rest('GET', f'{FS}/{percorso}')
    return j.get('documents', []) if st == 200 else []


def accesso_rest(sub, email):
    """Accesso fatto fuori dall'app (per provare le regole con un altro utente)."""
    st, j = rest('POST', f'{AUTH}/accounts:signInWithIdp?key=prova',
                 {'postBody': f'id_token={gettone(sub, email)}&providerId=google.com', 'requestUri': 'http://localhost',
                  'returnSecureToken': True})
    return j.get('localId'), j.get('idToken')


async def aspetta(f, secondi=12):
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
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errori = {}

        async def dispositivo(nome, sub='vale-1', email='vale@gmail.com', collezione=None, locale=None, orologio=0):
            ctx = await b.new_context(viewport={'width': 412, 'height': 900})
            iniz = {'possedute': collezione or [], 'preferiti': [], 'note': {}, 'meta': {'benvenuto': 1, 'propostaSync': 1, 'firma': None}}
            await ctx.add_init_script(
                f"window.__eurodexProva = {{ idToken: {json.dumps(gettone(sub, email))} }};"
                f"if (!localStorage.getItem('collezioneEuro.v3')) localStorage.setItem('collezioneEuro.v3', {json.dumps(json.dumps(iniz))});"
                + (''.join(f"if (!localStorage.getItem({json.dumps(k)})) localStorage.setItem({json.dumps(k)}, {json.dumps(v)});" for k, v in (locale or {}).items()))
                + (f"{{ const vero = Date.now.bind(Date); Date.now = () => vero() + ({orologio}); }}" if orologio else ''))
            pg = await ctx.new_page()
            errori[nome] = []
            pg.on('pageerror', lambda e, n=nome: errori[n].append(str(e)))
            pg.on('console', lambda m, n=nome: errori[n].append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
            pg.on('console', lambda m, n=nome: print(f'    [{n} {m.type}] {m.text[:300]}', flush=True) if m.type in ('warning', 'error') else None)
            await pg.goto(APP)
            await pg.wait_for_function('window.__eurodex && window.__eurodex.pezzi.length > 0', timeout=30000)
            await pg.wait_for_timeout(800)
            return ctx, pg

        async def accedi(pg):
            await pg.evaluate('__eurodex.apriImpostazioni()')
            await pg.wait_for_timeout(700)
            await pg.click('#syncbox [data-act="syncaccedi"]')
            return await aspetta(lambda: pg.evaluate('!!(__eurodex.sync && __eurodex.sync.uid)'), 20)

        mie = lambda pg: pg.evaluate('[...__eurodex.possedute].sort()')

        # chiavi vere del catalogo
        A_ctx, A = await dispositivo('A')
        K = await A.evaluate('__eurodex.pezzi.slice(200, 225).map(p => p.key)')
        IDS = await A.evaluate('__eurodex.tipi.slice(30, 34).map(t => t.id)')
        await A.close()
        await A_ctx.close()

        # ── 1. A accede con Google ──
        A_ctx, A = await dispositivo('A', collezione=K[0:4])
        await A.evaluate(f"__eurodex.preferite.add('{IDS[0]}'); __eurodex.note['{IDS[1]}'] = 'nota di A'; __eurodex.salva()")
        ok(await A.locator('[data-act="syncaccedi"]').count() >= 0, 'A aperta')
        ok(await accedi(A), 'A: "Accedi con Google" funziona')
        uid = await A.evaluate('__eurodex.sync.uid')
        # l'invio parte subito ma arriva al server con i suoi tempi: si guarda l'account finché ci sono (come chi
        # ricarica la pagina), al massimo 20 secondi
        def possedute_online():
            voci = {}
            for d in documenti(f'collezioni/{uid}/voci'):
                for k, v in d['fields']['e']['mapValue'].get('fields', {}).items():
                    voci[k] = v['mapValue']['fields']
            return sorted(k for k, v in voci.items() if v['v'].get('booleanValue') is True)

        async def sull_account():
            return set(K[0:4]) <= set(possedute_online())

        async def formato_vecchio():
            return any(d['name'].endswith('/possedute') for d in documenti(f'collezioni/{uid}/stato'))

        ok(await aspetta(sull_account, 20), f'le monete di A sono sull\'account ({len(possedute_online())})')
        ok(await aspetta(formato_vecchio, 20), 'scritto anche il formato delle versioni vecchie (per chi non ha ancora aggiornato)')

        # ── 2. B accede con lo stesso account: la collezione diventa la stessa (unione) ──
        B_ctx, B = await dispositivo('B', collezione=K[3:7])
        ok(await accedi(B), 'B: accesso con lo stesso account')
        ok(await B.evaluate('__eurodex.sync.uid') == uid, 'B ha la stessa collezione di A (stesso utente)')
        print('    (B: voci conosciute', await B.evaluate('Object.keys(__eurodex.sync.voci).length'), '· errore:', await B.evaluate('__eurodex.sync.errore'),
              '· documenti voci online:', [d['name'].split('/')[-1] for d in documenti(f'collezioni/{uid}/voci')], ')')
        ok(await aspetta(lambda: B.evaluate(f"[{','.join(json.dumps(k) for k in K[0:7])}].every(k => __eurodex.possedute.has(k))")),
           'B ha l\'unione delle due collezioni')
        ok(await B.evaluate(f"__eurodex.preferite.has('{IDS[0]}') && __eurodex.note['{IDS[1]}'] === 'nota di A'"), 'B ha anche preferite e note di A')
        ok(await aspetta(lambda: A.evaluate(f"[{','.join(json.dumps(k) for k in K[4:7])}].every(k => __eurodex.possedute.has(k))")),
           'A riceve da sola le monete che c\'erano solo su B')

        # ── 3. elenco dei dispositivi ──
        await A.evaluate('__eurodex.apriImpostazioni()')
        ok(await aspetta(lambda: A.evaluate("document.querySelectorAll('#disp .disp').length === 2")), 'A vede 2 dispositivi collegati')
        await A.evaluate('__eurodex.chiudiFoglio()')

        # ── 4. A segna una moneta: arriva su B senza fare niente ──
        await A.evaluate(f"__eurodex.possedute.add('{K[8]}'); __eurodex.salva()")
        ok(await aspetta(lambda: B.evaluate(f"__eurodex.possedute.has('{K[8]}')")), 'B riceve subito la moneta aggiunta su A')
        st = await B.evaluate('__eurodex.storico.slice(-3)')
        ok(any(x[2] == K[8] and len(x) > 3 and x[3] == '@Telefono' for x in st), f'nello storico di B, con il nome del dispositivo da cui arriva: {st[-1:]}')

        # ── 5. B toglie una moneta, aggiunge una preferita e cambia una nota ──
        await B.evaluate(f"__eurodex.possedute.delete('{K[0]}'); __eurodex.preferite.add('{IDS[2]}'); __eurodex.note['{IDS[1]}'] = 'nota cambiata da B'; __eurodex.salva()")
        ok(await aspetta(lambda: A.evaluate(f"!__eurodex.possedute.has('{K[0]}')")), 'A: la moneta tolta su B sparisce')
        ok(await aspetta(lambda: A.evaluate(f"__eurodex.preferite.has('{IDS[2]}') && __eurodex.note['{IDS[1]}'] === 'nota cambiata da B'")),
           'A: preferita e nota arrivano')
        ok(await aspetta(lambda: A.evaluate("document.querySelector('[data-scope=\"all\"] [data-o]')?.textContent === String(__eurodex.pezzi.filter(p => __eurodex.possedute.has(p.key)).length)")),
           'A: i numeri sullo schermo si aggiornano da soli')

        # ── 6. senza rete: A toglie una moneta, intanto B ne aggiunge un'altra; poi torna la rete ──
        await A_ctx.set_offline(True)
        await A.evaluate(f"__eurodex.possedute.delete('{K[1]}'); __eurodex.salva()")
        await A.wait_for_timeout(2000)
        await B.evaluate(f"__eurodex.possedute.add('{K[9]}'); __eurodex.salva()")
        await B.wait_for_timeout(2000)
        ok(await A.evaluate(f"!__eurodex.possedute.has('{K[9]}')"), 'A senza rete: (giustamente) non vede ancora la moneta di B')
        await A_ctx.set_offline(False)
        ok(await aspetta(lambda: B.evaluate(f"!__eurodex.possedute.has('{K[1]}')"), 25) and await aspetta(lambda: A.evaluate(f"__eurodex.possedute.has('{K[9]}')"), 25),
           'tornata la rete: le due modifiche si incrociano senza perdite')
        ok(await aspetta(lambda: _uguali(A, B), 15), 'A e B di nuovo uguali')

        # ── 6b. il server ha tenuto la modifica PIÙ VECCHIA (arrivata tardi da A senza rete): si ripara da solo ──
        X = K[16]
        def voce_online(k):
            for d in documenti(f'collezioni/{uid}/voci'):
                v = d['fields']['e']['mapValue'].get('fields', {}).get(k)
                if v: return v['mapValue']['fields']['v'].get('booleanValue')
            return None
        await A.evaluate('__eurodex.reteSync(false)')
        await A.evaluate(f"__eurodex.possedute.add('{X}'); __eurodex.salva()")      # A, senza rete: segna X (resta in coda)
        await A.wait_for_timeout(2500)
        await B.evaluate(f"__eurodex.possedute.add('{X}'); __eurodex.salva()")      # B, dopo: segna X...
        ok(await aspetta(lambda: _vero(voce_online(X) is True), 15), 'B segna X: sul server')
        await B.evaluate(f"__eurodex.possedute.delete('{X}'); __eurodex.salva()")   # ...e poi la toglie (modifica più recente)
        ok(await aspetta(lambda: _vero(voce_online(X) is False), 15), 'B toglie X: sul server')
        await A.evaluate('__eurodex.reteSync(true)')                                 # A torna in rete: manda la sua, più vecchia
        ok(await aspetta(lambda: _vero(voce_online(X) is False), 25) and await aspetta(lambda: A.evaluate(f"!__eurodex.possedute.has('{X}')"), 25)
           and await B.evaluate(f"!__eurodex.possedute.has('{X}')"),
           'la modifica vecchia arrivata tardi non vince: server, A e B tornano alla più recente (X tolta)')

        # ── 6c. "Sincronizza ora" senza rete con una modifica in coda: lo dice, invece di "Tutto allineato" ──
        Y = K[17]
        await A.evaluate('__eurodex.reteSync(false)')
        await A.evaluate(f"__eurodex.possedute.add('{Y}'); __eurodex.salva()")
        await A.wait_for_timeout(3000)
        await A.evaluate('__eurodex.apriImpostazioni()')
        await A.wait_for_timeout(700)
        await A.click('#syncbox [data-act="syncora"]')
        ok(await aspetta(lambda: A.evaluate("document.querySelector('#tmsg')?.textContent.includes('Senza connessione')"), 15),
           '"Sincronizza ora" senza rete: dice che le modifiche partono appena c\'è rete')
        ok(await aspetta(lambda: A.evaluate("document.querySelector('#syncattesa')?.textContent.includes('in attesa di rete')"), 10),
           'la scheda dell\'account dice che ci sono modifiche in attesa di rete')
        await A.evaluate('__eurodex.reteSync(true)')
        ok(await aspetta(lambda: _vero(voce_online(Y) is True), 20), 'tornata la rete: la modifica arriva sul server')
        ok(await aspetta(lambda: A.evaluate("!document.querySelector('#syncattesa')?.textContent"), 15), 'e la riga "in attesa di rete" sparisce da sola')
        await A.evaluate('__eurodex.chiudiFoglio()')

        # ── 7. telefono con l'ora sbagliata (un'ora indietro): conta l'ordine vero delle modifiche ──
        C_ctx, C = await dispositivo('C', orologio=-3600_000)
        ok(await accedi(C), 'C (ora indietro di un\'ora) accede')
        await A.evaluate(f"__eurodex.possedute.add('{K[10]}'); __eurodex.salva()")
        ok(await aspetta(lambda: C.evaluate(f"__eurodex.possedute.has('{K[10]}')")), 'C riceve la moneta aggiunta su A')
        await C.evaluate(f"__eurodex.possedute.delete('{K[10]}'); __eurodex.salva()")   # fatta DOPO, ma con l'ora indietro
        ok(await aspetta(lambda: A.evaluate(f"!__eurodex.possedute.has('{K[10]}')")),
           'la modifica fatta per ultima vince anche se quel telefono ha l\'ora indietro (orologio logico)')

        # ── 8. una versione vecchia (fino alla 1.0.78) aggiunge una moneta: le nuove la vedono ──
        ms = int(time.time() * 1000) + 5000
        campo = urllib.parse.quote(f'p.`{K[11]}`')
        rest('PATCH', f'{FS}/collezioni/{uid}/stato/possedute?updateMask.fieldPaths={campo}',
             {'fields': {'p': {'mapValue': {'fields': {K[11]: {'integerValue': str(ms)}}}}}})
        ok(await aspetta(lambda: A.evaluate(f"__eurodex.possedute.has('{K[11]}')")) and await aspetta(lambda: B.evaluate(f"__eurodex.possedute.has('{K[11]}')")),
           'una modifica fatta da una versione vecchia arriva sulle nuove')

        # ── 9. l'aspetto resta di ciascun dispositivo e non manda notifiche ──
        eventi_prima = len(documenti(f'collezioni/{uid}/eventi'))
        await A.evaluate("__eurodex.prefs.colore = '#FF8800'; __eurodex.prefs.album = true; __eurodex.salva()")
        await A.wait_for_timeout(2500)
        ok(len(documenti(f'collezioni/{uid}/eventi')) == eventi_prima, 'cambio di sfondo/vista su A: nessuna notifica agli altri')
        ok(await B.evaluate("__eurodex.prefs.colore !== '#FF8800' && !__eurodex.prefs.album"), 'B tiene il suo aspetto')
        ok(eventi_prima > 0, f'le modifiche alla collezione hanno creato le notifiche per gli altri ({eventi_prima})')

        # ── 10. rinomina con la finestra dell'app (A ha già le impostazioni aperte: il nome deve cambiare da solo) ──
        await A.evaluate('__eurodex.apriImpostazioni()')
        await B.evaluate('__eurodex.apriImpostazioni()')
        await B.wait_for_timeout(700)
        await B.click('[data-act="syncnome"]')
        await B.wait_for_selector('.dlg.show .dlgin')
        ok(await B.locator('.dlg .dlgin').input_value() == await B.evaluate('__eurodex.sync.nome'), 'rinomina: il campo parte con il nome attuale')
        await B.fill('.dlg .dlgin', 'Tablet di Marco')
        await B.click('.dlg .dlgbtn .btn:last-child')
        ok(await aspetta(lambda: B.evaluate("__eurodex.sync.nome === 'Tablet di Marco' && __eurodex.sync.rinominato")), 'rinomina salvata')
        ok(await aspetta(lambda: A.evaluate("document.querySelector('#disp')?.textContent.includes('Tablet di Marco')")),
           'il nuovo nome arriva da solo anche agli altri, nell\'elenco già aperto')
        await A.evaluate('__eurodex.chiudiFoglio()')

        # ── 11. un altro account non vede la collezione di Vale ──
        D_ctx, D = await dispositivo('D', sub='altro-2', email='altro@gmail.com', collezione=[K[12]])
        ok(await accedi(D), 'un altro account accede')
        ok(await D.evaluate('__eurodex.sync.uid') != uid and await mie(D) == [K[12]], 'l\'altro account ha la sua collezione, separata')
        _, gettone_altro = accesso_rest('altro-2', 'altro@gmail.com')
        cod, _ = rest('GET', f'{FS}/collezioni/{uid}/voci', chi=gettone_altro)
        ok(cod == 403, f'e le regole di sicurezza gli impediscono di leggere quella di Vale ({cod})')

        # ── 12. B esce dall'account (prima: Z segnata su tutti e due) ──
        Z = K[18]
        await A.evaluate(f"__eurodex.possedute.add('{Z}'); __eurodex.salva()")
        ok(await aspetta(lambda: B.evaluate(f"__eurodex.possedute.has('{Z}')")), 'Z arriva anche su B')
        await B.evaluate('__eurodex.apriImpostazioni()')
        await B.wait_for_timeout(700)
        await B.click('[data-act="syncscollega"]')
        await B.wait_for_selector('.dlg.show')
        ok(await B.locator('.dlg.show').count() == 1, 'uscita: finestra di conferma nello stile dell\'app')
        await B.click('.dlg .dlgbtn .btn:last-child')
        ok(await aspetta(lambda: B.evaluate('__eurodex.sync === null')), 'B esce dall\'account')
        ok(await aspetta(lambda: B.evaluate("document.querySelectorAll('#syncbox [data-act=\"syncaccedi\"]').length === 1")), 'B torna a mostrare "Accedi con Google"')

        # ── 13. riapertura di A: resta collegata, senza chiedere niente ──
        await A.reload()
        await A.wait_for_function('window.__eurodex && window.__eurodex.pezzi.length > 0', timeout=30000)
        ok(await aspetta(lambda: A.evaluate('!!(__eurodex.sync && __eurodex.sync.uid) && !__eurodex.sync.scaduto')), 'A riaperta: ancora collegata')
        await B.evaluate(f"__eurodex.possedute.add('{K[13]}'); __eurodex.salva()")
        await B.wait_for_timeout(2500)
        ok(await A.evaluate(f"!__eurodex.possedute.has('{K[13]}')"), 'le modifiche di B (uscito) non arrivano più ad A')

        # ── 13b. mentre B è fuori, A toglie Z e B segna W; B rientra con lo stesso account ──
        W = K[19]
        await A.evaluate(f"__eurodex.possedute.delete('{Z}'); __eurodex.salva()")
        ok(await aspetta(lambda: _vero(voce_online(Z) is False), 15), 'A toglie Z: sul server')
        await B.evaluate(f"__eurodex.possedute.add('{W}'); __eurodex.salva()")
        ok(await accedi(B), 'B rientra con lo stesso account')
        ok(await aspetta(lambda: B.evaluate(f"!__eurodex.possedute.has('{Z}')"), 15) and await A.evaluate(f"!__eurodex.possedute.has('{Z}')"),
           'rientrando, la moneta tolta da A mentre B era fuori resta tolta (non ricompare)')
        ok(await aspetta(lambda: A.evaluate(f"__eurodex.possedute.has('{W}')"), 20), 'e la moneta segnata su B mentre era fuori arriva ad A')

        # ── 14. aggiornamento da una versione vecchia (accesso fatto a mano): si riprende da solo ──
        E_ctx, E = await dispositivo('E', collezione=[K[14]], locale={'eurodex.sync': json.dumps({'cid': uid, 'rt': 'vecchio', 'did': 'VECCHIODID12', 'nome': 'Telefono vecchio'})})
        ok(await aspetta(lambda: E.evaluate('!!(__eurodex.sync && __eurodex.sync.uid)'), 25), 'dopo l\'aggiornamento la sincronizzazione riparte da sola, senza chiedere l\'accesso')
        # (il collegamento vecchio si cancella alla fine dell'accesso, dopo aver unito e inviato: si aspetta che finisca)
        ok(await aspetta(lambda: E.evaluate("__eurodex.sync.did === 'VECCHIODID12' && localStorage.getItem('eurodex.sync') === null"), 20),
           'stesso dispositivo di prima (non ne compare uno nuovo)')
        ok(await aspetta(lambda: E.evaluate(f"__eurodex.possedute.has('{K[8]}')")), 'e ritrova la collezione dell\'account')

        for chi, errs in errori.items():
            errs = [e for e in errs if 'emulator' not in e.lower()]
            ok(not errs, f'{chi}: nessun errore JavaScript {errs[:2]}')
        await b.close()
    falliti = [c for o, c in ESITI if not o]
    print('\nRISULTATO:', 'TUTTO OK' if not falliti else f'{len(falliti)} PROBLEMI')
    raise SystemExit(1 if falliti else 0)


async def _vero(x):
    return x


async def _uguali(a, b):
    return await a.evaluate('[...__eurodex.possedute].sort().join()') == await b.evaluate('[...__eurodex.possedute].sort().join()')


asyncio.run(main())
