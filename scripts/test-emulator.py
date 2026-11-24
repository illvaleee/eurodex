# Prova dell'APK su un telefono Android simulato (GitHub Actions, emulatore API 34).
# Fa quello che farebbe una persona: tocca i pulsanti cercandoli per testo, scatta le schermate
# e controlla installazione, avvio, navigazione, backup su file, modalità scura,
# backup automatico di Android (disinstalla e reinstalla) ed errori nel registro.
# Uso: python3 scripts/test-emulator.py CollezioneEuro.apk cartella-risultati
import json, os, re, subprocess, sys, time, zipfile
import xml.etree.ElementTree as ET

APK, OUT = sys.argv[1], sys.argv[2]
PKG = 'it.collezione.euro'
os.makedirs(OUT, exist_ok=True)
LOG = open(os.path.join(OUT, 'esito.txt'), 'w')
FAIL = []


def sh(cmd, timeout=180):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return ((r.stdout or '') + (r.stderr or '')).strip()
    except subprocess.TimeoutExpired:
        return 'TIMEOUT'


def adb(c, timeout=180):
    return sh('adb ' + c, timeout)


def note(msg):
    print(msg, flush=True)
    LOG.write(msg + '\n')
    LOG.flush()


N = [0]


def shot(name):
    N[0] += 1
    fn = f'{N[0]:02d}_{name}.png'
    subprocess.run(f'adb exec-out screencap -p > "{OUT}/{fn}"', shell=True)
    note(f'[schermata] {fn}')


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


def center(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '0,0,0,0'))[:4])
    return (x1 + x2) // 2, (y1 + y2) // 2


def size(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '0,0,0,0'))[:4])
    return x2 - x1, y2 - y1


SCHEDE = ('collezione', 'le mie', 'catalogo', 'mancanti', 'extra', 'cerca')


def fondo_utile(root):
    """Fin dove si può toccare: sopra la barra delle schede se è raggiungibile (con una finestra aperta non lo è, e
    allora fino in fondo, sopra i tasti di Android). Si legge dallo schermo, niente misure fisse."""
    finestra = next(root.iter('node'), None)   # il primo elemento è la finestra dell'app: la sua altezza è lo schermo utile
    alto = center(finestra)[1] + size(finestra)[1] // 2 if finestra is not None else 2400
    barra = [center(n)[1] - size(n)[1] // 2 for n in root.iter('node')
             if (n.get('text') or n.get('content-desc') or '').strip().lower() in SCHEDE and center(n)[1] > alto * 0.75]
    return min(barra) - 4 if barra else alto - 8


def find(text, exact=False, maxy=None, non=None):
    root = dump()
    if root is None:
        return None
    t = text.lower()
    if maxy == 'auto':
        maxy = fondo_utile(root)
    # tra tutte le voci che contengono il testo si sceglie la più precisa: prima quelle col testo identico (la prima
    # dall'alto), poi la più piccola tra quelle che lo contengono. (Un riquadro che contiene tutta una sezione ha lo stesso testo dentro, e il suo centro sta altrove:
    # toccarlo farebbe premere il pulsante sbagliato)
    best = None
    for i, node in enumerate(root.iter('node')):
        for attr in ('text', 'content-desc'):
            v = (node.get(attr) or '').strip().lower()
            if v and non and non.lower() in v:
                break   # voce da non toccare (es. l'immagine "Dettagli: 1 cent" quando si vuole aprire la riga "1 cent")
            if v and (v == t if exact else t in v):
                x, y = center(node)
                w, h = size(node)
                # le voci fuori dallo schermo (dentro un riquadro che scorre) hanno un'area tagliata: si saltano
                # la barra delle schede stessa si tocca sempre; il resto solo se sta sopra la barra (sotto è coperto)
                if y > 0 and (maxy is None or v in SCHEDE or (y < maxy and w >= 30 and h >= 30)):
                    # testo identico: la prima in ordine (come una persona che legge dall'alto); testo contenuto: la più piccola
                    score = (0, 0, i) if v == t else (1, w * h, i)
                    if best is None or score < best[0]:
                        best = (score, (x, y))
                break   # trovata in questo attributo: l'altro non serve
    return best[1] if best else None


def dismiss_dialogs():
    # l'emulatore di GitHub è lento e a volte Android mostra "X isn't responding" (di solito il launcher,
    # non la nostra app): la finestra copre tutto, quindi si tocca "Wait" e si va avanti
    for _ in range(3):
        root = dump()
        if root is None:
            return
        texts = [(n.get('text') or '') for n in root.iter('node')]
        if not any(re.search(r"isn.t responding|non risponde", t, re.I) for t in texts):
            return
        note('  (finestra di Android "non risponde": tocco Attendi)')
        p = find('Wait', exact=True) or find('Attendi', exact=True)
        if p:
            adb(f'shell input tap {p[0]} {p[1]}')
        else:
            adb('shell input keyevent 4')
        time.sleep(2)


def impronta():
    return adb('exec-out "screencap | md5sum"', timeout=30)[:32]


