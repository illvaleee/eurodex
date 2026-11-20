# Prova vera della notifica immediata (push) su un telefono Android simulato con i servizi Google:
# installa l'ultima versione pubblicata, la apre, aspetta che si registri presso Firebase, controlla che sia
# iscritta all'argomento "aggiornamenti" e le manda una notifica di prova SOLO a lei (i telefoni veri non
# ricevono niente). Misura quanto tempo passa dall'invio alla comparsa della notifica.
# Uso: python3 scripts/prova-push-emulatore.py CollezioneEuro.apk cartella-risultati
import html, json, os, re, subprocess, sys, time
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

APK, OUT = sys.argv[1], sys.argv[2]
PKG = 'it.collezione.euro'
os.makedirs(OUT, exist_ok=True)
RIGHE, FAIL = [], []


def adb(c, timeout=120):
    try:
        return subprocess.run('adb ' + c, shell=True, capture_output=True, text=True, timeout=timeout).stdout
    except subprocess.TimeoutExpired:
        return ''


def note(m):
    print(m, flush=True); RIGHE.append(m)


def check(ok, what):
    note(('OK  ' if ok else 'NO  ') + what)
    if not ok:
        FAIL.append(what)


def shot(name):
    adb(f'shell screencap -p /sdcard/s.png'); adb(f'pull /sdcard/s.png {OUT}/{name}.png')


def prefs(nome):
    return adb(f'shell cat /data/data/{PKG}/shared_prefs/{nome}.xml')


import xml.etree.ElementTree as ET
def dump():
    for _ in range(4):
        out = adb('exec-out uiautomator dump /dev/tty', timeout=60)
        i, j = out.find('<?xml'), out.rfind('</hierarchy>')
        if i >= 0 and j > 0:
            try:
                return ET.fromstring(out[i:j + 12])
            except Exception:
                pass
        time.sleep(1.5)
    return None


def testi():
    r = dump()
    return [] if r is None else [((n.get('text') or n.get('content-desc') or '').strip(), n.get('bounds', '')) for n in r.iter('node')]


