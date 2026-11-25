# Prova reale del server della sincronizzazione, fatta come la fa l'app (senza account, solo con il codice):
# 1) scrive una collezione di prova e un "evento"; 2) controlla che il postino lo prenda e lo cancelli
# (= notifica mandata); 3) controlla che le regole blocchino chi non ha il codice, anche su Storage (versioni e
# catalogo, passo 5). Alla fine pulisce.
# Col muro acceso (config/accesso, docs/progetto-accesso-su-approvazione.md) l'utente di prova non è approvato, perché
# entra con un gettone del server e non con Google: la prova controlla che le regole lo tengano fuori, e l'evento lo
# scrive l'amministratore, così il postino si prova lo stesso. Non scrive mai in accessi/ (niente notifiche a Valerio).
import json, random, string, sys, time, urllib.parse, urllib.request, urllib.error
import os
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession
from google.auth import crypt, jwt
P = 'collezione-euro-24ecd'
CHIAVE = json.load(open('native/google-services.json'))['client'][0]['api_key'][0]['current_key']
DOCS = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'
# versioni e catalogo (passo 5), letti come li legge l'app con l'SDK di Storage
STORAGE = 'https://firebasestorage.googleapis.com/v0/b/collezione-euro-24ecd.firebasestorage.app/o'
def da_storage(url, gettone):
    rq = urllib.request.Request(url, headers={'Authorization': 'Firebase ' + gettone} if gettone else {})
    try:
        with urllib.request.urlopen(rq, timeout=20) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
SA_FILE = os.environ.get('FIREBASE_SA_FILE', 'keystore/firebase-invio.json')
SA = json.load(open(SA_FILE))
# l'amministratore (il service account): le regole per lui non valgono
adm = AuthorizedSession(service_account.Credentials.from_service_account_file(SA_FILE, scopes=['https://www.googleapis.com/auth/cloud-platform']))
# un utente di prova, creato con un gettone firmato dal server: per le regole ha fatto l'accesso, ma non con Google
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

# il muro, letto come lo leggono le regole: acceso solo se config/accesso c'è e "obbligatorio" è true
r = adm.get(f'{DOCS}/config/accesso')
if r.status_code not in (200, 404):
    print(f'✗ non riesco a leggere config/accesso: {r.status_code} {r.text[:200]}'); sys.exit(1)
INTERRUTTORE = r.status_code == 200
MURO = INTERRUTTORE and r.json().get('fields', {}).get('obbligatorio', {}).get('booleanValue') is True
print('✓ muro ' + ('ACCESO: l\'utente di prova non è approvato e deve restare fuori' if MURO else 'spento: l\'utente di prova usa la collezione come tutti'))
s, _, _ = app('GET', f'{DOCS}/config/accesso', gettone=None)
ok(s == (200 if INTERRUTTORE else 404), f'l\'app legge l\'interruttore del muro anche prima dell\'accesso ({s})')

GET['t'] = utente(cid); t_altro = utente(altro)
print('✓ utenti di prova creati (gettone del server, non Google)')
ora = int(time.time() * 1000)
EVENTO = {'did': {'stringValue': 'PROVAPROVA12'}, 'nome': {'stringValue': 'Prova automatica'}, 'ts': {'integerValue': str(ora)}, 'testo': {'stringValue': 'Prova del postino (nessuno la riceve)'}}
SCRITTURE = {'writes': [
    {'update': {'name': f'projects/{P}/databases/(default)/documents/collezioni/{cid}', 'fields': {'creata': {'integerValue': str(ora)}}}},
    {'update': {'name': nome('stato/possedute'), 'fields': {'p': {'mapValue': {'fields': {'73-617': {'integerValue': str(ora)}}}}}}, 'updateMask': {'fieldPaths': ['p.`73-617`']}},
    {'update': {'name': nome('dispositivi/PROVAPROVA12'), 'fields': {'nome': {'stringValue': 'Prova'}, 'ultimo': {'integerValue': str(ora)}}}},
    {'update': {'name': nome('eventi/prova' + str(ora)), 'fields': EVENTO}},
]}
# formato attuale (dalla versione con l'orologio logico): voci divise in pochi documenti
voce = {'mapValue': {'fields': {'e': {'mapValue': {'fields': {'73-617': {'mapValue': {'fields': {'v': {'booleanValue': True}, 't': {'stringValue': '00000000a-0000-PROVA'}}}}}}}}}}
if not MURO:
    s, r, h = app('POST', f'{DOCS}:commit', SCRITTURE)
    ok(s == 200, f'l\'app scrive la collezione dell\'account ({s} {r if s != 200 else ""})')
    evento_scritto = s == 200
    print('   CORS per l\'app:', h.get('Access-Control-Allow-Origin') or h.get('access-control-allow-origin') or '(nessuna intestazione)')
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
else:
    s, _, _ = app('POST', f'{DOCS}:commit', SCRITTURE)
    ok(s == 403, f'col muro acceso chi non è approvato non scrive la collezione ({s})')
    s, _, _ = app('PATCH', f'{DOCS}/collezioni/{cid}/voci/p3', {'fields': voce['mapValue']['fields']})
    ok(s == 403, f'… né le voci ({s})')
    s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}/voci')
    ok(s == 403, f'… e non le legge ({s})')
    s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}')
    ok(s == 403, f'… e non legge la collezione ({s})')
    scritti = [rel or '(collezione)' for rel in ('', 'stato/possedute', 'voci/p3', 'dispositivi/PROVAPROVA12', f'eventi/prova{ora}')
             if adm.get(f'{DOCS}/collezioni/{cid}' + ('/' + rel if rel else '')).status_code != 404]
    ok(not scritti, 'infatti sul server non è stato scritto niente' if not scritti else f'sul server ci sono documenti scritti col muro acceso: {scritti}')
    # l'evento lo scrive l'amministratore: così il postino si prova anche col muro acceso
    r = adm.patch(f'{DOCS}/collezioni/{cid}/eventi/prova{ora}', json={'fields': EVENTO})
    ok(r.ok, f'evento di prova scritto dall\'amministratore ({r.status_code})')
    evento_scritto = r.ok
