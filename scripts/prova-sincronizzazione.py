# Prova reale del server della sincronizzazione, fatta come la fa l'app (senza account, solo con il codice):
# 1) scrive una collezione di prova e un "evento"; 2) controlla che il postino lo prenda e lo cancelli
# (= notifica mandata); 3) controlla che le regole blocchino chi non ha il codice. Alla fine pulisce.
import json, random, string, sys, time, urllib.request, urllib.error
import os
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession
from google.auth import crypt, jwt
P = 'collezione-euro-24ecd'
CHIAVE = json.load(open('native/google-services.json'))['client'][0]['api_key'][0]['current_key']
DOCS = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'
SA = json.load(open(os.environ.get('FIREBASE_SA_FILE', 'keystore/firebase-invio.json')))
# un utente di prova (come uno che ha fatto "Accedi con Google"), creato con un gettone firmato dal server
def utente(uid):
    ora = int(time.time())
    tok = jwt.encode(crypt.RSASigner.from_service_account_info(SA), {'iss': SA['client_email'], 'sub': SA['client_email'], 'uid': uid, 'iat': ora, 'exp': ora + 3600,
        'aud': 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'}).decode()
    rq = urllib.request.Request(f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={CHIAVE}', data=json.dumps({'token': tok, 'returnSecureToken': True}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(rq, timeout=20) as r: return json.loads(r.read())['idToken']
cid = 'prova' + ''.join(random.choice(string.ascii_letters + string.digits) for _ in range(23))
altro = 'prova' + ''.join(random.choice(string.ascii_letters + string.digits) for _ in range(23))
GET = {'t': None}
nome = lambda rel: f'projects/{P}/databases/(default)/documents/collezioni/{cid}/{rel}'
def app(metodo, url, corpo=None, gettone=True):   # come l'app: con il gettone di chi ha fatto l'accesso
    h = {'Content-Type': 'application/json', 'Origin': 'https://localhost'}
    t = GET['t'] if gettone is True else gettone
    if t: h['Authorization'] = 'Bearer ' + t
    rq = urllib.request.Request(url, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None, headers=h)
    try:
        with urllib.request.urlopen(rq, timeout=20) as r: return r.status, json.loads(r.read() or b'{}'), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, (e.read() or b'')[:300].decode('utf8', 'replace'), {}
errori = []
def ok(c, m): print(('✓ ' if c else '✗ ') + m); c or errori.append(m)
GET['t'] = utente(cid); t_altro = utente(altro)
print('✓ utenti di prova creati (accesso come con Google)')
ora = int(time.time() * 1000)
s, r, h = app('POST', f'{DOCS}:commit', {'writes': [
    {'update': {'name': f'projects/{P}/databases/(default)/documents/collezioni/{cid}', 'fields': {'creata': {'integerValue': str(ora)}}}},
    {'update': {'name': nome('stato/possedute'), 'fields': {'p': {'mapValue': {'fields': {'73-617': {'integerValue': str(ora)}}}}}}, 'updateMask': {'fieldPaths': ['p.`73-617`']}},
    {'update': {'name': nome('dispositivi/PROVAPROVA12'), 'fields': {'nome': {'stringValue': 'Prova'}, 'ultimo': {'integerValue': str(ora)}}}},
    {'update': {'name': nome('eventi/prova' + str(ora)), 'fields': {'did': {'stringValue': 'PROVAPROVA12'}, 'nome': {'stringValue': 'Prova automatica'}, 'ts': {'integerValue': str(ora)}, 'testo': {'stringValue': 'Prova del postino (nessuno la riceve)'}}}},
]})
ok(s == 200, f'l\'app scrive la collezione dell\'account ({s} {r if s != 200 else ""})')
print('   CORS per l\'app:', h.get('Access-Control-Allow-Origin') or h.get('access-control-allow-origin') or '(nessuna intestazione)')
# formato attuale (dalla versione con l'orologio logico): voci divise in pochi documenti
voce = {'mapValue': {'fields': {'e': {'mapValue': {'fields': {'73-617': {'mapValue': {'fields': {'v': {'booleanValue': True}, 't': {'stringValue': '00000000a-0000-PROVA'}}}}}}}}}}
s, r, _ = app('PATCH', f'{DOCS}/collezioni/{cid}/voci/p3', {'fields': voce['mapValue']['fields']})
ok(s == 200, f'l\'app scrive le voci della collezione (formato attuale) ({s})')
s, _, _ = app('PATCH', f'{DOCS}/collezioni/{cid}/voci/qualsiasi', {'fields': voce['mapValue']['fields']})
ok(s == 403, f'le regole accettano solo i documenti previsti ({s})')
s, _, _ = app('PATCH', f'{DOCS}/collezioni/{cid}/voci/p4', {'fields': {**voce['mapValue']['fields'], 'altro': {'stringValue': 'x'}}})
ok(s == 403, f'le regole rifiutano campi in più ({s})')
s, r, _ = app('GET', f'{DOCS}/collezioni/{cid}/voci')
ok(s == 200 and '73-617' in json.dumps(r), 'l\'app rilegge le voci')
s, r, _ = app('GET', f'{DOCS}/collezioni/{cid}/stato/possedute')
ok(s == 200 and '73-617' in json.dumps(r), 'l\'app rilegge la collezione dell\'account')
s, r, _ = app('GET', f'{DOCS}/collezioni/{cid}/dispositivi')
ok(s == 200 and 'Prova' in json.dumps(r), 'l\'app vede l\'elenco dei dispositivi')
s, _, _ = app('GET', f'{DOCS}/collezioni')
ok(s == 403, f'non si possono elencare le collezioni ({s})')
s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}/stato/possedute', gettone=t_altro)
ok(s == 403, f'un altro account non legge questa collezione ({s})')
s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}/stato/possedute', gettone=None)
ok(s == 403, f'senza accesso non si legge niente ({s})')
s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}/eventi/prova{ora}')
ok(s == 403, f'gli eventi non si leggono dall\'app ({s})')

# il postino: l'evento deve sparire entro poco (vuol dire che la funzione è partita e ha mandato la notifica)
cr = service_account.Credentials.from_service_account_file(os.environ.get('FIREBASE_SA_FILE', 'keystore/firebase-invio.json'), scopes=['https://www.googleapis.com/auth/cloud-platform'])
adm = AuthorizedSession(cr)
t0 = time.time(); preso = False
while time.time() - t0 < 90:
    if adm.get(f'{DOCS}/collezioni/{cid}/eventi/prova{ora}').status_code == 404: preso = True; break
    time.sleep(1)
ok(preso, f'il postino ha preso l\'evento e mandato la notifica in {time.time() - t0:.1f} s' if preso else 'il postino non ha preso l\'evento entro 90 s')
# pulizia (come amministratore)
for rel in ['stato/possedute', 'dispositivi/PROVAPROVA12', f'eventi/prova{ora}', '']:
    adm.delete(f'{DOCS}/collezioni/{cid}' + ('/' + rel if rel else ''))
for u in (cid, altro):
    adm.post(f'https://identitytoolkit.googleapis.com/v1/projects/{P}/accounts:delete', json={'localId': u})
print('RISULTATO:', 'TUTTO OK' if not errori else errori)
sys.exit(1 if errori else 0)
