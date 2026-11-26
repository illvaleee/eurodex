"""Passo 5, D: gli emulatori di Firebase per le prove dell'APK (docs/progetto-accesso-su-approvazione.md, §9.7).

Con il passo 5 versioni e catalogo stanno su Storage, e li legge solo chi può usare Eurodex. Sul telefono simulato non
c'è un account Google vero: con `debug.eurodex.emulatori=1` l'app (C) parla con gli emulatori di Auth, Firestore e
Storage, che girano sul PC della CI e che il telefono raggiunge a 10.0.2.2. Questo script li prepara e li controlla:

  pronti                         aspetta che i tre emulatori rispondano (al massimo 120 secondi)
  prepara [--numero N --apk F]   come il server vero dopo una pubblicazione: l'utente di prova approvato, uno in attesa
                                 e il muro acceso; con --apk anche rilasci/, con l'APK prima e version.json per ultimo
  controlla [--telefono]         dal PC l'utente di prova entra col gettone Google finto e legge rilasci/version.json
                                 e dati/indice.json (che il job carica con scripts/carica-storage.mjs), mentre senza
                                 accesso o in attesa non legge; con --telefono anche dal telefono simulato i tre
                                 emulatori rispondono a 10.0.2.2

Si parla solo con gli emulatori, su 127.0.0.1: nessun indirizzo vero di Google, nessuna chiave. Le scritture le fa
l'amministratore dell'emulatore ("owner"), che sul server vero corrisponde ai workflow. Si usa nella CI, con gli
emulatori avviati da `firebase emulators:start --only auth,firestore,storage --project collezione-euro-24ecd`.
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

P = 'collezione-euro-24ecd'
BUCKET = f'{P}.firebasestorage.app'
AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
FS = f'http://127.0.0.1:8080/v1/projects/{P}/databases/(default)/documents'
ST = f'http://127.0.0.1:9199/v0/b/{BUCKET}/o'
PORTE = {'Auth': 9099, 'Firestore': 8080, 'Storage': 9199}
TELEFONO = '10.0.2.2'   # il PC della CI visto dal telefono simulato

# Gli utenti di prova. L'app, con debug.eurodex.emulatori=1, entra con lo stesso gettone Google finto di PROVA (C):
# l'emulatore di Auth lo accetta senza firma, il server vero no. L'uid è fisso perché l'utente si crea qui, prima che
# l'app entri, e così si può approvare prima (come un account già approvato da Valerio).
PROVA = {'uid': 'ProvaApkApprovato0000000001', 'sub': 'prova-apk-1', 'email': 'prova-apk@example.com',
         'nome': 'Prova APK'}
IN_ATTESA = {'uid': 'ProvaApkInAttesa00000000001', 'sub': 'prova-apk-2', 'email': 'prova-apk-attesa@example.com',
             'nome': 'Prova APK in attesa'}

# niente proxy: gli emulatori sono su questo PC (un HTTPS_PROXY nell'ambiente non deve vedere queste richieste)
APRI = urllib.request.build_opener(urllib.request.ProxyHandler({}))
fallite = []


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m, flush=True)
    if not c:
        fallite.append(m)


def richiesta(metodo, url, corpo=None, intestazioni=None, timeout=60):
    dati = corpo if isinstance(corpo, (bytes, type(None))) else json.dumps(corpo).encode()
    req = urllib.request.Request(url, method=metodo, data=dati, headers=intestazioni or {})
    try:
        with APRI.open(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def risponde(porta):
    try:
        APRI.open(f'http://127.0.0.1:{porta}/', timeout=5).close()
        return True
    except urllib.error.HTTPError:
        return True     # risponde, anche se con un errore: l'emulatore c'è
    except Exception:
        return False


def pronti(attesa=120):
    fine = time.time() + attesa
    while True:
        mancano = [n for n, p in PORTE.items() if not risponde(p)]
        if not mancano:
            print('✓ emulatori pronti: ' + ', '.join(f'{n} {p}' for n, p in PORTE.items()), flush=True)
            return True
        if time.time() > fine:
            print('✗ dopo 120 secondi non rispondono: ' + ', '.join(mancano), flush=True)
            return False
        time.sleep(2)


def crea_utente(u):
    """L'utente nell'emulatore di Auth, con l'accesso Google già collegato (come dopo il primo accesso vero)."""
    corpo = {'users': [{'localId': u['uid'], 'email': u['email'], 'emailVerified': True, 'displayName': u['nome'],
                        'providerUserInfo': [{'providerId': 'google.com', 'rawId': u['sub'], 'email': u['email'],
                                              'displayName': u['nome']}]}]}
    st, testo = richiesta('POST', f'{AUTH}/projects/{P}/accounts:batchCreate', corpo,
                          {'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    errori = (json.loads(testo or b'{}') if st == 200 else {}).get('error')
    if st != 200 or errori:
        sys.exit(f'✗ utente {u["uid"]} non creato nell\'emulatore di Auth: {st} {testo[:300]!r}')


def documento(percorso, campi):
    """Un documento di Firestore scritto dall'amministratore dell'emulatore (salta le regole)."""
    def v(x):
        return {'booleanValue': x} if isinstance(x, bool) else {'stringValue': x}
    st, testo = richiesta('PATCH', f'{FS}/{percorso}', {'fields': {k: v(x) for k, x in campi.items()}},
                          {'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    if st != 200:
        sys.exit(f'✗ {percorso} non scritto in Firestore: {st} {testo[:300]!r}')


def carica(nome, contenuto, tipo):
    """Un file su Storage caricato dall'amministratore dell'emulatore, come i workflow sul server vero."""
    q = urllib.parse.urlencode({'name': nome, 'uploadType': 'media'})
    st, testo = richiesta('POST', f'{ST}?{q}', contenuto, {'Authorization': 'Bearer owner', 'Content-Type': tipo},
                          timeout=300)
    if st != 200:
        sys.exit(f'✗ {nome} non caricato su Storage: {st} {testo[:300]!r}')


def prepara(numero, apk):
    for u, stato in ((PROVA, 'approvato'), (IN_ATTESA, 'in_attesa')):
        crea_utente(u)
        documento(f'accessi/{u["uid"]}', {'stato': stato, 'email': u['email'], 'nome': u['nome'],
                                          'dispositivo': 'Telefono simulato'})
    documento('config/accesso', {'obbligatorio': True})
    print(f'✓ utenti di prova: {PROVA["uid"]} approvato, {IN_ATTESA["uid"]} in attesa; muro acceso', flush=True)
    if apk:
        # come B: prima l'APK, poi version.json, che è il file che lo annuncia (e che fa partire l'avviso)
        nome = f'CollezioneEuro-1.0.{numero}.apk'
        with open(apk, 'rb') as f:
            contenuto = f.read()
        carica(f'rilasci/{nome}', contenuto, 'application/vnd.android.package-archive')
        v = {'code': numero, 'version': f'1.0.{numero}', 'size': len(contenuto), 'apk': nome,
             'note': 'Versione di prova (emulatori)'}
        carica('rilasci/version.json', json.dumps(v).encode(), 'application/json')
        print(f'✓ su Storage: rilasci/{nome} ({len(contenuto)} byte), poi rilasci/version.json', flush=True)


def gettone_google(u):
    """Il gettone Google finto: l'emulatore di Auth accetta un JSON con sub ed email al posto del gettone firmato."""
    return json.dumps({'sub': u['sub'], 'email': u['email'], 'email_verified': True, 'name': u['nome']})


def entra(u):
    """Come farà l'app con debug.eurodex.emulatori=1: accesso con Google all'emulatore di Auth, col gettone finto."""
    corpo = {'requestUri': 'http://localhost', 'returnSecureToken': True,
             'postBody': urllib.parse.urlencode({'id_token': gettone_google(u), 'providerId': 'google.com'})}
    st, testo = richiesta('POST', f'{AUTH}/accounts:signInWithIdp?key=emulatore', corpo,
                          {'Content-Type': 'application/json'})
    try:
        j = json.loads(testo or b'{}')
    except ValueError:
        j = {}
    return st, j.get('localId'), j.get('idToken')


def contenuto_gettone(t):
    try:
        parte = t.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(parte + '=' * (-len(parte) % 4)))
    except Exception:
        return {}


def scarica(nome, gettone):
    """Come l'SDK: con il gettone dell'utente, mai con il token di download. gettone=None: senza accesso."""
    url = f"{ST}/{urllib.parse.quote(nome, safe='')}?alt=media"
    return richiesta('GET', url, None, {'Authorization': f'Firebase {gettone}'} if gettone else {})


def sul_telefono(comando):
    try:
        r = subprocess.run(['adb', 'shell', comando], capture_output=True, text=True, timeout=30)
        return r.stdout + r.stderr
    except Exception as e:
        return f'ERRORE: {e}'


def controlla(telefono):
    st, uid, gettone = entra(PROVA)
    ok(st == 200 and uid == PROVA['uid'],
       f'l\'utente di prova entra con il gettone Google finto ed è quello preparato (HTTP {st}, uid {uid})')
    metodo = contenuto_gettone(gettone or '').get('firebase', {}).get('sign_in_provider')
    ok(metodo == 'google.com', f'il suo gettone dice «accesso con Google», come chiedono le regole ({metodo})')
    st, corpo = scarica('rilasci/version.json', gettone) if gettone else (0, b'')
    try:
        v = json.loads(corpo) if st == 200 else {}
    except ValueError:
        v = {}
    ok(st == 200 and isinstance(v.get('code'), int), f'approvato: legge rilasci/version.json da Storage (HTTP {st})')
    st, corpo = scarica('dati/indice.json', gettone) if gettone else (0, b'')
    try:
        ix = json.loads(corpo) if st == 200 else {}
    except ValueError:
        ix = {}
    ok(st == 200 and str(ix.get('rev', '')).isdigit(),
       f'approvato: legge dati/indice.json, caricato con carica-storage.mjs (HTTP {st}, rev {ix.get("rev")})')
    st, _ = scarica('rilasci/version.json', None)
    ok(st in (401, 403), f'senza accesso: Storage non dà version.json (HTTP {st})')
    st, uid, gettone2 = entra(IN_ATTESA)
    ok(st == 200 and uid == IN_ATTESA['uid'], f'entra anche l\'utente in attesa (HTTP {st}, uid {uid})')
    st, _ = scarica('rilasci/version.json', gettone2) if gettone2 else (0, b'')
    ok(st == 403, f'in attesa, col muro acceso: Storage non dà version.json (HTTP {st})')
    st, _ = scarica('dati/indice.json', gettone2) if gettone2 else (0, b'')
    ok(st == 403, f'in attesa, col muro acceso: Storage non dà nemmeno dati/indice.json (HTTP {st})')
    if telefono:
        for nome, porta in PORTE.items():
            # stdin resta aperto 2 secondi: l'emulatore di Firestore (Java) non risponde a chi chiude subito il suo
            # lato, e il nc di toybox lo chiude a fine stdin (giro 45679796057, analisi di Claude 1).
            # Appena acceso, il telefono può non avere ancora la rete («Network is unreachable», giro 45754079748):
            # si riprova fino a 5 volte, a 2 secondi l'una dall'altra, prima di dare ✗
            for tentativo in range(5):
                r = sul_telefono(f"(printf 'GET / HTTP/1.0\\r\\n\\r\\n'; sleep 2) | nc -w 5 {TELEFONO} {porta}")
                if 'HTTP/1.' in r:
                    break
                time.sleep(2)
            ok('HTTP/1.' in r, f'dal telefono simulato {nome} risponde a {TELEFONO}:{porta} ({r.strip()[:60]!r}'
               + (f', al tentativo {tentativo + 1})' if tentativo else ')'))
    print(f'RISULTATO emulatori dell\'APK: {"TUTTO OK" if not fallite else f"{len(fallite)} controlli non passati"}',
          flush=True)
    return not fallite


def main():
    a = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sotto = a.add_subparsers(dest='cosa', required=True)
    sotto.add_parser('pronti')
    p = sotto.add_parser('prepara')
    p.add_argument('--numero', type=int, help='il numero della versione (1.0.N), con --apk')
    p.add_argument('--apk', help='l\'APK da mettere in rilasci/')
    c = sotto.add_parser('controlla')
    c.add_argument('--telefono', action='store_true', help='controlla anche dal telefono simulato (adb)')
    x = a.parse_args()
    if x.cosa == 'pronti':
        sys.exit(0 if pronti() else 1)
    if x.cosa == 'prepara':
        if bool(x.apk) != bool(x.numero) or (x.numero is not None and not 0 < x.numero < 10000):
            a.error('--apk e --numero vanno insieme, e il numero è tra 1 e 9999')
        if x.apk and not os.path.isfile(x.apk):
            a.error(f'{x.apk} non c\'è')
        prepara(x.numero, x.apk)
        return
    sys.exit(0 if controlla(x.telefono) else 1)


if __name__ == '__main__':
    main()
