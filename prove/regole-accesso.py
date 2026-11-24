"""Regole dell'accesso solo su approvazione (firebase/firestore.rules), provate sugli emulatori di Firebase come le
proverebbe chi prova a forzarle: richieste fatte a mano con il gettone di un utente, come farebbe un'app modificata.
Ogni accesso con Google è un tentativo (accessi/{uid}/tentativi): la richiesta (accessi/{uid}) la crea solo la
funzione, qui simulata con l'accesso da amministratore dell'emulatore ("owner"). Prima con il muro spento (tutti
tranne gli esclusi), poi acceso da Valerio con l'interruttore (config/accesso), poi di nuovo spento.
Si avvia dentro gli emulatori:
  firebase emulators:exec --only auth,firestore --project collezione-euro-24ecd "python3 prove/regole-accesso.py"
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

P = 'collezione-euro-24ecd'
BASE = f'projects/{P}/databases/(default)/documents'
FS = f'http://127.0.0.1:8080/v1/{BASE}'
AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
REGOLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'firebase', 'firestore.rules')
fallite = []


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m, flush=True)
    if not c:
        fallite.append(m)


def http(metodo, url, corpo=None, chi='owner'):
    intestazioni = {'Content-Type': 'application/json'}
    if chi:   # chi='' vuol dire senza accesso (nessun gettone)
        intestazioni['Authorization'] = f'Bearer {chi}'
    req = urllib.request.Request(url, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers=intestazioni)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, {}


def utente(sub, email, verificata=True):
    """Accesso con Google (finto: l'emulatore di Authentication accetta il gettone senza firma)."""
    g = json.dumps({'sub': sub, 'email': email, 'email_verified': verificata, 'name': sub})
    st, j = http('POST', f'{AUTH}/accounts:signInWithIdp?key=prova',
                 {'postBody': f'id_token={g}&providerId=google.com', 'requestUri': 'http://localhost',
                  'returnSecureToken': True})
    assert st == 200, f'accesso di prova non riuscito ({st})'
    return j['localId'], j['idToken']


def gettone_senza_firma(uid, email, verificata, metodo='google.com'):
    """Un gettone costruito a mano, come lo costruirebbe chi prova a ingannare le regole: l'emulatore di Firestore
    non controlla la firma (il server vero sì), quindi qui si prova solo cosa dicono le regole."""
    import base64, time
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
    ora = int(time.time())
    corpo = {'iss': f'https://securetoken.google.com/{P}', 'aud': P, 'sub': uid, 'user_id': uid, 'email': email,
             'email_verified': verificata, 'iat': ora, 'exp': ora + 3600, 'auth_time': ora,
             'firebase': {'sign_in_provider': metodo, 'identities': {}}}
    return f"{b({'alg': 'none', 'typ': 'JWT'})}.{b(corpo)}."


def carica_regole(admin_uid):
    """Le regole vere, con l'UID di Valerio sostituito da quello dell'utente di prova che fa da Valerio."""
    testo = open(REGOLE, encoding='utf-8').read()
    vero = re.findall(r"request\.auth\.uid == '([A-Za-z0-9]{20,40})'", testo)
    assert len(vero) == 1, f'UID di Valerio nelle regole: {vero}'
    testo = testo.replace(f"'{vero[0]}'", f"'{admin_uid}'")
    st, _ = http('PUT', f'http://127.0.0.1:8080/emulator/v1/projects/{P}:securityRules',
                 {'rules': {'files': [{'name': 'firestore.rules', 'content': testo}]}})
    assert st == 200, f'regole non caricate ({st})'


def campi(d):
    def v(x):
        if isinstance(x, bool):
            return {'booleanValue': x}
        if isinstance(x, int):
            return {'integerValue': str(x)}
        if isinstance(x, dict):
            return {'mapValue': {'fields': campi(x)}}
        return {'stringValue': str(x)}
    return {k: v(x) for k, x in d.items()}


def scrivi(chi, percorso, dati, ora=None, esiste=None, maschera=None):
    """Una scrittura come la fa l'SDK: con l'istante del server (serverTimestamp) nei campi in `ora`."""
    w = {'update': {'name': f'{BASE}/{percorso}', 'fields': campi(dati)}}
    if ora:
        w['updateTransforms'] = [{'fieldPath': f, 'setToServerValue': 'REQUEST_TIME'} for f in ora]
    if esiste is not None:
        w['currentDocument'] = {'exists': esiste}
    if maschera is not None:
        w['updateMask'] = {'fieldPaths': maschera}
    st, _ = http('POST', f'{FS}:commit', {'writes': [w]}, chi)
    return st


def leggi(chi, percorso):
    return http('GET', f'{FS}/{percorso}', chi=chi)[0]


def tentativo(chi, uid, **altro):
    d = {'dispositivo': 'Pixel 6', 'motivo': 'accesso'}
    d.update(altro)
    # ogni tentativo è un documento nuovo, come quelli dell'app (che crea, non sovrascrive): con lo stesso nome due volte
    # la seconda scrittura sarebbe una modifica, rifiutata per un altro motivo, e la prova passerebbe a vuoto
    return scrivi(chi, f'accessi/{uid}/tentativi/t{time.time_ns()}', d, ora=['quando'], esiste=False)


def richiesta_della_funzione(uid, email, stato='in_attesa'):
    """Quello che fa tentativoDiAccesso per un account nuovo (con l'SDK Admin, senza regole)."""
    return scrivi('owner', f'accessi/{uid}', {'stato': stato, 'nome': 'X', 'email': email, 'dispositivo': 'Pixel 6',
                                              'tentativi': 1}, ora=['richiesta', 'ultimoTentativo'], esiste=False)


def ultimo_tentativo(uid, secondi_fa):
    """Come se la funzione avesse registrato l'ultimo tentativo `secondi_fa` secondi fa (con l'SDK Admin): per provare
    il limite di un tentativo ogni 20 secondi senza aspettare."""
    quando = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - secondi_fa))
    w = {'update': {'name': f'{BASE}/accessi/{uid}', 'fields': {'ultimoTentativo': {'timestampValue': quando}}},
         'updateMask': {'fieldPaths': ['ultimoTentativo']}, 'currentDocument': {'exists': True}}
    return http('POST', f'{FS}:commit', {'writes': [w]}, 'owner')[0]


