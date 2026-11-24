"""Prove della modalità "telefono vero" dell'esploratore, con un adb finto che fa da telefono (lo stato sta in un file
JSON): impostazioni come quelle del telefono di Valerio (densità 272, tema scuro programmato), account, notifiche.
Controlla che il giro, anche interrotto a metà, rimetta tutto com'era; che niente di distruttivo parta senza la sua
opzione; che --prova non tocchi niente; che il testo scritto arrivi al telefono così com'è.
Uso: python3 prove/prova-telefono-vero.py   (Linux: l'adb finto è uno script Python nel PATH)"""
import copy, importlib.util, json, os, subprocess, sys, tempfile

QUI = os.path.dirname(os.path.abspath(__file__))
ESPLORATORE = os.path.join(QUI, 'esploratore.py')
CARTELLA = tempfile.mkdtemp(prefix='prova-telefono-vero-')
STATO = os.path.join(CARTELLA, 'telefono.json')
fallite = []


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        fallite.append(m)


ADB_FINTO = r'''#!/usr/bin/env python3
import json, os, shlex, subprocess, sys
P = os.environ['TELEFONO_FINTO']
s = json.load(open(P))
a = sys.argv[1:]
s['chiamate'].append(a)
out = ''
def salva():
    json.dump(s, open(P, 'w'))
if a[:1] == ['exec-out']:
    c = ' '.join(a[1:])
    if c.startswith('screencap -p'):
        sys.stdout.buffer.write(bytes.fromhex('89504e470d0a1a0a')); salva(); sys.exit(0)
    out = '0123456789abcdef0123456789abcdef  -' if 'md5sum' in c else ''
    if c.startswith('uiautomator'):
        out = "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\"></hierarchy>"
elif a[:1] == ['shell']:
    riga = ' '.join(a[1:])          # come adb: gli argomenti uniti con spazi, poi la shell del telefono
    if riga.startswith('input '):
        # la shell vera del telefono (qui sh), per vedere come arriva il testo a input
        r = subprocess.run(['sh', '-c', 'input() { printf "%s\\n" "$@" >> "$INPUT_LOG"; }; ' + riga],
                           env={**os.environ, 'INPUT_LOG': P + '.input'}, capture_output=True, text=True)
        out = r.stdout + r.stderr
    else:
        p = shlex.split(riga)
        st, g = s['impostazioni'], s
        if p[:1] == ['getprop']:
            out = g['prop'].get(p[1], '')
        elif p[:2] == ['wm', 'size'] or p[:2] == ['wm', 'density']:
            cosa = p[1]
            if len(p) == 2:
                out = f"Physical {cosa}: {g['wm'][cosa]}" + (f"\nOverride {cosa}: {g['wm']['o_' + cosa]}" if g['wm'].get('o_' + cosa) else '')
            else:
                g['wm']['o_' + cosa] = None if p[2] == 'reset' else p[2]
        elif p[:3] == ['cmd', 'uimode', 'night']:
            if len(p) == 3:
                out = f"Night mode: {g['notte']}"
            elif p[3] in ('yes', 'no', 'auto', 'custom_schedule', 'custom_bedtime'):
                g['notte'] = p[3]
                if p[3] in ('yes', 'no'):      # come può fare Android: gli orari programmati si perdono
                    st['secure'].pop('dark_theme_custom_start_time', None)
                    st['secure'].pop('dark_theme_custom_end_time', None)
            else:
                out = 'Error: unknown mode'
        elif p[:1] == ['settings']:
            if p[1] == 'get':
                out = st.get(p[2], {}).get(p[3], 'null')
            elif p[1] == 'put':
                st.setdefault(p[2], {})[p[3]] = p[4]
            elif p[1] == 'delete':
                st.get(p[2], {}).pop(p[3], None)
        elif p[:3] == ['cmd', 'notification', 'set_dnd']:
            st['global']['zen_mode'] = {'off': '0', 'all': '0', 'priority': '1', 'none': '2', 'on': '2', 'alarms': '3'}[p[3]]
        elif p[:3] == ['cmd', 'connectivity', 'airplane-mode']:
            st['global']['airplane_mode_on'] = '1' if p[3] == 'enable' else '0'
        elif p[:2] == ['svc', 'wifi']:
            st['global']['wifi_on'] = '1' if p[2] == 'enable' else '0'
        elif p[:3] == ['svc', 'power', 'stayon']:
            st['global']['stay_on_while_plugged_in'] = {'usb': '2', 'true': '7', 'false': '0'}[p[3]]
        elif p[:1] == ['monkey']:
            # come uno scorrimento dal bordo che apre le impostazioni rapide: modalità aereo accesa, Wi-Fi spento
            st['global']['airplane_mode_on'] = '1'
            st['global']['wifi_on'] = '0'
            out = 'Events injected: 3000'
        elif p[:2] == ['am', 'start']:
            out = 'Status: ok\nTotalTime: 420'
        elif p[:1] == ['pidof']:
            out = '4242'
        elif p[:2] == ['cat', '/proc/loadavg']:
            out = '0.10 0.20 0.30 1/200 999'
        elif p[:3] == ['dumpsys', 'activity', 'activities']:
            out = 'topResumedActivity=ActivityRecord{1 u0 it.collezione.euro/.MainActivity t1}'
print(out)
salva()
'''