def tap(text, exact=False, wait=1.8, tries=4, required=True, scroll=0, non=None):
    # Come una persona: se la voce non si vede, prima aspetta un attimo (la pagina può essere ancora in arrivo),
    # poi scorre in giù finché la trova o finché la pagina non scorre più (fine della pagina). Nessun numero fisso
    # di scorrimenti: tanti quanti ne servono. (scroll resta per compatibilità: ogni valore > 0 vuol dire "scorri")
    for i in range(tries):
        p = find(text, exact, maxy='auto', non=non)
        if p:
            adb(f'shell input tap {p[0]} {p[1]}')
            time.sleep(wait)
            note(f'tocco "{text}": ok')
            return True
        if i == 0:
            dismiss_dialogs()
        time.sleep(1.2)
    prima = impronta()
    for _ in range(40):
        swipe_up()
        p = find(text, exact, maxy='auto', non=non)
        if p:
            adb(f'shell input tap {p[0]} {p[1]}')
            time.sleep(wait)
            note(f'tocco "{text}": ok (dopo aver scorso la pagina)')
            return True
        ora = impronta()
        if ora == prima:
            break   # la pagina non scorre più: la voce non c'è
        prima = ora
    note(f'!! non trovato "{text}"')
    if required:
        FAIL.append(f'non trovato "{text}"')
    return False


def visible(text):
    return find(text) is not None


def testi_schermo():
    """Tutto quello che c'è scritto sullo schermo adesso, letto una volta sola (una lettura dura qualche secondo:
    per i messaggi brevi si controlla tutto insieme, altrimenti il messaggio sparisce prima di arrivarci)."""
    root = dump()
    if root is None:
        return ''
    return '\n'.join(((n.get('text') or '') + ' ' + (n.get('content-desc') or '')).strip().lower() for n in root.iter('node'))


def back(wait=1.2):
    adb('shell input keyevent 4')
    time.sleep(wait)


def scorri_finche(testo):
    """Scorre in giù finché il testo compare o la pagina non scorre più (come chi cerca una voce in una pagina)."""
    if visible(testo):
        return True
    prima = impronta()
    for _ in range(40):
        swipe_up()
        if visible(testo):
            return True
        ora = impronta()
        if ora == prima:
            return False
        prima = ora
    return False


def fino_in_fondo():
    prima = impronta()
    for _ in range(40):
        swipe_up()
        ora = impronta()
        if ora == prima:
            return
        prima = ora


def swipe_up():
    adb('shell input swipe 540 1700 540 600 350')
    time.sleep(1.2)


def in_front():
    out = adb('shell dumpsys activity activities')
    m = re.search(r'(topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*', out)
    return bool(m and PKG in m.group(0))


def launch(wait=10):
    adb(f'shell monkey -p {PKG} -c android.intent.category.LAUNCHER 1')
    time.sleep(wait)
    # aspetta che l'app abbia disegnato la schermata (al primo avvio l'emulatore è lento)
    for _ in range(20):
        dismiss_dialogs()
        if visible('Collezione') or visible('Catalogo'):
            return True
        time.sleep(3)
    return False


def chiudi_fogli():
    # finestre dell'app che compaiono all'apertura: benvenuto (primo avvio), novità dopo un aggiornamento,
    # domanda sugli avvisi. Una persona le chiude e va avanti: la prova fa lo stesso.
    for _ in range(3):
        p = find('Più tardi', exact=True) or find('Inizia', exact=True) or find('Ok', exact=True) or find('No, grazie', exact=True) or find('Non ora', exact=True)
        if not p:
            # finestra delle novità senza pulsante in vista (versioni vecchie, dove il pulsante sta in fondo): indietro
            if visible('Aggiornata alla versione'):
                adb('shell input keyevent 4'); note('  (chiusa la finestra delle novità con Indietro)'); time.sleep(1.5); continue
            return
        adb(f'shell input tap {p[0]} {p[1]}')
        note('  (chiusa una finestra di apertura dell\'app)')
        time.sleep(1.5)


def ensure_app():
    if not in_front():
        note('  (l\'app non era in primo piano: la riapro)')
        launch(8)


def number_before(word):
    root = dump()
    if root is None:
        return None
    for node in root.iter('node'):
        v = (node.get('text') or '')
        m = re.search(r'([\d.]+)\s+' + word, v)
        if m:
            return int(m.group(1).replace('.', ''))
    return None


def check(cond, what):
    note(('OK  ' if cond else 'NO  ') + what)
    if not cond:
        FAIL.append(what)


note(adb('wait-for-device'))
note('schermo: ' + adb('shell wm size'))
note('android: ' + adb('shell getprop ro.build.version.release'))
note('installazione: ' + adb(f'install -r {APK}', timeout=400))
time.sleep(15)  # appena acceso, l'emulatore è ancora occupato: si lascia respirare
dismiss_dialogs()
adb('shell bmgr enable true')
adb('shell bmgr autorestore true')
note('trasporti backup: ' + adb('shell bmgr list transports').replace('\n', ' | '))
note(adb('shell bmgr transport com.android.localtransport/.LocalTransport'))
adb('shell settings put global window_animation_scale 0')
adb('shell settings put global hide_error_dialogs 1')  # niente finestre "non risponde" di Android (i crash si leggono dal registro)
adb('logcat -c')

