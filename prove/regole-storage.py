"""Regole di Storage (firebase/storage.rules), provate sugli emulatori di Firebase come le proverebbe chi prova a
forzarle: richieste fatte a mano con il gettone di un utente, come farebbe un'app modificata.
Versioni (rilasci/) e catalogo (dati/) li legge solo chi può usare Eurodex, con la stessa condizione delle collezioni:
Valerio, gli approvati, e con il muro spento tutti tranne gli esclusi. Lo stato si legge da Firestore a ogni richiesta,
quindi si prova anche una revoca in diretta. Nessuno, nemmeno un approvato, scrive, cancella o elenca i file.
I file e i documenti di Firestore li prepara l'accesso da amministratore dell'emulatore ("owner"), che sul server vero
corrisponde ai workflow e alle funzioni.
Si avvia dentro gli emulatori:
  firebase emulators:exec --only auth,firestore,storage --project collezione-euro-24ecd "python3 prove/regole-storage.py"
"""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

P = 'collezione-euro-24ecd'
BUCKET = f'{P}.firebasestorage.app'
FS = f'http://127.0.0.1:8080/v1/projects/{P}/databases/(default)/documents'
ST = f'http://127.0.0.1:9199/v0/b/{BUCKET}/o'
QUI = os.path.dirname(os.path.abspath(__file__))
fallite = []


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m, flush=True)
    if not c:
        fallite.append(m)