VALERIO = {   # come il telefono di Valerio (messaggio di Claude 1 delle 10:03): non sono le impostazioni di fabbrica
    'prop': {'ro.kernel.qemu': '', 'ro.boot.qemu': '', 'ro.hardware': 'mt6768'},
    'wm': {'size': '720x1612', 'o_size': None, 'density': '320', 'o_density': '272'},
    'notte': 'custom_bedtime',
    'impostazioni': {
        'system': {'font_scale': '1.0', 'accelerometer_rotation': '0', 'user_rotation': '0', 'screen_off_timeout': '30000',
                   'show_touches': '0', 'pointer_location': '0'},
        'global': {'window_animation_scale': '1.0', 'transition_animation_scale': '1.0', 'animator_duration_scale': '1.0',
                   'stay_on_while_plugged_in': '0', 'zen_mode': '0', 'airplane_mode_on': '0', 'wifi_on': '1'},
        'secure': {'ui_night_mode_custom_type': '1', 'dark_theme_custom_start_time': '79200000',
                   'dark_theme_custom_end_time': '25200000'},
    },
    'chiamate': [],
}
EMULATORE = copy.deepcopy(VALERIO)
EMULATORE['prop'] = {'ro.kernel.qemu': '1', 'ro.boot.qemu': '1', 'ro.hardware': 'ranchu'}

os.makedirs(os.path.join(CARTELLA, 'bin'))
with open(os.path.join(CARTELLA, 'bin', 'adb'), 'w') as f:
    f.write(ADB_FINTO)
os.chmod(os.path.join(CARTELLA, 'bin', 'adb'), 0o755)
os.environ['PATH'] = os.path.join(CARTELLA, 'bin') + os.pathsep + os.environ['PATH']
os.environ['TELEFONO_FINTO'] = STATO


def telefono(base):
    json.dump(copy.deepcopy(base), open(STATO, 'w'))
    if os.path.exists(STATO + '.input'):
        os.remove(STATO + '.input')


def stato():
    return json.load(open(STATO))


def senza_chiamate(s):
    s = copy.deepcopy(s)
    s.pop('chiamate')
    return s


def comandi(s):
    """Le righe dei comandi mandati al telefono, come le vedrebbe la shell del telefono."""
    return [' '.join(c[1:]) for c in s['chiamate'] if c[:1] == ['shell']]


MODIFICANO = ('settings put', 'settings delete', 'wm size 7', 'wm size 1', 'wm size r', 'wm density 3', 'wm density r',
              'cmd uimode night y', 'cmd uimode night n', 'set_dnd', 'svc ', 'pm clear', 'monkey', 'airplane-mode')


def esploratore(*opzioni):
    return subprocess.run([sys.executable, '-I', ESPLORATORE, 'it.collezione.euro', os.path.join(CARTELLA, 'out'), '1',
                           *opzioni], capture_output=True, text=True, timeout=300)


def carica(*opzioni):
    """L'esploratore come modulo, con il giro vero di main() ma senza esplorare (niente schermate da vedere)."""
    sys.argv = ['esploratore.py', 'it.collezione.euro', os.path.join(CARTELLA, 'out'), '1', *opzioni]
    spec = importlib.util.spec_from_file_location('esploratore_prova', ESPLORATORE)
    E = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(E)
    E.time.sleep = lambda s: None
    return E