MODE = sys.argv[3] if len(sys.argv) > 3 else 'completa'
if MODE == 'sopra':
    # Prova PRIMA della pubblicazione: sul telefono c'è la versione già pubblicata (APK), con delle monete segnate e
    # una preferita; ci si installa sopra la versione nuova (come fa l'aggiornamento) e la collezione deve esserci
    # tutta, senza rivedere il benvenuto e senza errori. Così chi aggiorna non può perdere niente.
    NUOVA_APK = sys.argv[4]
    launch(15)
    chiudi_fogli()
    ensure_app(); chiudi_fogli()
    tap('Mancanti', exact=True)
    MISS0 = number_before('mancanti')
    tap('Catalogo', exact=True)
    tap('Elenco', exact=True, required=False)
    tap('Italia', scroll=8)
    tap('1 cent', non='Dettagli')
    tap('2002 R' if find('2002 R', exact=True) else 'R', exact=True, wait=1.0)
    shot('vecchia_segnata')
    # preferita: dalla scheda della moneta (nella versione vecchia la stella si chiama "Preferita")
    tap('Dettagli', wait=3)
    stella = 'Aggiungi alle preferite' if find('Aggiungi alle preferite', exact=True) else 'Preferita'
    tap(stella, exact=True, wait=1.0)
    shot('vecchia_preferita')
    back()
    ensure_app()
    tap('Mancanti', exact=True)
    MISS1 = number_before('mancanti')
    check(MISS0 is not None and MISS1 == MISS0 - 1, 'versione vecchia: segnata una moneta')
    tap('Collezione', exact=True)
    check(visible('Preferite'), 'versione vecchia: aggiunta una preferita')
    adb(f'shell am force-stop {PKG}')
    time.sleep(2)
    VECCHIA = re.search(r'versionCode=(\d+)', adb(f'shell dumpsys package {PKG}'))
    esito = adb(f'install -r {NUOVA_APK}', timeout=400)
    note('installazione sopra: ' + esito.replace('\n', ' '))
    DOPO = re.search(r'versionCode=(\d+)', adb(f'shell dumpsys package {PKG}'))
    note(f'versione: {VECCHIA.group(1) if VECCHIA else "?"} → {DOPO.group(1) if DOPO else "?"}')
    check('Success' in esito and VECCHIA and DOPO and int(DOPO.group(1)) > int(VECCHIA.group(1)),
          'la versione nuova si installa sopra quella vecchia (stessa firma, numero più alto)')
    adb('logcat -c')
    launch(15)
    shot('nuova_avvio')
    check(not visible('Benvenuto'), 'dopo l\'aggiornamento non ricompare il benvenuto del primo avvio')
    chiudi_fogli()
    ensure_app(); chiudi_fogli()
    tap('Mancanti', exact=True)
    MISS2 = number_before('mancanti')
    shot('nuova_mancanti')
    note(f'mancanti: prima {MISS1}, dopo {MISS2}')
    # le mancanti dipendono dal catalogo dentro l'APK: se la versione nuova porta monete nuove (come quelle del 23/11),
    # cambiano. Si conta come nella prova dell'aggiornamento: mancanti + varianti (scheda Extra) + segnate = pezzi del
    # catalogo nuovo, così nessuna moneta segnata può sparire senza che si veda
    segnate = (MISS0 - MISS1) if MISS0 is not None and MISS1 is not None else None
    try:
        with zipfile.ZipFile(NUOVA_APK) as z:
            totale = sum(len(t['p']) for t in json.loads(z.read('assets/public/data/catalog.json'))['types'])
    except Exception as e:
        note(f'pezzi del catalogo nuovo non letti: {e}')
        totale = None
    varianti = 0
    if visible('Extra'):
        tap('Extra', exact=True)
        varianti = number_before('varianti') or 0
        shot('nuova_extra')
    atteso = (totale - segnate) if totale and segnate is not None else MISS1
    note(f'monete segnate: {segnate}, pezzi nel catalogo nuovo: {totale}, varianti nella scheda Extra: {varianti}, '
         f'mancanti {MISS2} + varianti {varianti} = {(MISS2 or 0) + varianti}, atteso {atteso}')
    # la moneta segnata è ancora segnata (il pezzo 2002 R risulta "selezionato" anche per TalkBack)
    tap('Catalogo', exact=True)
    tap('Elenco', exact=True, required=False)
    tap('Italia', scroll=8)
    tap('1 cent', non='Dettagli')
    root = dump()
    pezzo = next((n for n in root.iter('node') if (n.get('text') or n.get('content-desc') or '').strip() in ('2002 R',)), None) if root is not None else None
    shot('nuova_pezzo_segnato')
    check(pezzo is not None and pezzo.get('checked') == 'true', 'dopo l\'aggiornamento la moneta segnata è ancora segnata')
    check(MISS2 is not None and MISS2 + varianti == atteso,
          'dopo l\'aggiornamento la collezione è ancora tutta lì (mancanti + varianti + segnate = pezzi del catalogo)')
    tap('Collezione', exact=True)
    check(visible('Preferite'), 'dopo l\'aggiornamento la preferita c\'è ancora')
    shot('nuova_collezione')
    errori = [r for r in adb('logcat -d -s Eurodex:E AndroidRuntime:E', timeout=60).splitlines() if ' E ' in r]
    check(in_front() and not errori, f'la versione nuova si apre e funziona senza errori ({errori[:2]})')
    note('\nRISULTATO: ' + ('TUTTO OK' if not FAIL else 'PROBLEMI: ' + '; '.join(FAIL)))
    LOG.close()
    sys.exit(1 if FAIL else 0)