def richiesta(metodo, url, corpo=None, intestazioni=None):
    dati = corpo if isinstance(corpo, (bytes, type(None))) else json.dumps(corpo).encode()
    req = urllib.request.Request(url, method=metodo, data=dati, headers=intestazioni or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def gettone(uid, verificata=True, metodo='google.com'):
    """Un gettone senza firma, come quello che si costruirebbe a mano: l'emulatore non controlla la firma (il server
    vero sì), quindi qui si prova solo cosa dicono le regole."""
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
    ora = int(time.time())
    corpo = {'iss': f'https://securetoken.google.com/{P}', 'aud': P, 'sub': uid, 'user_id': uid,
             'email': f'{uid.lower()}@example.com', 'email_verified': verificata, 'iat': ora, 'exp': ora + 3600,
             'auth_time': ora, 'firebase': {'sign_in_provider': metodo, 'identities': {}}}
    return f"{b({'alg': 'none', 'typ': 'JWT'})}.{b(corpo)}."


def documento(percorso, campi):
    """Scrive un documento di Firestore come amministratore dell'emulatore (salta le regole)."""
    def v(x):
        return {'booleanValue': x} if isinstance(x, bool) else {'stringValue': x}
    st, _ = richiesta('PATCH', f'{FS}/{percorso}', {'fields': {k: v(x) for k, x in campi.items()}},
                      {'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    assert st == 200, f'{percorso} non scritto ({st})'


def cancella(percorso):
    richiesta('DELETE', f'{FS}/{percorso}', None, {'Authorization': 'Bearer owner'})


def muro(acceso):
    documento('config/accesso', {'obbligatorio': acceso})


def carica(nome, contenuto, chi='owner'):
    """Carica un file su Storage; chi='owner' è il workflow (salta le regole), altrimenti un utente col suo gettone."""
    q = urllib.parse.urlencode({'name': nome, 'uploadType': 'media'})
    autorizzazione = 'Bearer owner' if chi == 'owner' else f'Firebase {chi}'
    st, _ = richiesta('POST', f'{ST}?{q}', contenuto, {'Authorization': autorizzazione,
                                                        'Content-Type': 'application/octet-stream'})
    return st


def scarica(nome, chi):
    """Scarica un file come fa l'SDK (gettone dell'utente, mai il token di download). chi=None: senza accesso."""
    url = f"{ST}/{urllib.parse.quote(nome, safe='')}?alt=media"
    return richiesta('GET', url, None, {'Authorization': f'Firebase {chi}'} if chi else {})


def puo(nome, chi):
    st, corpo = scarica(nome, chi)
    return st == 200, st, corpo


def main():
    regole = open(os.path.join(QUI, '..', 'firebase', 'storage.rules'), encoding='utf-8').read()
    vero = re.findall(r"request\.auth\.uid == '([A-Za-z0-9]{20,40})'", regole)
    assert len(vero) == 1, f'UID di Valerio nelle regole: {vero}'
    valerio = gettone(vero[0])

    # i file che caricano i workflow
    versione = json.dumps({'code': 84, 'version': '1.0.84', 'apk': 'Eurodex-1.0.84.apk', 'note': 'prova'}).encode()
    for nome, contenuto in [('rilasci/version.json', versione), ('rilasci/Eurodex-1.0.84.apk', b'APK finto'),
                            ('dati/indice.json', b'{"rev": 1}'), ('dati/img/de-2002-1e.webp', b'foto'),
                            ('altro/segreto.txt', b'non per le app')]:
        assert carica(nome, contenuto) == 200, f'{nome} non caricato dal workflow'

    # gli account: le richieste le scrive la funzione (qui l'amministratore dell'emulatore)
    for uid, stato in [('Approvato1', 'approvato'), ('Attesa1', 'in_attesa'), ('Rifiutato1', 'rifiutato'),
                       ('Tolto1', 'revocato')]:
        documento(f'accessi/{uid}', {'stato': stato, 'nome': uid})
    g = {uid: gettone(uid) for uid in ['Approvato1', 'Attesa1', 'Rifiutato1', 'Tolto1', 'Nuovo1']}

    print('— muro acceso')
    muro(True)
    letto, st, corpo = puo('rilasci/version.json', g['Approvato1'])
    ok(letto and json.loads(corpo)['code'] == 84, f'approvato: legge version.json ({st})')
    ok(puo('rilasci/Eurodex-1.0.84.apk', g['Approvato1'])[0], "approvato: scarica l'APK")
    ok(puo('dati/indice.json', g['Approvato1'])[0], "approvato: legge l'indice del catalogo")
    ok(puo('dati/img/de-2002-1e.webp', g['Approvato1'])[0], 'approvato: scarica una foto (cartella dentro dati/)')
    ok(puo('rilasci/version.json', valerio)[0], 'Valerio: legge anche senza richiesta')
    for chi in ['Attesa1', 'Rifiutato1', 'Tolto1', 'Nuovo1']:
        letto, st, _ = puo('rilasci/version.json', g[chi])
        ok(not letto and st in (401, 403), f'{chi}: version.json negato ({st})')
        ok(not puo('dati/indice.json', g[chi])[0], f'{chi}: catalogo negato')
    letto, st, _ = puo('rilasci/version.json', None)
    ok(not letto and st in (401, 403), f'senza accesso: negato ({st})')
    ok(not puo('rilasci/version.json', gettone('Approvato1', metodo='password'))[0],
       'approvato ma con un accesso non Google: negato')
    ok(not puo('rilasci/version.json', gettone(vero[0], verificata=False))[0],
       "l'UID di Valerio con email non verificata: negato")
    ok(not puo('altro/segreto.txt', g['Approvato1'])[0], 'approvato: fuori da rilasci/ e dati/ niente')
    ok(not puo('altro/segreto.txt', valerio)[0], 'Valerio: fuori da rilasci/ e dati/ niente, dall\'app')

    print('— nessuno scrive, cancella o elenca')
    for chi, nome in [(g['Approvato1'], 'Approvato1'), (valerio, 'Valerio')]:
        st = carica('rilasci/version.json', b'{"code": 999, "version": "9.9.9"}', chi)
        ok(st in (401, 403), f'{nome}: non sostituisce version.json ({st})')
        st = carica('dati/nuovo.json', b'{}', chi)
        ok(st in (401, 403), f'{nome}: non aggiunge file al catalogo ({st})')
        st, _ = richiesta('DELETE', f"{ST}/{urllib.parse.quote('rilasci/version.json', safe='')}", None,
                          {'Authorization': f'Firebase {chi}'})
        ok(st in (401, 403), f'{nome}: non cancella version.json ({st})')
        st, _ = richiesta('GET', f"{ST}?{urllib.parse.urlencode({'prefix': 'rilasci/'})}", None,
                          {'Authorization': f'Firebase {chi}'})
        ok(st in (401, 403), f'{nome}: non elenca i file ({st})')
    letto, _, corpo = puo('rilasci/version.json', g['Approvato1'])
    ok(letto and json.loads(corpo)['code'] == 84, 'version.json è ancora quello del workflow')

    print('— revoca in diretta')
    documento('accessi/Approvato1', {'stato': 'revocato', 'nome': 'Approvato1'})
    ok(not puo('rilasci/version.json', g['Approvato1'])[0], "accesso tolto: subito negato, con lo stesso gettone")
    documento('accessi/Approvato1', {'stato': 'approvato', 'nome': 'Approvato1'})
    ok(puo('rilasci/version.json', g['Approvato1'])[0], 'riapprovato: subito di nuovo dentro')

    print('— muro spento')
    muro(False)
    for chi in ['Approvato1', 'Attesa1', 'Nuovo1']:
        ok(puo('rilasci/version.json', g[chi])[0], f'{chi}: legge version.json')
    for chi in ['Rifiutato1', 'Tolto1']:
        ok(not puo('rilasci/version.json', g[chi])[0], f'{chi}: escluso anche col muro spento')
    ok(not puo('rilasci/version.json', None)[0], 'senza accesso: negato anche col muro spento')

    print('— senza interruttore (config/accesso assente): come muro spento')
    cancella('config/accesso')
    ok(puo('rilasci/version.json', g['Nuovo1'])[0], 'account nuovo: legge')
    ok(not puo('rilasci/version.json', g['Tolto1'])[0], 'accesso tolto: negato')

    print('RISULTATO:', 'TUTTO OK' if not fallite else f'{len(fallite)} PROBLEMI')
    sys.exit(1 if fallite else 0)


if __name__ == '__main__':
    main()
