# Prepara Firebase per la sincronizzazione tra dispositivi: attiva i servizi e crea il database (Firestore)
# se non c'è ancora. Usa la chiave del service account (keystore/firebase-invio.json).
# Scrive messaggi chiari se manca qualcosa (piano Blaze, ruolo Editor).
import json, sys, time
import os
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

cr = service_account.Credentials.from_service_account_file(os.environ.get('FIREBASE_SA_FILE', 'keystore/firebase-invio.json'), scopes=['https://www.googleapis.com/auth/cloud-platform'])
s = AuthorizedSession(cr)
P = cr.project_id
ok = True

def spiega(r, cosa):
    t = r.text[:400]
    try: print('   (risposta di Google:', r.json()['error']['message'][:300] + ')')
    except Exception: pass
    if r.status_code == 403 and 'permission denied' in t.lower():
        print(f'❌ {cosa}: manca il permesso. Serve il ruolo "Editor" per {cr.service_account_email} (Google Cloud → IAM)')
    elif 'billing' in t.lower():
        print(f'❌ {cosa}: serve il piano Blaze (fatturazione) sul progetto Firebase')
    elif r.status_code == 403:
        print(f'❌ {cosa}: manca il permesso. Serve il ruolo "Editor" per {cr.service_account_email} (Google Cloud → IAM)')
    else:
        print(f'❌ {cosa}: {r.status_code} {t}')

r = s.post(f'https://serviceusage.googleapis.com/v1/projects/{P}/services:batchEnable', json={'serviceIds': ['firestore.googleapis.com', 'cloudbilling.googleapis.com']})
print('✓ servizio del database attivato' if r.ok else f'❌ servizio del database: {r.status_code} {r.text[:200]}')
if r.ok: time.sleep(15)
servizi = ['firestore.googleapis.com', 'cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com',
           'run.googleapis.com', 'eventarc.googleapis.com', 'pubsub.googleapis.com', 'storage.googleapis.com', 'cloudbilling.googleapis.com']
r = s.post(f'https://serviceusage.googleapis.com/v1/projects/{P}/services:batchEnable', json={'serviceIds': servizi})
if r.ok:
    print('✓ servizi attivati (o già attivi)')
    op = r.json()
    for _ in range(30):
        if op.get('done') or not op.get('name'): break
        time.sleep(5); op = s.get(f"https://serviceusage.googleapis.com/v1/{op['name']}").json()
else:
    spiega(r, 'attivazione dei servizi'); ok = False

# piano di fatturazione
r = s.get(f'https://cloudbilling.googleapis.com/v1/projects/{P}/billingInfo')
if r.ok:
    b = r.json().get('billingEnabled')
    print('✓ piano Blaze attivo (fatturazione collegata)' if b else '❌ fatturazione NON collegata: il piano è ancora Spark (gratuito). Serve Blaze per il "postino"')
    ok = ok and bool(b)
else:
    print(f'(non riesco a leggere il piano di fatturazione: {r.status_code})'); spiega(r, 'lettura del piano')

# database
r = s.get(f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)')
if r.status_code == 403 and 'has not been used' in r.text:
    print('❌ il servizio del database non è ancora attivo (si attiva da solo appena ci sono i permessi)'); ok = False
elif r.status_code == 404 or (r.status_code == 400 and 'does not exist' in r.text):
    r = s.post(f'https://firestore.googleapis.com/v1/projects/{P}/databases?databaseId=(default)', json={'locationId': 'eur3', 'type': 'FIRESTORE_NATIVE'})
    if r.ok:
        print('✓ database creato (Europa)')
        time.sleep(20)
    else:
        spiega(r, 'creazione del database'); ok = False
elif r.ok:
    print(f"✓ database già presente ({r.json().get('locationId')})")
else:
    spiega(r, 'lettura del database'); ok = False

sys.exit(0 if ok else 1)