if MODE == 'aggiornamento':
    # Prova dell'aggiornamento dall'app, come lo farà l'amico: sul telefono c'è la versione precedente
    # (APK), sul sito di download quella appena pubblicata (NUOVA). L'app vecchia deve accorgersene,
    # scaricarla e installarla, e la collezione deve restare.
    import json, urllib.request
    NUOVA = int(sys.argv[4])
    BASE = 'https://raw.githubusercontent.com/illvaleee/collezione-euro-download/main/'
    v = {}
    for _ in range(40):  # la copia su internet si aggiorna entro qualche minuto dalla pubblicazione
        try:
            v = json.load(urllib.request.urlopen(BASE + 'version.json?t=' + str(time.time()), timeout=30))
        except Exception as e:
            note('version.json non letto: ' + str(e))
        if v.get('code') == NUOVA:
            break
        time.sleep(15)
    note(f'versione pubblicata: {v}')
    check(v.get('code') == NUOVA, f'sul sito di download c\'è la versione nuova ({NUOVA})')
    # anche il file APK col nome fisso (quello che scaricano le versioni più vecchie) deve essere già quello nuovo
    for _ in range(40):
        try:
            r = urllib.request.urlopen(urllib.request.Request(BASE + 'CollezioneEuro.apk', method='HEAD'), timeout=30)
            if int(r.headers.get('Content-Length') or 0) == v.get('size'):
                break
        except Exception as e:
            note('APK non raggiungibile: ' + str(e))
        time.sleep(15)
    adb(f'shell appops set {PKG} REQUEST_INSTALL_PACKAGES allow')
    # sull'emulatore con i servizi Google, appena acceso, i servizi si riavviano e chiudono le app aperte:
    # si aspetta che si calmino e, se l'app viene chiusa lo stesso, la si riapre (come farebbe una persona)
    time.sleep(45)
    launch(15)
    for _ in range(3):
        if in_front():
            break
        note('  (app chiusa dal sistema subito dopo l\'apertura: la riapro)')
        launch(15)
    if visible('È uscita la versione'):
        shot('avviso_aggiornamento_all_avvio')
        check(True, 'all\'apertura la versione vecchia dice subito che è uscita quella nuova (si può andare avanti)')
    else:
        note('la versione vecchia non ha ancora l\'avviso all\'apertura')
    chiudi_fogli()
    VECCHIA = re.search(r'versionCode=(\d+)', adb(f'shell dumpsys package {PKG}'))
    note(f'installata ora: {VECCHIA.group(1) if VECCHIA else "?"}')
    ensure_app(); chiudi_fogli()
    tap('Mancanti', exact=True)
    MISS0 = number_before('mancanti')
    tap('Catalogo', exact=True)
    tap('Elenco', exact=True, required=False)
    tap('Italia', scroll=8)
    tap('1 cent', non='Dettagli')
    # il pezzo 2002 R: nelle versioni nuove TalkBack lo chiama "2002 R", fino alla 1.0.78 solo "R"
    tap('2002 R' if find('2002 R', exact=True) else 'R', exact=True, wait=1.0)
    tap('Mancanti', exact=True)
    MISS1 = number_before('mancanti')
    check(MISS0 is not None and MISS1 == MISS0 - 1, 'segnata una moneta prima dell\'aggiornamento')
    # notifica immediata (push): se la versione vecchia la sa ricevere, si rimanda il messaggio della versione nuova
    # attraverso Firebase e si guarda se la notifica arriva entro un minuto (serve l'emulatore con i servizi Google)
    push_ok = False
    adb(f'shell pm grant {PKG} android.permission.POST_NOTIFICATIONS')  # come chi ha risposto "Sì, avvisami"
    if 'AvvisiPush' in adb(f'shell dumpsys package {PKG}'):
        json.dump(v, open('/tmp/versione.json', 'w'))
        time.sleep(10)  # tempo per l'iscrizione all'argomento "aggiornamenti"
        import subprocess
        r = subprocess.run(['python3', 'scripts/invia-avviso.py', '/tmp/versione.json'], capture_output=True, text=True)
        note('invio push: ' + (r.stdout + r.stderr).strip()[-200:])
        nt = ''
        for _ in range(40):  # fino a 2 minuti: su un emulatore appena acceso i servizi Google sono lenti la prima volta
            time.sleep(3)
            nt = adb('shell dumpsys notification --noredact')
            if 'pronta' in nt and PKG in nt:
                push_ok = True
                break
        shot('notifica_push')
        if push_ok:
            check(True, 'notifica immediata (push): arriva pochi secondi dopo la pubblicazione')
        else:
            # su un emulatore appena acceso i servizi Google si riavviano e chiudono l'app: la prova completa
            # della notifica immediata la fa il workflow "Prova notifiche push" (parte dopo ogni pubblicazione)
            note('notifica push non arrivata su questo emulatore appena acceso: vedi il workflow "Prova notifiche push"')
    else:
        note('versione vecchia senza notifiche push: prova push saltata')
    # avviso in secondo piano: si fa girare subito il controllo pianificato (portando avanti l'orologio di 2 ore,
    # come se fosse passato il tempo) e si guarda se Android mostra la notifica della versione nuova
    adb(f'shell pm grant {PKG} android.permission.POST_NOTIFICATIONS')
    js = adb('shell dumpsys jobscheduler')
    ids = sorted(set(re.findall(r'JOB #u0a\d+/(\d+): \S+ ' + re.escape(PKG) + r'/androidx\.work', js)))
    if ids and not push_ok:
        adb('root'); time.sleep(3); adb('wait-for-device')
        adb('shell "date $(date -d @$(( $(date +%s) + 7200 )) +%m%d%H%M%Y.%S)"')
        for i in ids:
            adb(f'shell cmd jobscheduler run -f {PKG} {i}')
        nt = ''
        for _ in range(10):
            time.sleep(3)
            nt = adb('shell dumpsys notification --noredact')
            if 'pronta' in nt and PKG in nt:
                break
        shot('notifica')
        check('pronta' in nt and PKG in nt, 'avviso: arriva la notifica della versione nuova (controllo in secondo piano)')
    elif not push_ok:
        note('versione vecchia senza avvisi in secondo piano: controllo della notifica saltato')
    tap('Collezione', exact=True)
    seen = False
    for _ in range(8):
        if visible('Nuova versione'):
            seen = True
            break
        adb(f'shell am force-stop {PKG}')
        launch(8)
    shot('avviso_nuova_versione')
    check(seen, 'la versione vecchia avvisa che c\'è quella nuova')
    if seen:
        tap('Nuova versione', wait=2)
        shot('finestra_aggiornamento')
        tap('Scarica e installa', wait=3)
        done = False
        for _ in range(60):  # download (35 MB) e finestra di Android
            p = find('Update', exact=True) or find('Aggiorna', exact=True) or find('Install', exact=True) or find('Installa', exact=True)
            if p:
                shot('conferma_android')
                adb(f'shell input tap {p[0]} {p[1]}')
                note('tocco il pulsante di Android per aggiornare')
                done = True
                break
            time.sleep(3)
        check(done, 'l\'app scarica la versione nuova e apre la finestra di installazione di Android')
        ok = False
        for _ in range(40):
            m = re.search(r'versionCode=(\d+)', adb(f'shell dumpsys package {PKG}'))
            if m and int(m.group(1)) == NUOVA:
                ok = True
                break
            time.sleep(3)
        shot('dopo_installazione')
        check(ok, f'dopo l\'aggiornamento è installata la versione {NUOVA}')
        adb(f'shell am force-stop {PKG}')
        # la finestra di Android "App installata" (Fine / Apri) può restare sopra all'app: si chiude come farebbe una persona
        for t in ('Done', 'Fine', 'Open', 'Apri'):
            pp = find(t, exact=True)
            if pp:
                adb(f'shell input tap {pp[0]} {pp[1]}'); note(f'  (chiusa la finestra di Android "App installata": {t})'); time.sleep(2)
                break
        launch(15)
        nov = visible('Aggiornata alla versione')
        shot('novita_dopo_aggiornamento')
        check(nov, 'dopo l\'aggiornamento l\'app dice cosa è cambiato')
        chiudi_fogli()
        tap('Mancanti', exact=True)
        MISS2 = number_before('mancanti')
        shot('mancanti_dopo_aggiornamento')
        note(f'mancanti: prima {MISS1}, dopo l\'aggiornamento {MISS2}')
        # se il catalogo nuovo ha un numero diverso di pezzi (varianti unite o monete nuove), le mancanti cambiano di
        # conseguenza: conta che le monete segnate siano ancora tutte lì
        segnate = (MISS0 - MISS1) if MISS0 is not None and MISS1 is not None else None
        totale = (v.get('stat') or {}).get('pezzi')
        # dalla 1.0.78 le varianti (errori di conio, stelle grandi/piccole...) stanno nella scheda Extra e non
        # contano tra le mancanti: si leggono lì e si sommano, così nessun pezzo può sparire senza che si veda
        varianti = 0
        if visible('Extra'):
            tap('Extra', exact=True)
            varianti = number_before('varianti') or 0
            shot('extra_dopo_aggiornamento')
        atteso = (totale - segnate) if totale and segnate is not None else MISS1
        note(f'monete segnate prima: {segnate}, pezzi nel catalogo nuovo: {totale}, varianti nella scheda Extra: {varianti}, '
             f'mancanti {MISS2} + varianti {varianti} = {(MISS2 or 0) + varianti}, atteso {atteso}')
        check(MISS2 is not None and MISS2 + varianti == atteso, 'dopo l\'aggiornamento la collezione è ancora tutta lì')
    log = adb('logcat -d', timeout=120)
    open(os.path.join(OUT, 'logcat.txt'), 'w').write('\n'.join(l for l in log.splitlines() if re.search(r'Capacitor|chromium|AndroidRuntime|FATAL|PackageInstaller|' + PKG, l)))
    note('\nRISULTATO: ' + ('TUTTO OK' if not FAIL else 'PROBLEMI: ' + '; '.join(FAIL)))
    LOG.close()
    sys.exit(1 if FAIL else 0)

