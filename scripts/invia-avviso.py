# Manda la notifica immediata (push) a tutti i telefoni con l'app, attraverso Firebase Cloud Messaging.
# Uso: python3 scripts/invia-avviso.py pub/version.json [--prova] [--token T]
#      python3 scripts/invia-avviso.py www/data/indice.json --dati   (dati nuovi, senza versione nuova dell'app)
#   --prova: Firebase controlla tutto ma non invia
#   --token: manda solo a quel telefono (per le prove su emulatore, così i telefoni veri non ricevono niente)
import json, sys
import os
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

v = json.load(open(sys.argv[1])) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else {'code': 0, 'version': 'prova', 'note': ''}
dati = '--dati' in sys.argv   # avviso di dati nuovi (catalogo, schede, foto): il file è dati/indice.json
prova = '--prova' in sys.argv
token = sys.argv[sys.argv.index('--token') + 1] if '--token' in sys.argv else None
cr = service_account.Credentials.from_service_account_file(os.environ.get('FIREBASE_SA_FILE', 'keystore/firebase-invio.json'), scopes=['https://www.googleapis.com/auth/firebase.messaging'])
s = AuthorizedSession(cr)
msg = {'validate_only': prova, 'message': {
    **({'token': token} if token else {'topic': 'aggiornamenti'}),
    # solo dati: è l'app a mostrare la notifica, così non arrivano doppioni con il controllo ogni 6 ore
    'data': ({'tipo': 'dati', 'rev': str(v['rev']), 'schema': str(v.get('schema', 1)), 'note': v.get('note', '')} if dati
             else {'code': str(v['code']), 'version': v['version'], 'note': v.get('note', '')}),
    'android': {'priority': 'HIGH', 'ttl': '604800s'}}}
r = s.post(f"https://fcm.googleapis.com/v1/projects/{cr.project_id}/messages:send", json=msg)
print(('PROVA ' if prova else '') + f'Firebase: {r.status_code} {r.text[:300]}')
sys.exit(0 if r.ok else 1)