def decide(stato, uid):
    return scrivi(t_val, f'accessi/{uid}', {'stato': stato}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione'])


def telefono(chi, uid, did='telefono-di-prova'):
    return scrivi(chi, f'accessi/{uid}/dispositivi/{did}', {'token': 'f' * 40, 'nome': 'Pixel'}, ora=['aggiornato'])


usa = lambda chi, uid: scrivi(chi, f'collezioni/{uid}/voci/f', {'e': {}}) == 200 and leggi(chi, f'collezioni/{uid}/voci/f') == 200
fuori = lambda chi, uid: scrivi(chi, f'collezioni/{uid}/voci/f', {'e': {}}) == 403 and leggi(chi, f'collezioni/{uid}/voci/f') == 403

http('DELETE', f'http://127.0.0.1:8080/emulator/v1/projects/{P}/databases/(default)/documents')
VAL, t_val = utente('valerio', 'valerio@example.com')
MAR, t_mar = utente('mario', 'mario@example.com')
LUC, t_luc = utente('lucia', 'lucia@example.com')
UGO, t_ugo = utente('ugo', 'ugo@example.com')
ADA, t_ada = utente('ada', 'ada@example.com')
carica_regole(VAL)

print('— Muro spento, senza interruttore: tutto come prima —')
ok(usa(t_mar, MAR), 'senza il documento dell\'interruttore chi non ha richiesta usa la sincronizzazione')

print('— L\'interruttore del muro (config/accesso) —')
ok(leggi('', 'config/accesso') in (200, 404), 'l\'interruttore si legge anche senza accesso (dice solo sì o no)')
ok(scrivi(t_mar, 'config/accesso', {'obbligatorio': True}, ora=['cambiato']) == 403, 'Mario non accende il muro')
ok(scrivi('', 'config/accesso', {'obbligatorio': True}, ora=['cambiato']) == 403, 'senza accesso nemmeno')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': False}) == 403, 'anche per Valerio la data la mette il server')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': 'sì'}, ora=['cambiato']) == 403, 'solo sì o no (booleano)')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': False, 'chi': 'x'}, ora=['cambiato']) == 403, 'niente campi in più')
ok(scrivi(gettone_senza_firma(VAL, 'valerio@example.com', False), 'config/accesso', {'obbligatorio': False},
          ora=['cambiato']) == 403, 'senza email verificata nemmeno l\'account di Valerio')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': False}, ora=['cambiato']) == 200, 'Valerio scrive l\'interruttore spento')