# 1. avvio: prima l'animazione di apertura (video), poi il benvenuto del primo avvio
adb('logcat -c')
# l'emulatore ha le animazioni di sistema spente, che per Android vuol dire "riduci il movimento":
# in quel caso l'app (giustamente) salta l'animazione. Per provarla si riaccendono, solo per questo avvio.
for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):
    adb(f'shell settings put global {k} 1')
adb(f'shell monkey -p {PKG} -c android.intent.category.LAUNCHER 1')
# tre fotogrammi dell'animazione: fondo blu e, in almeno uno, monete o logo dorati (il video si muove davvero)
from PIL import Image
scuri_tot = dorati_max = 0
for k, attesa in enumerate([1.2, 1.1, 1.1]):
    time.sleep(attesa)
    shot(f'animazione_{k + 1}')
    try:
        im = Image.open(os.path.join(OUT, sorted(f for f in os.listdir(OUT) if f.endswith(f'animazione_{k + 1}.png'))[-1])).convert('RGB').resize((108, 240))
        px = list(im.getdata())
        scuri_tot += sum(1 for p in px if sum(p) < 200) > len(px) * 0.4
        dorati_max = max(dorati_max, sum(1 for p in px if p[0] > 150 and p[0] > p[2] + 40))
    except Exception as e:
        note('fotogramma non letto: ' + str(e))
