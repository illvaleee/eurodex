"""Le funzioni dell'accesso (firebase/functions) sugli emulatori, con le regole vere: ogni accesso con Google è un
tentativo; l'account nuovo diventa una richiesta in attesa, quello già deciso resta com'è (approvato o rifiutato in
automatico) e Valerio riceve la notifica, al massimo una al minuto per account. Le notifiche vere non partono (negli
emulatori non c'è Cloud Messaging): qui si controlla quello che le funzioni scrivono.
Si avvia dentro gli emulatori, con quello delle funzioni:
  firebase emulators:exec --only auth,firestore,functions --project collezione-euro-24ecd \
      "python3 prove/funzioni-accesso.py"
"""
import json
import time
import urllib.error
import urllib.request

P = 'collezione-euro-24ecd'
BASE = f'projects/{P}/databases/(default)/documents'
FS = f'http://127.0.0.1:8080/v1/{BASE}'
AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
AUTH_ADMIN = f'{AUTH}/projects/{P}'
fallite = []


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m, flush=True)
    if not c:
        fallite.append(m)


def http(metodo, url, corpo=None, chi='owner'):
    intestazioni = {'Content-Type': 'application/json'}
    if chi:
        intestazioni['Authorization'] = f'Bearer {chi}'
    req = urllib.request.Request(url, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers=intestazioni)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, {}


def utente(sub, email, nome):
    g = json.dumps({'sub': sub, 'email': email, 'email_verified': True, 'name': nome})
    st, j = http('POST', f'{AUTH}/accounts:signInWithIdp?key=prova',
                 {'postBody': f'id_token={g}&providerId=google.com', 'requestUri': 'http://localhost',
                  'returnSecureToken': True}, chi='')
    assert st == 200, f'accesso di prova non riuscito ({st})'
    return j['localId'], j['idToken']


def tentativo(chi, uid, motivo='accesso', dispositivo='Pixel 7'):
    corpo = {'writes': [{
        'update': {'name': f'{BASE}/accessi/{uid}/tentativi/t{time.time_ns()}',
                   'fields': {'dispositivo': {'stringValue': dispositivo}, 'motivo': {'stringValue': motivo}}},
        'updateTransforms': [{'fieldPath': 'quando', 'setToServerValue': 'REQUEST_TIME'}],
        'currentDocument': {'exists': False}}]}
    return http('POST', f'{FS}:commit', corpo, chi)[0]


def richiesta(uid):
    st, j = http('GET', f'{FS}/accessi/{uid}')
    if st != 200:
        return None
    out = {}
    for k, v in j.get('fields', {}).items():
        out[k] = v.get('stringValue', v.get('integerValue', v.get('timestampValue', v.get('booleanValue'))))
    return out


def tentativi_rimasti(uid):
    st, j = http('GET', f'{FS}/accessi/{uid}/tentativi')
    return len(j.get('documents', [])) if st == 200 else -1


def aspetta(f, secondi=40):
    fine = time.time() + secondi
    while time.time() < fine:
        v = f()
        if v:
            return v
        time.sleep(0.5)
    return None


def decide(uid, stato):
    corpo = {'writes': [{'update': {'name': f'{BASE}/accessi/{uid}', 'fields': {'stato': {'stringValue': stato}}},
                         'updateMask': {'fieldPaths': ['stato']}}]}
    return http('POST', f'{FS}:commit', corpo)[0]


def rimetti_avvisato_vecchio(uid):
    """Come se l'ultima notifica fosse di due minuti fa (per provare il limite di una al minuto senza aspettare)."""
    vecchio = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 120))
    corpo = {'writes': [{'update': {'name': f'{BASE}/accessi/{uid}', 'fields': {'avvisato': {'timestampValue': vecchio}}},
                         'updateMask': {'fieldPaths': ['avvisato']}}]}
    return http('POST', f'{FS}:commit', corpo)[0]


def ultimo_tentativo(uid, secondi_fa):
    """Come se l'ultimo tentativo registrato dalla funzione fosse di `secondi_fa` secondi fa: le regole ne accettano al
    massimo uno ogni 20 secondi per account, e così la prova non aspetta."""
    quando = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - secondi_fa))
    corpo = {'writes': [{'update': {'name': f'{BASE}/accessi/{uid}', 'fields': {'ultimoTentativo': {'timestampValue': quando}}},
                         'updateMask': {'fieldPaths': ['ultimoTentativo']}}]}
    return http('POST', f'{FS}:commit', corpo)[0]


http('DELETE', f'http://127.0.0.1:8080/emulator/v1/projects/{P}/databases/(default)/documents')
http('DELETE', f'http://127.0.0.1:9099/emulator/v1/projects/{P}/accounts')
MAR, t_mar = utente('mario', 'mario@example.com', 'Mario Bianchi')