# 1. --prova sul telefono vero: legge e scrive il piano, non cambia niente
telefono(VALERIO)
r = esploratore('--prova')
s = stato()
ok(r.returncode == 0 and 'telefono vero' in r.stdout and 'Con --prova non è stato cambiato niente' in r.stdout,
   f'--prova: riconosce il telefono vero e scrive il piano (uscita {r.returncode})')
ok('wm_density: 272' in r.stdout and 'notte: custom_bedtime' in r.stdout, '--prova: legge densità 272 e tema scuro programmato')
ok(senza_chiamate(s) == senza_chiamate(VALERIO), '--prova: il telefono resta com\'era')
ok(not [c for c in comandi(s) if c.startswith(MODIFICANO)], '--prova: nessun comando che cambia qualcosa')

# 2. telefono vero senza scegliere l'account: si ferma prima di toccare qualsiasi cosa
telefono(VALERIO)
r = esploratore()
s = stato()
ok(r.returncode == 2 and '--senza-account' in r.stderr, f'senza --senza-account/--anche-con-account si ferma (uscita {r.returncode})')
ok(not [c for c in comandi(s) if c.startswith(MODIFICANO)] and senza_chiamate(s) == senza_chiamate(VALERIO),
   'senza la scelta sull\'account: nessun comando che cambia qualcosa, telefono com\'era')

# 3. giro completo (tutti i giri di configurazione, pulizia e stress test) con --senza-account: alla fine tutto com'era
telefono(VALERIO)
E = carica('--senza-account')
visto = {}


def giro_finto():
    for nome, _, prepara, rimetti in E.GIRI:
        E.giro_configurazione(nome, prepara, rimetti)
        visto[nome] = True
    visto['durante'] = senza_chiamate(stato())
    E.avvia_da_capo(pulito=True)
    E.stress()


E.giro = giro_finto
try:
    E.main()
    codice = 0
except SystemExit as e:
    codice = e.code
s = stato()
ok(len(visto) == 6 and codice == 0, f'giro completo: 5 giri di configurazione fatti (uscita {codice})')
ok(visto['durante']['impostazioni']['global']['zen_mode'] == '1' and
   visto['durante']['impostazioni']['global']['stay_on_while_plugged_in'] == '2',
   'durante il giro: "non disturbare" e schermo sempre acceso')
ok(senza_chiamate(s) == senza_chiamate(VALERIO), 'dopo il giro: densità 272, tema programmato con i suoi orari, '
   'non disturbare, schermo, rotazione e carattere come prima')
ok(not any(c.startswith('pm clear') for c in comandi(s)), 'senza --cancella-dati niente pm clear')
ok(not any(c.startswith('monkey') for c in comandi(s)), 'senza --monkey niente stress test')
ok(not any('wm density reset' in c or 'cmd uimode night no' in c for c in comandi(s)),
   'niente impostazioni di fabbrica: si rimettono quelle lette')

# 4. con --monkey: lo stress test apre le impostazioni rapide (aereo acceso, Wi-Fi spento) e si rimettono
telefono(VALERIO)
E = carica('--senza-account', '--monkey')
E.giro = lambda: E.stress()
try:
    E.main()
except SystemExit:
    pass
s = stato()
ok(any(c.startswith('monkey') and '--pct-anyevent 0' in c and '--pct-syskeys 0' in c for c in comandi(s)),
   'con --monkey: monkey senza tasti di sistema, cambi di app ed eventi a caso')
ok(s['impostazioni']['global']['airplane_mode_on'] == '0' and s['impostazioni']['global']['wifi_on'] == '1',
   'dopo monkey: modalità aereo e Wi-Fi rimessi com\'erano')

# 5. giro interrotto a metà (eccezione e Ctrl+C) dentro un giro di configurazione: tutto torna com'era
for interruzione in (RuntimeError('rotto'), KeyboardInterrupt()):
    telefono(VALERIO)
    E = carica('--senza-account')

    def giro_rotto():
        def prepara():
            E.adb('shell wm size 1600x2560')
            E.adb('shell wm density 320')
            E.adb('shell cmd uimode night yes')
            raise interruzione
        E.giro_configurazione('tablet', prepara, lambda: None)

    E.giro = giro_rotto
    try:
        E.main()
    except (RuntimeError, KeyboardInterrupt, SystemExit):
        pass
    ok(senza_chiamate(stato()) == senza_chiamate(VALERIO), f'interrotto a metà ({type(interruzione).__name__}): tutto com\'era')