lg = adb('logcat -d', timeout=60)
open(os.path.join(OUT, 'logcat_video.txt'), 'w').write('\n'.join(l for l in lg.splitlines() if re.search(r'animazione|MediaCodec|CCodec|Codec2|c2\.android|cr_Media|VideoCapab|MediaPlayer|OMX', l)))
note('registro animazione: ' + ' | '.join(l.split('Console')[-1][:80] for l in lg.splitlines() if 'animazione:' in l))
for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):
    adb(f'shell settings put global {k} 0')
check(scuri_tot >= 2, 'all\'apertura c\'è l\'animazione sul fondo blu')
if dorati_max > 40 or 'animazione: in riproduzione' in lg:
    check(True, f'il video dell\'animazione si vede (punti dorati: {dorati_max})')
elif 'c2.goldfish.h264.decoder' in lg:
    # Il decodificatore video dell'emulatore (goldfish) passa i fotogrammi alla scheda grafica del computer,
    # che su GitHub non c'è: il video resta fermo al primo fotogramma. Qui si controlla solo che l'app non
    # resti bloccata (dopo al massimo 6 secondi l'animazione si chiude e parte il benvenuto, controllato sotto).
    note('video: il decodificatore dell\'emulatore senza scheda grafica non produce immagini; il video si prova sul telefono vero')
else:
    check(False, f'il video dell\'animazione si vede (punti dorati: {dorati_max})')
launch(10)
if visible('Benvenuto'):
    shot('benvenuto')
    check(visible('Importa la collezione'), 'primo avvio: compare il benvenuto con l\'importazione')
    tap('Inizia', exact=True)
shot('avvio')
check(visible('monete in collezione'), 'la schermata iniziale si apre')
check(not visible('Benvenuto'), 'il benvenuto si chiude e non ricompare')

# quante mancanti all'inizio (serve per controllare che il segno e il ripristino funzionino davvero)
tap('Mancanti', exact=True)
MISS0 = number_before('mancanti')
note(f'mancanti all\'inizio: {MISS0}')

# 2. catalogo, mappa, paese
ensure_app()
tap('Catalogo', exact=True)
shot('catalogo')
tap('Mappa', exact=True)
time.sleep(1)
shot('mappa')
tap('Elenco', exact=True)
tap('Italia', scroll=8)
shot('italia')
check(visible('Per taglio'), 'si apre la pagina di un paese')

# 3. segnare una moneta e annullare
ensure_app()
# la riga "1 cent" si apre toccando il nome (l'immagine della moneta a sinistra apre invece la scheda completa)
tap('1 cent', non='Dettagli')
shot('italia_1cent')
tap('2002 R', exact=True, wait=1.0)  # il primo pezzo (2002) resta segnato come prova per il backup
shot('segnata')
check(visible('Annulla'), 'dopo aver segnato compare "Annulla"')

# 4. scheda moneta e zoom
ensure_app()
tap('Dettagli: 1 cent', wait=3)
shot('scheda')
check(visible('Emissioni'), 'la scheda moneta mostra le emissioni')
tap('Ingrandisci il lato nazionale', wait=2, required=False)
shot('zoom')
back()
swipe_up()
shot('scheda_tabella')
# con le stime di valore la tabella delle emissioni è lunga: si scorre finché compaiono le caratteristiche
car = scorri_finche('Caratteristiche')
shot('scheda_caratteristiche')
check(car, 'la scheda completa (Numista) si carica')
back()
shot('dopo_indietro')

# 5. mancanti e cerca
ensure_app()
tap('Mancanti', exact=True)
shot('mancanti')
MISS_BEFORE = number_before('mancanti')
note(f'mancanti dopo aver segnato: {MISS_BEFORE}')
check(MISS0 is not None and MISS_BEFORE == MISS0 - 1, 'segnata una moneta: le mancanti scendono di 1')
tap('Cerca', exact=True)
shot('cerca')

# 6. impostazioni, backup su file scelto (qui la memoria del telefono al posto di Drive), aggiornamenti
ensure_app()
tap('Impostazioni', wait=2.5)
shot('impostazioni')
# il riquadro di Google Drive sta più in basso: si scorre piano (senza "lancio") e si aspetta che la pagina sia ferma,
# perché Android aggiorna le posizioni dei pulsanti solo a pagina ferma (altrimenti il tocco cade sul pulsante sbagliato)
adb('shell input swipe 540 1700 540 900 1200'); time.sleep(2); dump()
if tap('Collega Google Drive', wait=4):
    shot('selettore_file')
    if not tap('SAVE', exact=True, wait=5, required=False):
        tap('Salva', exact=True, wait=5, required=False)
    time.sleep(3)
    shot('backup_collegato')
    # come una persona: la conferma si cerca nella scheda (che resta nel punto in cui si era), scorrendo se serve
    check(scorri_finche('Backup automatico attivo'), 'il backup su file scelto funziona (scrittura riuscita)')
shot('impostazioni_2')
# il pulsante è in fondo alle impostazioni: si scorre fino in fondo, così è davvero sullo schermo
# (le posizioni che Android legge dalla pagina si aggiornano solo dopo uno scorrimento a vuoto: si scorre più
# del necessario, così all'ultimo giro la pagina è già ferma in fondo e il tocco cade sul pulsante giusto)
fino_in_fondo()
time.sleep(1.5)