def tocca(testo, prove=3, scorri=0):
    for i in range(prove + scorri):
        best = None
        for k, (v, b) in enumerate(testi()):
            if v and testo.lower() in v.lower():
                x1, y1, x2, y2 = map(int, re.findall(r'\d+', b)[:4])
                if y2 <= y1 or y1 > 2150:
                    continue
                score = (0 if v.lower() == testo.lower() else 1, (x2 - x1) * (y2 - y1), k)
                if best is None or score < best[0]:
                    best = (score, ((x1 + x2) // 2, (y1 + y2) // 2))
        if best:
            adb(f'shell input tap {best[1][0]} {best[1][1]}'); time.sleep(2)
            return True
        if i >= prove - 1:
            adb('shell input swipe 540 1700 540 700 350')
        time.sleep(1.5)
    return False


adb('root'); time.sleep(4); adb('wait-for-device')
note('servizi Google: ' + (re.search(r'versionName=\S+', adb('shell dumpsys package com.google.android.gms')) or [''])[0])
note('installazione: ' + adb(f'install -r {APK}', timeout=300).strip().splitlines()[-1:][0])
adb(f'shell pm grant {PKG} android.permission.POST_NOTIFICATIONS')
inst = int(re.search(r'versionCode=(\d+)', adb(f'shell dumpsys package {PKG}')).group(1))
note(f'versione installata: {inst}')
# su un emulatore appena acceso i servizi Google devono prima registrare il "telefono" presso Google
# (check-in): finché non l'hanno fatto, nessuna app può ricevere notifiche push. Su un telefono vero è
# già fatto da quando è stato acceso la prima volta.
t = time.time()
while time.time() - t < 240:
    gid = adb('shell content query --uri content://com.google.android.gsf.gservices --where "name=\\\'android_id\\\'"')
    if re.search(r'value=\d{5,}', gid):
        break
    time.sleep(15)
note(f'registrazione del telefono presso Google: {"fatta" if re.search(r"value=[0-9]{5,}", gid) else "NON fatta"} dopo {int(time.time() - t)} s')
time.sleep(30)  # i servizi Google si riavviano dopo la registrazione
adb('logcat -c')
adb(f'shell monkey -p {PKG} -c android.intent.category.LAUNCHER 1')
time.sleep(20)
shot('01_app_aperta')

# 1. registrazione presso Firebase (token) e iscrizione all'argomento
def registro_firebase(n=60):
    lg = adb('logcat -d', timeout=60)
    sel = [l for l in lg.splitlines() if re.search(r'Firebase|FCM|GCM|Checkin|GmsCore.*(regist|token)|InstanceId|TopicsSubscriber|AvvisiPush|' + PKG, l, re.I)
           and 'WindowManager' not in l and 'Transition' not in l]
    for l in sel[-n:]:
        print('   | ' + l[:220], flush=True)
    return sel


token, t0, ultimo = None, time.time(), 0
while time.time() - t0 < 600:
    if not adb(f'shell pidof {PKG}').strip():  # l'app è stata chiusa (per esempio dal riavvio dei servizi Google)
        note('  (app chiusa dal sistema: la riapro)')
        adb(f'shell monkey -p {PKG} -c android.intent.category.LAUNCHER 1'); time.sleep(10)
    if time.time() - ultimo > 150:
        ultimo = time.time()
        note(f'  dopo {int(time.time() - t0)} s: file di Firebase presenti: ' + ' '.join(re.findall(r'(\S*(?:firebase|gms)\S*\.xml)', adb(f'shell ls /data/data/{PKG}/shared_prefs/'))))
        registro_firebase(25)
    x = prefs('com.google.android.gms.appid')
    m = re.search(r'<string name="\|T\|[^"]*">([^<]+)</string>', x)
    if m:
        val = html.unescape(m.group(1))
        try:
            token = json.loads(val).get('token') or val
        except Exception:
            token = val
        note(f'  token: {token[:12]}…{token[-6:]} ({len(token)} caratteri)')
        break
    time.sleep(10)
note(f'registrazione presso Firebase: {"fatta" if token else "NON fatta"} dopo {int(time.time() - t0)} s')
check(bool(token), 'l\'app si registra presso Firebase (riceverà le notifiche immediate)')
cr = service_account.Credentials.from_service_account_file(os.environ.get('FIREBASE_SA_FILE', 'keystore/firebase-invio.json'), scopes=['https://www.googleapis.com/auth/firebase.messaging'])
s = AuthorizedSession(cr)
if token:
    iscritta = False
    for _ in range(30):  # l'iscrizione all'argomento parte dopo la registrazione
        q = prefs('com.google.firebase.messaging')
        r = s.get(f'https://iid.googleapis.com/iid/info/{token}?details=true', headers={'access_token_auth': 'true'})
        note(f'  stato iscrizione: {r.status_code} {r.text[:160]} | coda: {re.findall(r"topic_operation_queue[^<]*>([^<]*)<", q)}')
        if r.ok and 'aggiornamenti' in r.text:
            iscritta = True
            break
        if not r.ok and q and 'aggiornamenti' not in q:
            note('  (il servizio di Google non dà il dettaglio, ma la coda delle iscrizioni dell\'app è vuota: iscrizione fatta)')
            iscritta = True
            break
        time.sleep(10)
    check(iscritta, 'il telefono è iscritto all\'argomento "aggiornamenti" (riceve gli avvisi di ogni versione)')

    # 2. notifica di prova solo a questo telefono, con l'app chiusa (in secondo piano)
    adb('shell input keyevent 3'); time.sleep(3)
    json.dump({'code': inst + 1, 'version': f'1.0.{inst + 1}', 'note': 'Prova della notifica immediata'}, open('/tmp/prova.json', 'w'))
    adb('shell cmd notification post -h >/dev/null')  # risveglia il servizio notifiche
    t1 = time.time()
    r = subprocess.run(['python3', 'scripts/invia-avviso.py', '/tmp/prova.json', '--token', token], capture_output=True, text=True)
    note('invio: ' + (r.stdout + r.stderr).strip()[:200])
    arrivata = None
    for _ in range(60):
        nt = adb('shell dumpsys notification --noredact')
        if PKG in nt and 'pronta' in nt:
            arrivata = time.time() - t1
            break
        time.sleep(1)
    shot('02_notifica_arrivata')
    adb('shell cmd statusbar expand-notifications'); time.sleep(2); shot('03_tendina_notifiche'); adb('shell cmd statusbar collapse')
    check(arrivata is not None, f'la notifica arriva con l\'app chiusa' + (f' dopo {arrivata:.1f} secondi' if arrivata else ''))
    imp = re.search(r'NotificationChannel\{mId=\'novita\'[^}]*mImportance=(\d)', adb(f'shell dumpsys notification'))
    note(f'canale "novita": importanza {imp.group(1) if imp else "?"} (4 = compare in alto sullo schermo)')

    # 3. stessa collezione su più dispositivi: sull'emulatore non c'è un account Google per accedere, quindi si
    # imposta a mano il "collegamento" nella parte Android (come dopo l'accesso) e si manda al telefono la
    # notifica che il postino di Firebase manda quando un altro dispositivo modifica la collezione.
    adb(f'shell am force-stop {PKG}'); time.sleep(2)
    f = f'/data/data/{PKG}/shared_prefs/aggiornamenti.xml'
    x = adb(f'shell cat {f}')
    if '<map' not in x:
        x = "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n</map>\n"
    x = re.sub(r'\s*<string name="sync_(cid|did|nome)">[^<]*</string>', '', x)
    x = x.replace('</map>', '    <string name="sync_cid">provaEmulatore123456789012</string>\n    <string name="sync_did">EMULATORE001</string>\n    <string name="sync_nome">Emulatore</string>\n</map>')
    open('/tmp/agg.xml', 'w').write(x)
    adb('push /tmp/agg.xml /data/local/tmp/agg.xml'); adb(f'shell cp /data/local/tmp/agg.xml {f}')
    uidapp = (re.search(r'userId=(\d+)', adb(f'shell dumpsys package {PKG}')) or [None, ''])[1]
    if uidapp:
        adb(f'shell chown {uidapp}:{uidapp} {f}'); adb(f'shell chmod 660 {f}')
    check('provaEmulatore' in adb(f'shell cat {f}'), 'collegamento impostato nella parte Android')
    adb(f'shell monkey -p {PKG} -c android.intent.category.LAUNCHER 1'); time.sleep(8); adb('shell input keyevent 3'); time.sleep(3)
    msg = {'message': {'token': token, 'data': {'tipo': 'sync', 'cid': 'provaEmulatore123456789012', 'did': 'TABLETPROVA1', 'nome': 'Tablet di prova',
           'testo': 'Aggiunta: 🇮🇹 2€ comm. 2024 (prova)', 'ts': str(int(time.time() * 1000))}, 'android': {'priority': 'high'}}}
    t2 = time.time()
    r = s.post(f'https://fcm.googleapis.com/v1/projects/collezione-euro-24ecd/messages:send', json=msg)
    note(f'invio notifica di sincronizzazione: {r.status_code} {r.text[:120]}')
    arr = None
    for _ in range(60):
        nt = adb('shell dumpsys notification --noredact')
        if 'Tablet di prova' in nt:
            arr = time.time() - t2
            break
        time.sleep(1)
    adb('shell cmd statusbar expand-notifications'); time.sleep(2); shot('04_notifica_sincronizzazione'); adb('shell cmd statusbar collapse')
    check(arr is not None, 'modifica su un altro dispositivo: la notifica "Eurodex · da Tablet di prova" arriva con l\'app chiusa' + (f' dopo {arr:.1f} secondi' if arr else ''))
    # la stessa notifica mandata dal dispositivo stesso va ignorata
    msg['message']['data']['did'] = 'EMULATORE001'; msg['message']['data']['nome'] = 'Me stesso'
    s.post(f'https://fcm.googleapis.com/v1/projects/collezione-euro-24ecd/messages:send', json=msg); time.sleep(10)
    check('Me stesso' not in adb('shell dumpsys notification --noredact'), 'le modifiche fatte dal dispositivo stesso non gli arrivano come notifica')

open(f'{OUT}/logcat_firebase.txt', 'w').write('\n'.join(registro_firebase(80)))
note('RISULTATO: ' + ('TUTTO OK' if not FAIL else 'PROBLEMI: ' + '; '.join(FAIL)))
open(f'{OUT}/esito.txt', 'w').write('\n'.join(RIGHE) + '\n')
sys.exit(1 if FAIL else 0)