s, _, _ = app('GET', f'{DOCS}/collezioni')
ok(s == 403, f'non si possono elencare le collezioni ({s})')
s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}/stato/possedute', gettone=t_altro)
ok(s == 403, f'un altro account non legge questa collezione ({s})')
s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}/stato/possedute', gettone=None)
ok(s == 403, f'senza accesso non si legge niente ({s})')
s, _, _ = app('GET', f'{DOCS}/collezioni/{cid}/eventi/prova{ora}')
ok(s == 403, f'gli eventi non si leggono dall\'app ({s})')

# Storage (passo 5): versioni e catalogo solo per chi può usare Eurodex, e solo con Google. L'utente di prova entra
# col gettone del server, quindi deve restare fuori sia col muro spento sia col muro acceso, come chi non ha fatto
# l'accesso; e nessuno elenca i file. Le regole valgono anche per un file che non c'è: il «no» arriva prima.
# I «sì» (approvati, Valerio, muro spento) li prova prove/regole-storage.py sugli emulatori.
for nome in ('rilasci/version.json', 'dati/indice.json'):
    url = f'{STORAGE}/{urllib.parse.quote(nome, safe="")}?alt=media'
    s = da_storage(url, GET['t'])
    ok(s in (401, 403), f'Storage: chi non entra con Google non legge {nome} ({s})')
    s = da_storage(url, None)
    ok(s in (401, 403), f'Storage: senza accesso non si legge {nome} ({s})')
s = da_storage(f'{STORAGE}?prefix=rilasci%2F', GET['t'])
ok(s in (401, 403), f'Storage: non si elencano i file ({s})')

# il postino: l'evento deve sparire entro poco (vuol dire che la funzione è partita e ha mandato la notifica).
# Se l'evento non è stato scritto non c'è niente da aspettare (sparirebbe "da solo" e sembrerebbe preso)
if evento_scritto:
    t0 = time.time(); preso = False
    while time.time() - t0 < 90:
        if adm.get(f'{DOCS}/collezioni/{cid}/eventi/prova{ora}').status_code == 404: preso = True; break
        time.sleep(1)
    ok(preso, f'il postino ha preso l\'evento e mandato la notifica in {time.time() - t0:.1f} s' if preso else 'il postino non ha preso l\'evento entro 90 s')
else:
    ok(False, 'il postino non si è potuto provare: l\'evento non è stato scritto')
# pulizia (come amministratore), anche dei documenti che le regole avrebbero dovuto rifiutare
for rel in ['stato/possedute', 'voci/p3', 'voci/p4', 'voci/qualsiasi', 'dispositivi/PROVAPROVA12', f'eventi/prova{ora}', '']:
    adm.delete(f'{DOCS}/collezioni/{cid}' + ('/' + rel if rel else ''))
for u in (cid, altro):
    adm.post(f'https://identitytoolkit.googleapis.com/v1/projects/{P}/accounts:delete', json={'localId': u})
print('RISULTATO:', 'TUTTO OK' if not errori else errori)
sys.exit(1 if errori else 0)
