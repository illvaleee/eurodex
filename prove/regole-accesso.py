"""Regole dell'accesso solo su approvazione (firebase/firestore.rules), provate sugli emulatori di Firebase come le
proverebbe chi prova a forzarle: richieste fatte a mano con il gettone di un utente, come farebbe un'app modificata.
Prima con il muro spento (tutto come prima), poi acceso da Valerio con l'interruttore (config/accesso), poi di nuovo
spento.
Si avvia dentro gli emulatori:
  firebase emulators:exec --only auth,firestore --project collezione-euro-24ecd "python3 prove/regole-accesso.py"
"""
import json
import os
import re
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


def richiesta(email, **altro):
    d = {'stato': 'in_attesa', 'nome': 'Mario', 'email': email, 'dispositivo': 'Pixel 6'}
    d.update(altro)
    return d


http('DELETE', f'http://127.0.0.1:8080/emulator/v1/projects/{P}/databases/(default)/documents')
VAL, t_val = utente('valerio', 'valerio@example.com')
MAR, t_mar = utente('mario', 'mario@example.com')
LUC, t_luc = utente('lucia', 'lucia@example.com')

print('— Muro spento: tutto come prima —')
carica_regole(VAL)
ok(scrivi(t_mar, f'collezioni/{MAR}/voci/f', {'e': {}}) == 200,
   'senza il documento dell\'interruttore chi non è approvato usa ancora la sincronizzazione')

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
ok(scrivi(t_mar, f'collezioni/{MAR}/voci/f', {'e': {}}) == 200, 'muro spento: Mario sincronizza come prima')
ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('mario@example.com', stato='approvato'), ora=['richiesta'], esiste=False) == 403,
   'nessuno si approva da solo nella richiesta')
ok(scrivi(t_mar, f'accessi/{LUC}', richiesta('mario@example.com'), ora=['richiesta'], esiste=False) == 403,
   'nessuno manda la richiesta per un altro')
ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('altro@example.com'), ora=['richiesta'], esiste=False) == 403,
   'l\'email della richiesta deve essere quella dell\'account')
ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('mario@example.com', admin=True), ora=['richiesta'], esiste=False) == 403,
   'niente campi in più nella richiesta')
ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('mario@example.com', nome='x' * 81), ora=['richiesta'], esiste=False) == 403,
   'nome troppo lungo: rifiutato')
ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('mario@example.com'), esiste=False) == 403,
   'la data della richiesta la mette il server, non l\'app')
for cosa, valori in (('una @ nel nome (per fingersi un altro)', {'nome': 'Mamma (mamma.valerio@gmail.com)'}),
                    ('un carattere che rigira il testo nel nome', {'nome': 'Mario \u202eossoR'}),
                    ('un a capo nel nome', {'nome': 'Mario\nRossi'}),
                    ('una @ nel nome del telefono', {'dispositivo': 'Samsung (x@y.it)'})):
    ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('mario@example.com', **valori), ora=['richiesta'], esiste=False) == 403,
       f'{cosa}: rifiutato')
t_mar_pw = gettone_senza_firma(MAR, 'mario@example.com', True, metodo='password')
ok(scrivi(t_mar_pw, f'accessi/{MAR}', richiesta('mario@example.com'), ora=['richiesta'], esiste=False) == 403,
   'una richiesta da un accesso che non è Google: rifiutata')
ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('mario@example.com'), ora=['richiesta'], esiste=False) == 200,
   'la richiesta giusta passa ("in attesa")')