def nodi(*testi):
    # dove Android dice che si trovano i pulsanti (per capire dove finisce il tocco)
    root = dump(); out = {}
    if root is None:
        return out
    for n in root.iter('node'):
        v = (n.get('text') or n.get('content-desc') or '').strip()
        for t in testi:
            if v.lower() == t.lower() and t not in out:
                out[t] = (center(n), n.get('bounds'))
    return out


pos = nodi('Controlla aggiornamenti', 'Novità delle versioni', 'Storico delle modifiche')
note(f'  posizioni lette: {pos}')
shot('prima_del_tocco_aggiornamenti')
def risposta_al_controllo():
    """Una persona tocca e guarda subito lo schermo: la risposta ("Hai già l'ultima versione ✓") resta pochi secondi,
    e una lettura dello schermo dura qualche secondo. Quindi niente letture separate prima: a ogni lettura si
    controlla tutto insieme (attesa, risposta, e se per sbaglio si è aperta la finestra delle novità)."""
    ok, attesa, novita, visti = False, False, False, set()
    fine = time.time() + 30
    while time.time() < fine:
        tutto = testi_schermo()
        attesa = attesa or 'controllo in corso' in tutto
        for t in ('catalogo aggiornato', 'controllo non riuscito', 'serve la versione nuova', 'si controllano nell'):
            if t in tutto:
                visti.add(t)
        if 'ultima versione' in tutto or 'nuova versione' in tutto:
            ok = True
            break
        if 'novità delle versioni' in tutto and 'controlla aggiornamenti' not in tutto and 'controllo in corso' not in tutto:
            novita = True
            break
        if 'controllo non riuscito' in visti or 'si controllano nell' in visti:
            break
    return ok, attesa, novita, visti


ok, attesa_vista, novita_aperta, visti = False, False, False, set()
if tap('Controlla aggiornamenti', exact=True, wait=0):
    ok, attesa_vista, novita_aperta, visti = risposta_al_controllo()
if novita_aperta:
    # il tocco è finito sul pulsante sotto: si ripete spostandosi in su della distanza fra i due pulsanti
    note('  (il tocco è finito su "Novità delle versioni": riprovo un pulsante più in alto)')
    back(); tap('Impostazioni', wait=2.5)
    fino_in_fondo()
    time.sleep(1.5)
    pos = nodi('Controlla aggiornamenti', 'Novità delle versioni')
    note(f'  posizioni lette (2): {pos}')
    if len(pos) == 2:
        (x1, y1), _ = pos['Controlla aggiornamenti']; (_, y2), _ = pos['Novità delle versioni']
        adb(f'shell input tap {x1} {y1 - (y2 - y1)}')
        ok, attesa_vista, novita_aperta, visti = risposta_al_controllo()
if visti:
    note(f'  (messaggi visti durante il controllo: {sorted(visti)})')
shot('aggiornamenti')
note(f'  (durante il controllo il pulsante mostra "Controllo in corso…": {"sì" if attesa_vista else "non visto (risposta immediata?)"})')
check(ok, 'il controllo aggiornamenti risponde (legge la versione pubblicata)')
shot('impostazioni_3')

# 6b. catalogo in PDF: il file si crea e si apre la condivisione di Android (salva su Drive, manda su WhatsApp…)
if tap('Crea il PDF del catalogo', exact=True, wait=6, required=False):
    sopra = adb('shell dumpsys activity activities')
    m = re.search(r'topResumedActivity[^\n]*', sopra)
    cima = m.group(0) if m else ''
    shot('pdf_condivisione')
    note(f'  (dopo il tocco in primo piano: {cima[-90:]})')
    check(PKG not in cima and re.search(r'[Cc]hooser|intentresolver|Resolver|Share', cima) is not None,
          'catalogo in PDF: si crea il file e si apre la condivisione di Android')
    back(wait=2)
    ensure_app()
else:
    check(False, 'catalogo in PDF: c\'è il pulsante nelle impostazioni')
back()