# 6. una lettura non riuscita non si tocca mai: niente "settings delete" su un'impostazione vera
telefono(VALERIO)
E = carica('--senza-account')
E.IMP.leggi()
E.IMP.prima['system/screen_off_timeout'] = ('sconosciuto', 'error: device offline')
E.adb('shell settings put system screen_off_timeout 600000')
E.IMP.rimetti_tutto()
s = stato()
ok(s['impostazioni']['system']['screen_off_timeout'] == '600000' and
   not any('delete system screen_off_timeout' in c for c in comandi(s)), 'lettura non riuscita: l\'impostazione non si tocca')

# 7. se il telefono non accetta il ripristino, lo dice con il comando da dare a mano, ed esce con 1
telefono(VALERIO)
E = carica('--senza-account')
E.giro = lambda: E.adb('shell cmd uimode night yes')
vero = E.Impostazioni._comando


def comando_rotto(self, nome):
    c = vero(self, nome)
    return ['cmd', 'uimode', 'night', 'qualcosa_di_strano'] if nome == 'notte' else c


E.Impostazioni._comando = comando_rotto
try:
    E.main()
    codice = 0
except SystemExit as e:
    codice = e.code
diario = open(os.path.join(CARTELLA, 'out', 'diario.txt'), encoding='utf-8').read()
ok(codice == 1 and 'a mano, adb shell cmd uimode night qualcosa_di_strano' in diario,
   f'ripristino non riuscito: avviso con il comando a mano, uscita 1 ({codice})')

# 8. il testo scritto arriva al telefono così com'è (prima la shell del telefono interpretava <, >, & e virgolette)
telefono(VALERIO)
E = carica('--senza-account')
testo = '<b>prova</b> & "x"'
E.scrivi(testo)
arrivato = open(STATO + '.input', encoding='utf-8').read().splitlines()
ok(arrivato[:2] == ['text', testo.replace(' ', '%s')], f'scrivi(): input riceve il testo intero ({arrivato[:2]})')
telefono(VALERIO)
E.adb('shell input text ' + E.shlex.quote(testo.replace(' ', '%s')))   # com'era prima
prima = open(STATO + '.input', encoding='utf-8').read().splitlines() if os.path.exists(STATO + '.input') else []
ok(prima[:2] != ['text', testo.replace(' ', '%s')], f'(com\'era prima il testo non arrivava intero: {prima[:2]})')

# 9. sul telefono vero senza account non si tocca "Accedi con Google"; con l'emulatore sì
telefono(VALERIO)
E = carica('--senza-account')
ok(E.EVITA_ACCESSO and E.ACCESSO.search('Accedi con Google') and not E.ACCESSO.search('Le mie'),
   'telefono vero senza account: "Accedi con Google" escluso, il resto no')
telefono(EMULATORE)
E = carica()
ok(not E.TELEFONO_VERO and not E.EVITA_ACCESSO, 'emulatore: riconosciuto, si tocca tutto come prima')

# 10. sull'emulatore resta tutto come prima: pm clear e stress test senza opzioni, niente "non disturbare"
telefono(EMULATORE)
E = carica()


def giro_emulatore():
    E.avvia_da_capo(pulito=True)
    E.stress()


E.giro = giro_emulatore
try:
    E.main()
except SystemExit:
    pass
s = stato()
ok(any(c.startswith('pm clear') for c in comandi(s)) and any(c.startswith('monkey') and 'pct-anyevent' not in c for c in comandi(s)),
   'emulatore: pm clear e monkey come prima')
ok(not any('set_dnd' in c or 'stayon' in c for c in comandi(s)), 'emulatore: niente "non disturbare" né schermo acceso')

# 11. sul PC nessuna shell: niente shell=True, niente > o | fuori da "adb shell"/"exec-out"
sorgente = open(ESPLORATORE, encoding='utf-8').read()
ok('shell=True' not in sorgente, 'nessun shell=True: i comandi sono liste di argomenti (uguale su Windows)')

print('RISULTATO:', 'TUTTO OK' if not fallite else f'{len(fallite)} PROVE FALLITE')
sys.exit(1 if fallite else 0)