ok(scrivi(t_mar, f'accessi/{MAR}', {'stato': 'approvato'}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione']) == 403,
   'chi è in attesa non si approva da solo')
ok(scrivi(t_mar, f'accessi/{MAR}', richiesta('mario@example.com'), ora=['richiesta']) == 403,
   'la richiesta non si riscrive (una sola per account)')
ok(leggi(t_mar, f'accessi/{MAR}') == 200, 'ognuno vede la sua richiesta')
ok(scrivi(t_luc, f'accessi/{LUC}', richiesta('lucia@example.com', nome='Lucìa Pérez 🪙', dispositivo='Galaxy S24'),
          ora=['richiesta'], esiste=False) == 200, 'anche Lucia chiede (nome con accenti ed emoji: va bene)')
ok(leggi(t_mar, f'accessi/{LUC}') == 403, 'nessuno vede la richiesta degli altri')
ok(http('GET', f'{FS}/accessi', chi=t_mar)[0] == 403, 'solo Valerio vede l\'elenco delle richieste')
# lo stesso account di Valerio ma con un gettone che non ha l'email verificata (difesa in più: si entra solo con Google)
t_val_nv = gettone_senza_firma(VAL, 'valerio@example.com', verificata=False)
ok(http('GET', f'{FS}/accessi', chi=gettone_senza_firma(VAL, 'valerio@example.com', True))[0] == 200,
   '(controllo della prova: lo stesso gettone con l\'email verificata è amministratore)')
ok(http('GET', f'{FS}/accessi', chi=t_val_nv)[0] == 403, 'senza email verificata nemmeno l\'account di Valerio è amministratore')
ok(http('GET', f'{FS}/accessi', chi=gettone_senza_firma(VAL, 'valerio@example.com', True, metodo='password'))[0] == 403,
   'senza Google nemmeno l\'account di Valerio è amministratore')
st, j = http('GET', f'{FS}/accessi', chi=t_val)
ok(st == 200 and len(j.get('documents', [])) == 2, f'Valerio vede le richieste ({len(j.get("documents", []))})')
ok(scrivi(t_val, f'accessi/{MAR}', {'stato': 'approvato'}, esiste=True, maschera=['stato']) == 403,
   'anche per Valerio la data della decisione la mette il server')
ok(scrivi(t_val, f'accessi/{MAR}', {'stato': 'promosso'}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione']) == 403,
   'solo gli stati previsti')
ok(scrivi(t_val, f'accessi/{MAR}', {'nome': 'Altro'}, ora=['decisione'], esiste=True, maschera=['nome', 'decisione']) == 403,
   'Valerio non cambia nome ed email di chi chiede (solo lo stato e la sua nota)')
ok(scrivi(t_val, f'accessi/{MAR}', {'stato': 'approvato', 'nota': 'amico di Vale'}, ora=['decisione'], esiste=True,
          maschera=['stato', 'nota', 'decisione']) == 200, 'Valerio approva Mario, con una nota')
ok(scrivi(t_val, f'accessi/{LUC}', {'stato': 'rifiutato'}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione']) == 200,
   'Valerio rifiuta Lucia')
ok(scrivi(t_val, f'accessi/{VAL}', richiesta('valerio@example.com', nome='Valerio'), ora=['richiesta'], esiste=False) == 200
   and scrivi(t_val, f'accessi/{VAL}', {'stato': 'approvato'}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione']) == 200,
   'Valerio approva anche sé stesso')

print('— Muro acceso da Valerio —')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': True}, ora=['cambiato']) == 200, 'Valerio accende il muro')
ok(scrivi(t_mar, f'collezioni/{MAR}/voci/f', {'e': {}}) == 200 and leggi(t_mar, f'collezioni/{MAR}/voci/f') == 200,
   'Mario (approvato) sincronizza')
ok(leggi(t_mar, f'collezioni/{LUC}/voci/f') == 403, 'Mario non legge la collezione di Lucia')
ok(leggi(gettone_senza_firma(MAR, 'mario@example.com', True, metodo='password'), f'collezioni/{MAR}/voci/f') == 403,
   'Mario approvato, ma entrato senza Google: non legge la sua collezione')
ok(scrivi(t_luc, f'collezioni/{LUC}/voci/f', {'e': {}}) == 403 and leggi(t_luc, f'collezioni/{LUC}') == 403,
   'Lucia (rifiutata) non legge e non scrive niente')
ok(scrivi(t_luc, f'collezioni/{LUC}/eventi/e1', {'testo': 'ciao'}) == 403,
   'Lucia non fa partire notifiche (eventi)')
_, t_nuovo = utente('nuovo', 'nuovo@example.com')
ok(scrivi(t_nuovo, f'collezioni/nuovo/voci/f', {'e': {}}) == 403, 'un account senza richiesta non usa niente')
ok(scrivi(t_mar, f'accessi/{MAR}/dispositivi/telefono-mario', {'token': 'abc', 'nome': 'Pixel'}, ora=['aggiornato']) == 200,
   'Mario registra il suo telefono per le notifiche')
ok(scrivi(t_luc, f'accessi/{LUC}/dispositivi/telefono-lucia', {'token': 'abc', 'nome': 'Pixel'}, ora=['aggiornato']) == 403,
   'Lucia no')
ok(scrivi(t_val, f'collezioni/{VAL}/voci/f', {'e': {}}) == 200, 'Valerio usa la sua collezione')
ok(scrivi(t_val, f'accessi/{MAR}', {'stato': 'revocato'}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione']) == 200,
   'Valerio toglie l\'accesso a Mario')
ok(leggi(t_mar, f'collezioni/{MAR}/voci/f') == 403 and scrivi(t_mar, f'collezioni/{MAR}/voci/f', {'e': {}}) == 403,
   'la revoca ha effetto subito, con lo stesso gettone')
ok(leggi(t_mar, f'accessi/{MAR}/dispositivi/telefono-mario') == 403, 'e Mario non vede più nemmeno i suoi dispositivi')
ok(scrivi(t_val, f'accessi/{MAR}', {'stato': 'approvato'}, ora=['decisione'], esiste=True, maschera=['stato', 'decisione']) == 200
   and leggi(t_mar, f'collezioni/{MAR}/voci/f') == 200, 'Valerio ci ripensa: Mario torna dentro')

print('— Chi aspetta la risposta registra il telefono (per sapere quando è approvato) —')
UGO, t_ugo = utente('ugo', 'ugo@example.com')
ok(scrivi(t_ugo, f'accessi/{UGO}/dispositivi/telefono-ugo', {'token': 'abc', 'nome': 'Pixel'}, ora=['aggiornato']) == 403,
   'senza richiesta no')
ok(scrivi(t_ugo, f'accessi/{UGO}', richiesta('ugo@example.com', nome='Ugo'), ora=['richiesta'], esiste=False) == 200,
   'Ugo chiede l\'accesso col muro acceso')
ok(scrivi(t_ugo, f'accessi/{UGO}/dispositivi/telefono-ugo', {'token': 'abc', 'nome': 'Pixel'}, ora=['aggiornato']) == 200,
   'in attesa registra il suo telefono')
ok(scrivi(t_ugo, f'collezioni/{UGO}/voci/f', {'e': {}}) == 403, 'ma non usa la sincronizzazione finché non è approvato')
ok(scrivi(t_mar, f'accessi/{UGO}/dispositivi/telefono-mario', {'token': 'abc', 'nome': 'Pixel'}, ora=['aggiornato']) == 403,
   'nessuno registra telefoni nella richiesta di un altro')

print('— Valerio spegne il muro: tutto come prima —')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': False}, ora=['cambiato']) == 200, 'Valerio spegne il muro')
ok(scrivi(t_luc, f'collezioni/{LUC}/voci/f', {'e': {}}) == 200, 'anche Lucia (rifiutata) torna a sincronizzare')
ok(scrivi(t_val, 'config/accesso', {'obbligatorio': True}, ora=['cambiato']) == 200
   and scrivi(t_luc, f'collezioni/{LUC}/voci/f', {'e': {}}) == 403, 'riacceso: Lucia di nuovo fuori, subito')

print('RISULTATO:', 'TUTTO OK' if not fallite else f'{len(fallite)} PROBLEMI')
raise SystemExit(1 if fallite else 0)