# 7. modalità scura
adb('shell cmd uimode night yes')
time.sleep(3)
adb(f'shell am force-stop {PKG}')
aperta = launch(8)
chiudi_fogli()   # (una volta sola compare la proposta di accedere con Google: "Non ora")
shot('scuro_home')
try:
    from PIL import Image
    im = Image.open(os.path.join(OUT, f'{N[0]:02d}_scuro_home.png')).convert('RGB')

    def luci(y):
        # luminosità dei punti di una riga (uno ogni 3), dal più scuro al più chiaro
        return sorted(sum(im.getpixel((x, y))) / 3 for x in range(0, im.width, 3))

    # Conta la luminosità mediana, non il colore più frequente. Le scritte e le icone delle schede occupano meno di
    # metà della riga, ma con la barra sfocata (PR #12) lo sfondo non è più un colore solo: sono tante sfumature
    # quasi uguali, e ognuna da sola perdeva contro il grigio delle scritte («colore (138, 145, 156)» sulla 1.0.82,
    # con l'app scura).
    basso = luci(int(im.height * 0.93))   # barra delle schede, all'altezza delle scritte
    alto = luci(int(im.height * 0.085))   # barra del titolo
    mb, ma = basso[len(basso) // 2], alto[len(alto) // 2]
    # le scritte delle schede devono vedersi: una schermata tutta scura (l'animazione d'apertura, uno schermo nero)
    # non dice niente sulla modalità scura dell'app
    scritte = sum(1 for v in basso if v > 100)
    chiusa = '' if aperta else "; l'app non risulta aperta"
    check(aperta and mb < 80 and ma < 80 and scritte >= 10,
          f'modalità scura: lo sfondo diventa scuro (luminosità mediana: barra in basso {mb:.0f}, in alto {ma:.0f}; '
          f'punti chiari delle scritte delle schede: {scritte}{chiusa})')
except Exception as e:
    check(False, 'modalità scura: controllo del colore non riuscito: ' + str(e))
tap('Catalogo', exact=True, required=False)
tap('Italia', required=False, scroll=8)
shot('scuro_italia')
adb('shell cmd uimode night no')
time.sleep(2)
adb(f'shell am force-stop {PKG}')

# 8. copie degli ultimi giorni
launch(4)
chiudi_fogli()
tap('Impostazioni', wait=2.5, required=False)
copie = scorri_finche('Copie degli ultimi giorni')   # nel riquadro "Copie automatiche", più in basso
shot('copie_giornaliere')
check(copie, 'la copia giornaliera sul telefono viene salvata')
back()

# 8b. barra delle schede ferma: tirando la pagina oltre l'inizio (dito verso il basso) la barra in basso non deve
# muoversi (prima l'effetto "elastico" di Android stirava tutta la pagina e la barra finiva mezza fuori dallo schermo)
back(); ensure_app()
for k in range(12):   # se l'app è ripartita da chiusa, prima finisce l'animazione di apertura
    chiudi_fogli()
    if visible('Le mie'):
        break
    if k in (3, 6):
        # una finestra dell'app aperta sopra (con la pagina sotto non raggiungibile): come una persona, Indietro
        shot('finestra_aperta_sopra')
        back(wait=2)
        ensure_app()
    time.sleep(2.5)
if tap('Le mie', exact=True, required=False):
    time.sleep(2)
    shot('le_mie')
    fermo = os.path.join(OUT, 'barra_ferma.png'); tirato = os.path.join(OUT, 'barra_tirata.png')
    subprocess.run(f'adb exec-out screencap -p > "{fermo}"', shell=True)
    sw = subprocess.Popen('adb shell input swipe 540 700 540 2000 3000', shell=True)
    time.sleep(1.6)
    subprocess.run(f'adb exec-out screencap -p > "{tirato}"', shell=True)
    sw.wait(timeout=30)
    try:
        from PIL import Image, ImageChops, ImageStat
        a1, a2 = Image.open(fermo).convert('L'), Image.open(tirato).convert('L')
        h = a1.height; box = (0, int(h * 0.90), a1.width, int(h * 0.985))
        diff = ImageStat.Stat(ImageChops.difference(a1.crop(box), a2.crop(box))).mean[0]
        check(diff < 6, f'tirando la pagina la barra delle schede resta ferma (differenza {diff:.1f})')
    except Exception as e:
        note('controllo della barra non riuscito: ' + str(e))
else:
    check(False, 'c\'è la scheda "Le mie"')

# 9. backup automatico di Android: disinstalla, reinstalla, la collezione deve tornare
# (l'app deve essere aperta almeno una volta e non "fermata a forza", come sul telefono vero)
launch(6)
adb('shell input keyevent 3')
time.sleep(3)
BK = adb(f'shell bmgr backupnow {PKG}', timeout=300)
note('backup Android: ' + BK.replace('\n', ' | ')[-400:])
check(f'{PKG} with result: Success' in BK, 'Android accetta il backup dell\'app')
note('disinstallazione: ' + adb(f'uninstall {PKG}'))
note('reinstallazione: ' + adb(f'install {APK}', timeout=400))
launch(15)
shot('dopo_reinstallazione')
# il telefono ripristinato è un dispositivo nuovo (l'accesso non si ripristina): con la collezione tornata compare
# una volta la proposta di accedere con Google. Una persona tocca "Non ora" e va avanti: la prova fa lo stesso
chiudi_fogli()
tap('Mancanti', exact=True, required=False)
MISS_AFTER = number_before('mancanti')
shot('mancanti_dopo_reinstallazione')
note(f'mancanti dopo la reinstallazione: {MISS_AFTER} (prima: {MISS_BEFORE})')
check(MISS_BEFORE is not None and MISS0 is not None and MISS_BEFORE < MISS0 and MISS_AFTER == MISS_BEFORE, 'dopo disinstallazione e reinstallazione la collezione torna dal backup di Android')

# 10. errori nel registro
log = adb('logcat -d', timeout=120)
open(os.path.join(OUT, 'logcat.txt'), 'w').write('\n'.join(l for l in log.splitlines() if re.search(r'Capacitor|chromium|AndroidRuntime|FATAL|' + PKG, l)))
# (il crash di "UiAutomation" è lo strumento che legge lo schermo, non l'app)
errs = [l for l in log.splitlines() if ('Capacitor/Console' in l and re.search(r' E |rror', l)) or ('FATAL EXCEPTION' in l and 'UiAutomation' not in l)]
note(f'errori nel registro: {len(errs)}')
for e in errs[:40]:
    note('  ' + e)

note('\nRISULTATO: ' + ('TUTTO OK' if not FAIL else 'PROBLEMI: ' + '; '.join(FAIL)))
LOG.close()

# se qualcosa non va, il workflow si ferma qui e l'APK non viene pubblicato
sys.exit(1 if FAIL else 0)