ok(leggi('', 'config/accesso') == 200 and leggi(t_mar, 'config/accesso') == 200, 'e tutti lo leggono')
ok(http('GET', f'{FS}/config', chi=t_val)[0] == 403, 'la raccolta config non si elenca')

print('— Le richieste le crea solo la funzione —')
for chi, cosa in ((t_mar, 'Mario'), (t_val, 'nemmeno Valerio')):
    ok(scrivi(chi, f'accessi/{MAR}', {'stato': 'in_attesa', 'nome': 'Mario', 'email': 'mario@example.com',
                                      'dispositivo': 'Pixel 6'}, ora=['richiesta'], esiste=False) == 403,
       f'{cosa}: nessuna richiesta scritta dall\'app')
ok(scrivi(t_mar, f'accessi/{MAR}', {'stato': 'approvato'}, ora=['richiesta'], esiste=False) == 403,
   'nessuno si approva da solo')

print('— I tentativi di accesso —')
ok(tentativo(t_mar, MAR) == 200, 'Mario manda il suo tentativo (telefono e motivo)')
ok(tentativo(t_mar, MAR, motivo='ancora', dispositivo='Lucìa Pérez 🪙 Galaxy') == 200, 'chiede di nuovo (accenti ed emoji: va bene)')
ok(tentativo(t_mar, MAR, motivo='primo') == 200, 'primo controllo dopo l\'aggiornamento')
ok(tentativo(t_mar, LUC) == 403, 'nessuno manda tentativi per un altro')
ok(tentativo('', MAR) == 403, 'senza accesso nemmeno')
ok(tentativo(gettone_senza_firma(MAR, 'mario@example.com', True, metodo='password'), MAR) == 403,
   'un accesso che non è Google: rifiutato')
ok(tentativo(t_mar, MAR, motivo='approvami') == 403, 'solo i motivi previsti')
ok(tentativo(t_mar, MAR, stato='approvato') == 403, 'niente campi in più (nemmeno uno stato)')
ok(tentativo(t_mar, MAR, dispositivo='x' * 81) == 403, 'telefono troppo lungo: rifiutato')
for cosa, valori in (('una @ nel telefono (per fingersi un altro)', {'dispositivo': 'Mamma (mamma.valerio@gmail.com)'}),
                    ('un carattere che rigira il testo', {'dispositivo': 'Pixel ‮6'}),
                    ('un a capo', {'dispositivo': 'Pixel\n6'})):
    ok(tentativo(t_mar, MAR, **valori) == 403, f'{cosa}: rifiutato')
ok(scrivi(t_mar, f'accessi/{MAR}/tentativi/senza-ora', {'dispositivo': 'Pixel', 'motivo': 'accesso', 'quando': 'adesso'}) == 403,
   'l\'ora del tentativo la mette il server')
ok(leggi(t_mar, f'accessi/{MAR}/tentativi/senza-ora') == 403 and http('GET', f'{FS}/accessi/{MAR}/tentativi', chi=t_mar)[0] == 403,
   'i tentativi non si leggono (li legge solo la funzione)')

print('— Le richieste (create dalla funzione) e le decisioni di Valerio —')
ok(richiesta_della_funzione(MAR, 'mario@example.com') == 200 and richiesta_della_funzione(LUC, 'lucia@example.com') == 200,
   '(la funzione crea le richieste di Mario e Lucia)')
