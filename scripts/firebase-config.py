# Configurazione Firebase per "Accedi con Google":
#  1) registra l'impronta (SHA-1 e SHA-256) della firma dell'app, così Google riconosce Eurodex;
#  2) controlla che su Firebase sia attivo l'accesso con Google;
#  3) scarica google-services.json aggiornato (con l'identificativo "web" che serve all'app) e lo salva
#     dove si indica (di solito android/app/google-services.json durante la compilazione).
# Uso nel workflow: IMPRONTA_SHA1=... IMPRONTA_SHA256=... python3 scripts/firebase-config.py [destinazione]
#   (impronte lette dall'APK pubblicato: la chiave di firma non serve)
# Uso a mano: KS_PASS=... python3 scripts/firebase-config.py [destinazione]   (impronte lette dal keystore)
import base64, json, os, re, subprocess, sys, time
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

cr = service_account.Credentials.from_service_account_file(os.environ.get('FIREBASE_SA_FILE', 'keystore/firebase-invio.json'), scopes=['https://www.googleapis.com/auth/cloud-platform'])
s = AuthorizedSession(cr)
P = cr.project_id
APP = json.load(open('native/google-services.json'))['client'][0]['client_info']['mobilesdk_app_id']
BASE = f'https://firebase.googleapis.com/v1beta1/projects/{P}/androidApps/{APP}'

# 1. impronte della firma: dal workflow (lette dall'APK pubblicato) oppure, a mano, dal keystore
def esadecimale(testo, byte):
    v = (testo or '').replace(':', '').strip().lower()
    return v if re.fullmatch(f'[0-9a-f]{{{2 * byte}}}', v) else None

if os.environ.get('IMPRONTA_SHA1') or os.environ.get('IMPRONTA_SHA256'):
    impronte = {'SHA_1': esadecimale(os.environ.get('IMPRONTA_SHA1'), 20),
                'SHA_256': esadecimale(os.environ.get('IMPRONTA_SHA256'), 32)}
else:
    out = subprocess.run(['keytool', '-list', '-v', '-keystore', os.environ.get('KEYSTORE_FILE', 'keystore/collezione-euro.jks'), '-alias', 'collezione', '-storepass:env', 'KS_PASS'],
                         capture_output=True, text=True).stdout
    m1, m256 = re.search(r'SHA1:\s*([0-9A-F:]+)', out), re.search(r'SHA256:\s*([0-9A-F:]+)', out)
    impronte = {'SHA_1': esadecimale(m1 and m1.group(1), 20), 'SHA_256': esadecimale(m256 and m256.group(1), 32)}
r = s.get(f'{BASE}/sha')
gia = {c['shaHash'].lower() for c in r.json().get('certificates', [])} if r.ok else set()
if not r.ok:
    print(f'(non riesco a leggere le impronte registrate: {r.status_code} {r.text[:200]})')
for tipo, h in impronte.items():
    if not h:
        print(f'❌ impronta {tipo} non letta dalla firma'); continue
    if h in gia:
        print(f'✓ impronta {tipo} già registrata')
    else:
        r = s.post(f'{BASE}/sha', json={'shaHash': h, 'certType': tipo})
        print(f'✓ impronta {tipo} registrata' if r.ok else f'❌ impronta {tipo}: {r.status_code} {r.text[:200]}')

# 2. accesso con Google attivo?
r = s.get(f'https://identitytoolkit.googleapis.com/admin/v2/projects/{P}/defaultSupportedIdpConfigs/google.com')
google = r.ok and r.json().get('enabled')
print('✓ accesso con Google attivo su Firebase' if google else f'❌ accesso con Google NON attivo su Firebase (Authentication → Metodo di accesso → Google) [{r.status_code}]')
if not google:
    l = s.get(f'https://identitytoolkit.googleapis.com/admin/v2/projects/{P}/defaultSupportedIdpConfigs')
    print('   metodi di accesso configurati:', l.status_code, [(c['name'].split('/')[-1], c.get('enabled')) for c in (l.json().get('defaultSupportedIdpConfigs') or [])] if l.ok else l.text[:200])
    c = s.get(f'https://identitytoolkit.googleapis.com/admin/v2/projects/{P}/config')
    print('   configurazione Authentication:', c.status_code, json.dumps(c.json().get('signIn', {}))[:300] if c.ok else c.text[:200])

# 3. configurazione aggiornata (l'identificativo "web" compare quando l'accesso con Google è attivo)
cfg, web = None, None
for i in range(6):
    r = s.get(f'{BASE}/config')
    if r.ok:
        cfg = json.loads(base64.b64decode(r.json()['configFileContents']))
        oauth = [o for c in cfg['client'] for o in c.get('oauth_client', [])]
        web = next((o['client_id'] for o in oauth if o.get('client_type') == 3), None)
        android = [o for o in oauth if o.get('client_type') == 1]
        if web and android:
            break
    time.sleep(5)
if cfg:
    print(f"✓ configurazione scaricata · identificativo web: {'sì' if web else 'NO'} · client Android: {'sì' if android else 'NO'}")
if len(sys.argv) > 1 and cfg:
    json.dump(cfg, open(sys.argv[1], 'w'), indent=2)
    print('  salvata in', sys.argv[1])
sys.exit(0 if cfg else 1)