# ── account nuovo: la funzione crea la richiesta, con nome ed email veri (da Authentication) ──
ok(tentativo(t_mar, MAR, dispositivo='Oppo Find X5') == 200, 'Mario accede: il tentativo parte')
r = aspetta(lambda: richiesta(MAR))
ok(r is not None, 'la funzione crea la richiesta')
r = r or {}
ok(r.get('stato') == 'in_attesa', f'in attesa ({r.get("stato")})')
ok(r.get('email') == 'mario@example.com' and r.get('nome') == 'Mario Bianchi', 'con email e nome veri dell\'account')
ok(r.get('dispositivo') == 'Oppo Find X5' and str(r.get('tentativi')) == '1', 'il telefono e un tentativo')
ok(bool(r.get('richiesta')) and bool(r.get('ultimoTentativo')) and bool(r.get('avvisato')), 'con le date (richiesta, tentativo, notifica)')
ok(aspetta(lambda: tentativi_rimasti(MAR) == 0, 20) is not None, 'il tentativo si cancella dopo')

# ── Valerio approva; Mario riaccede (per esempio dopo una reinstallazione): resta approvato ──
ok(decide(MAR, 'approvato') == 200, 'Valerio approva Mario')
avvisato_prima = (richiesta(MAR) or {}).get('avvisato')
ok(ultimo_tentativo(MAR, 0) == 200 and tentativo(t_mar, MAR, dispositivo='Pixel 8') == 403,
   'subito dopo un tentativo, il server ne rifiuta un altro (al massimo uno ogni 20 secondi per account)')
ok(ultimo_tentativo(MAR, 30) == 200, '(come se fossero passati 20 secondi)')
ok(tentativo(t_mar, MAR, dispositivo='Pixel 8') == 200, 'Mario riaccede da un altro telefono')
r = aspetta(lambda: (lambda x: x if x and str(x.get('tentativi')) == '2' else None)(richiesta(MAR))) or {}
ok(r.get('stato') == 'approvato', 'resta approvato (approvato in automatico)')
ok(r.get('dispositivo') == 'Pixel 8', 'con il telefono nuovo')
ok(r.get('avvisato') == avvisato_prima, 'appena dopo un\'altra notifica: niente (al massimo una al minuto)')
ok(rimetti_avvisato_vecchio(MAR) == 200, '(come se fosse passato un minuto)')
vecchio = (richiesta(MAR) or {}).get('avvisato')
ok(ultimo_tentativo(MAR, 30) == 200, '(e 20 secondi dopo il tentativo)')
ok(tentativo(t_mar, MAR) == 200, 'Mario riaccede ancora')
r = aspetta(lambda: (lambda x: x if x and x.get('avvisato') != vecchio else None)(richiesta(MAR))) or {}
ok(bool(r) and str(r.get('tentativi')) == '3', 'passato il minuto la notifica a Valerio parte (approvato in automatico)')

# ── Valerio toglie l'accesso; Mario ritenta ("Chiedi di nuovo"): resta fuori, e Valerio lo sa ──
ok(decide(MAR, 'revocato') == 200, 'Valerio toglie l\'accesso a Mario')
time.sleep(2)
ok(rimetti_avvisato_vecchio(MAR) == 200, '(un minuto dopo)')
vecchio = (richiesta(MAR) or {}).get('avvisato')
ok(ultimo_tentativo(MAR, 30) == 200, '(e 20 secondi dopo il tentativo)')
ok(tentativo(t_mar, MAR, motivo='ancora') == 200, 'Mario chiede di nuovo, con lo stesso account')
r = aspetta(lambda: (lambda x: x if x and x.get('avvisato') != vecchio else None)(richiesta(MAR))) or {}
ok(r.get('stato') == 'revocato', 'resta fuori (rifiutato in automatico)')
ok(bool(r), 'e a Valerio parte la notifica')

# ── l'account di Valerio non finisce mai nell'elenco ──
VAL = open('firebase/functions/.env', encoding='utf-8').read().split('ADMIN_UID=')[1].split()[0]
st, _ = http('POST', f'{AUTH_ADMIN}/accounts:batchCreate', {'users': [{
    'localId': VAL, 'email': 'valerio@example.com', 'emailVerified': True, 'displayName': 'Valerio',
    'providerUserInfo': [{'providerId': 'google.com', 'rawId': 'vale-g', 'email': 'valerio@example.com'}]}]})
g = json.dumps({'sub': 'vale-g', 'email': 'valerio@example.com', 'email_verified': True, 'name': 'Valerio'})
st, j = http('POST', f'{AUTH}/accounts:signInWithIdp?key=prova', {'postBody': f'id_token={g}&providerId=google.com',
                                                                  'requestUri': 'http://localhost', 'returnSecureToken': True}, chi='')
ok(st == 200 and j.get('localId') == VAL, '(Valerio con il suo UID vero)')
ok(tentativo(j.get('idToken', ''), VAL) == 200, 'Valerio accede')
ok(aspetta(lambda: tentativi_rimasti(VAL) == 0, 20) is not None and richiesta(VAL) is None,
   'il suo tentativo si cancella, senza richiesta né notifica')

print('RISULTATO:', 'TUTTO OK' if not fallite else f'{len(fallite)} PROBLEMI')
raise SystemExit(1 if fallite else 0)