ok(leggi(t_mar, f'accessi/{MAR}') == 200, 'ognuno vede la sua richiesta')
ok(leggi(t_mar, f'accessi/{LUC}') == 403, 'nessuno vede la richiesta degli altri')
ok(scrivi(t_mar, f'accessi/{MAR}', {'stato': 'approvato'}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione']) == 403,
   'chi è in attesa non si approva da solo')
ok(http('GET', f'{FS}/accessi', chi=t_mar)[0] == 403, 'solo Valerio vede l\'elenco delle richieste')
ok(http('GET', f'{FS}/accessi', chi=gettone_senza_firma(VAL, 'valerio@example.com', True))[0] == 200,
   '(controllo della prova: lo stesso gettone con l\'email verificata è amministratore)')
ok(http('GET', f'{FS}/accessi', chi=gettone_senza_firma(VAL, 'valerio@example.com', verificata=False))[0] == 403,
   'senza email verificata nemmeno l\'account di Valerio è amministratore')
ok(http('GET', f'{FS}/accessi', chi=gettone_senza_firma(VAL, 'valerio@example.com', True, metodo='password'))[0] == 403,
   'senza Google nemmeno l\'account di Valerio è amministratore')
st, j = http('GET', f'{FS}/accessi', chi=t_val)
ok(st == 200 and len(j.get('documents', [])) == 2, f'Valerio vede le richieste ({len(j.get("documents", []))})')
ok(scrivi(t_val, f'accessi/{MAR}', {'stato': 'approvato'}, esiste=True, maschera=['stato']) == 403,
   'anche per Valerio la data della decisione la mette il server')
ok(decide('promosso', MAR) == 403, 'solo gli stati previsti')
ok(scrivi(t_val, f'accessi/{MAR}', {'nome': 'Altro'}, ora=['decisione'], esiste=True, maschera=['nome', 'decisione']) == 403,
   'Valerio non cambia nome ed email di chi chiede (solo lo stato e la sua nota)')
ok(scrivi(t_val, f'accessi/{MAR}', {'stato': 'approvato', 'nota': 'amico di Vale'}, ora=['decisione'], esiste=True,
          maschera=['stato', 'nota', 'decisione']) == 200, 'Valerio approva Mario, con una nota')
ok(decide('rifiutato', LUC) == 200, 'Valerio rifiuta Lucia')

print('— Al massimo un tentativo ogni 20 secondi per account (limite di costo) —')
ok(ultimo_tentativo(MAR, 0) == 200 and tentativo(t_mar, MAR) == 403,
   'subito dopo un tentativo registrato dalla funzione: rifiutato')
ok(tentativo(t_mar, MAR, motivo='ancora', dispositivo='Pixel 8') == 403, 'anche da un altro telefono o con un altro motivo')
ok(ultimo_tentativo(MAR, 12) == 200 and tentativo(t_mar, MAR) == 403, 'dopo 12 secondi ancora no')
ok(ultimo_tentativo(MAR, 21) == 200 and tentativo(t_mar, MAR) == 200, 'dopo 20 secondi sì')
ok(ultimo_tentativo(LUC, 0) == 200 and tentativo(t_mar, MAR) == 200, 'il limite è per account: Lucia non blocca Mario')
ok(tentativo(t_luc, LUC) == 403 and ultimo_tentativo(LUC, 30) == 200 and tentativo(t_luc, LUC, motivo='ancora') == 200,
   'anche per chi è rifiutato: dopo 20 secondi può chiedere di nuovo')
ok(scrivi('owner', f'accessi/{ADA}', {'stato': 'in_attesa', 'nome': 'Ada', 'email': 'ada@example.com', 'tentativi': 1},
          ora=['richiesta'], esiste=False) == 200 and tentativo(t_ada, ADA) == 200,
   'una richiesta senza l\'ora dell\'ultimo tentativo (fatta prima del limite) non blocca')
ok(tentativo(t_ugo, UGO) == 200 and tentativo(t_ugo, UGO, motivo='primo') == 200,
   'senza richiesta (account nuovo) nessun limite: la richiesta non c\'è ancora')

print('— I telefoni per le notifiche: ognuno i suoi, qualunque sia lo stato —')
ok(telefono(t_mar, MAR) == 200, 'Mario (approvato) registra il suo telefono')
ok(telefono(t_luc, LUC) == 200, 'anche Lucia (rifiutata): saprà se Valerio poi la approva')
ok(telefono(t_ugo, UGO) == 200, 'e Ugo, che non ha ancora la richiesta')
ok(telefono(t_mar, UGO, 'telefono-mario') == 403, 'nessuno registra telefoni nella richiesta di un altro')
ok(telefono(gettone_senza_firma(UGO, 'ugo@example.com', True, metodo='password'), UGO) == 403, 'senza Google no')
ok(scrivi(t_mar, f'accessi/{MAR}/dispositivi/telefono-di-prova', {'token': 'f' * 40, 'nome': 'Pixel', 'chi': 'x'},
          ora=['aggiornato']) == 403, 'niente campi in più')
ok(leggi(t_luc, f'accessi/{LUC}/dispositivi/telefono-di-prova') == 200 and leggi(t_luc, f'accessi/{MAR}/dispositivi/telefono-di-prova') == 403,
   'ognuno vede solo i suoi telefoni')

print('— Muro spento: tutti tranne gli esclusi (scelta di Valerio del 21/11) —')
ok(usa(t_mar, MAR), 'Mario (approvato) sincronizza')
ok(usa(t_ugo, UGO), 'Ugo, senza richiesta, sincronizza come prima')
ok(fuori(t_luc, LUC), 'Lucia (rifiutata) resta fuori anche con il muro spento')
ok(scrivi(t_luc, f'collezioni/{LUC}/eventi/e1', {'testo': 'ciao'}) == 403, 'e non fa partire notifiche (eventi)')
ok(usa(t_val, VAL), 'Valerio usa la sua collezione')

print('— Valerio vede i telefoni di tutti (dove è collegato ogni account) —')
ok(scrivi(t_mar, f'collezioni/{MAR}/dispositivi/d1', {'nome': 'Pixel di Mario', 'ultimo': 1}) == 200,
   '(il telefono di Mario si registra nella sua collezione)')
ok(leggi(t_val, f'collezioni/{MAR}/dispositivi/d1') == 200 and http('GET', f'{FS}/collezioni/{MAR}/dispositivi', chi=t_val)[0] == 200,
   'Valerio li vede')
ok(scrivi(t_val, f'collezioni/{MAR}/dispositivi/d1', {'nome': 'x'}) == 403, 'ma non li cambia')
ok(leggi(t_ugo, f'collezioni/{MAR}/dispositivi/d1') == 403, 'gli altri no')
ok(leggi(t_val, f'collezioni/{MAR}/voci/f') == 403, 'e la collezione degli altri non la legge nemmeno Valerio')

print('— Muro acceso da Valerio —')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': True}, ora=['cambiato']) == 200, 'Valerio accende il muro')
ok(usa(t_mar, MAR), 'Mario (approvato) sincronizza')
ok(leggi(t_mar, f'collezioni/{LUC}/voci/f') == 403, 'Mario non legge la collezione di Lucia')
ok(leggi(gettone_senza_firma(MAR, 'mario@example.com', True, metodo='password'), f'collezioni/{MAR}/voci/f') == 403,
   'Mario approvato, ma entrato senza Google: non legge la sua collezione')
ok(fuori(t_luc, LUC), 'Lucia (rifiutata) non legge e non scrive niente')
ok(fuori(t_ugo, UGO), 'Ugo, senza richiesta, nemmeno')
ok(richiesta_della_funzione(UGO, 'ugo@example.com') == 200 and fuori(t_ugo, UGO),
   'Ugo in attesa: ancora fuori finché Valerio non lo approva')
ok(scrivi(t_ugo, f'collezioni/{UGO}/eventi/e1', {'testo': 'ciao'}) == 403, 'e non fa partire notifiche')
ok(telefono(t_ugo, UGO, 'altro-telefono-ugo') == 200, 'però registra il telefono, per sapere quando è approvato')
ok(usa(t_val, VAL), 'Valerio usa la sua collezione (anche senza richiesta)')
ok(decide('revocato', MAR) == 200, 'Valerio toglie l\'accesso a Mario')
ok(fuori(t_mar, MAR), 'la revoca ha effetto subito, con lo stesso gettone')
ok(ultimo_tentativo(MAR, 30) == 200 and tentativo(t_mar, MAR, motivo='ancora') == 200,
   'Mario può comunque ritentare (Valerio ne riceve la notifica)')
ok(decide('approvato', MAR) == 200 and usa(t_mar, MAR), 'Valerio ci ripensa: Mario torna dentro')
ok(decide('approvato', LUC) == 200 and usa(t_luc, LUC), 'e approva anche Lucia, che aveva rifiutato')

print('— Valerio spegne il muro —')
ok(decide('revocato', LUC) == 200, 'Valerio toglie l\'accesso a Lucia')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': False}, ora=['cambiato']) == 200, 'Valerio spegne il muro')
ok(fuori(t_luc, LUC), 'Lucia (accesso tolto) resta fuori anche con il muro spento')
ok(usa(t_ugo, UGO) and usa(t_mar, MAR), 'gli altri dentro (Ugo in attesa, Mario approvato)')

print('RISULTATO:', 'TUTTO OK' if not fallite else f'{len(fallite)} PROBLEMI')
raise SystemExit(1 if fallite else 0)
