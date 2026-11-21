#!/usr/bin/env python3
"""Esploratore: prova l'app come una persona che la vede per la prima volta.

Non conosce i nomi delle schermate né una sequenza di tocchi scritta prima. Guarda quello che c'è sullo
schermo (l'albero di accessibilità di Android più l'immagine dello schermo), scorre le pagine fino in fondo
per vedere tutto, tocca ogni cosa toccabile, scrive nei campi, torna indietro e continua finché ha visto
tutto o finisce il tempo. Su ogni schermata controlla:

  funzionamento  crash, "l'app non risponde", errori JavaScript, risposte lente, tasto Indietro che non fa
                 niente, schermata che dopo una modifica non si aggiorna finché non la riapri
  grafica        testo che esce dallo schermo, elementi toccabili sovrapposti, contenuto coperto dalle barre
                 fisse, barre fisse che si spostano scorrendo, contrasto del testo (soglie WCAG)
  accessibilità  pulsanti senza nome (TalkBack non saprebbe cosa dire), pulsanti più piccoli di 48 dp
                 (linee guida Android/Material)
  dati           quello che si è fatto resta dopo aver chiuso e riaperto l'app; quello che si scrive viene
                 mostrato così com'è (niente codice interpretato)

Poi rifà il giro delle schermate trovate con tema scuro, schermo piccolo, tablet, carattere grande e
telefono ruotato, e chiude con lo stress test di Android (monkey: migliaia di tocchi a caso).

Va bene per qualsiasi versione dell'app: se domani c'è una schermata nuova la trova da solo.

Uso:  esploratore.py PACCHETTO CARTELLA_RISULTATI [minuti_di_esplorazione]
Esce con 1 se trova errori (gli avvisi non bloccano, ma finiscono nel resoconto).
"""
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass, field

PKG = sys.argv[1] if len(sys.argv) > 1 else 'it.collezione.euro'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'esplorazione'
MINUTI = float(sys.argv[3]) if len(sys.argv) > 3 else 30
os.makedirs(OUT, exist_ok=True)
INIZIO = time.time()
LOG = open(os.path.join(OUT, 'diario.txt'), 'w', encoding='utf-8')

# app di sistema in cui l'app può legittimamente portarti (condividi, scegli file, accesso Google, permessi)
SISTEMA = re.compile(r'documentsui|intentresolver|^android$|permissioncontroller|com\.google\.android\.gms|'
                     r'packageinstaller|chooser|com\.android\.systemui|launcher|nexuslauncher', re.I)
TESTI_DA_SCRIVERE = ['euro', '2002', 'Ita', '<b>prova</b> & "x"', 'x' * 120]


def log(msg):
    t = time.time() - INIZIO
    riga = f'[{int(t // 60):02d}:{int(t % 60):02d}] {msg}'
    print(riga, flush=True)
    LOG.write(riga + '\n')
    LOG.flush()


# ───────────────────────────── problemi trovati ─────────────────────────────

PROBLEMI = []           # dict(gravita, tipo, dove, cosa, schermata)
_visti = set()


def problema(gravita, tipo, dove, cosa, foto=None):
    chiave = (tipo, dove, re.sub(r'\d+', '#', cosa))
    if chiave in _visti:
        return
    _visti.add(chiave)
    PROBLEMI.append({'gravita': gravita, 'tipo': tipo, 'dove': dove, 'cosa': cosa, 'schermata': foto})
    log(f'  {"!! ERRORE" if gravita == "errore" else "?  avviso"} [{tipo}] {dove}: {cosa}')


# ───────────────────────────── dispositivo ─────────────────────────────

def sh(cmd, timeout=120):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return ((r.stdout or '') + (r.stderr or '')).strip()
    except subprocess.TimeoutExpired:
        return 'TIMEOUT'


def adb(c, timeout=120):
    return sh('adb ' + c, timeout)


def schermo():
    m = re.findall(r'(\d+)x(\d+)', adb('shell wm size'))
    w, h = map(int, m[-1]) if m else (1080, 2400)
    d = re.findall(r'(\d+)', adb('shell wm density'))
    return w, h, (int(d[-1]) if d else 420)


W, H, DPI = schermo()


def dp(px):
    return px * 160 / DPI


def in_primo_piano():
    # l'attività in primo piano dice di chi è lo schermo (anche le finestre dei permessi, di condivisione e di
    # scelta dei file sono attività, di altri pacchetti)
    out = adb('shell dumpsys activity activities')
    m = re.search(r'(?:topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*?\s([A-Za-z0-9_.]+)/', out)
    return m.group(1) if m else ''


def pid():
    return adb(f'shell pidof {PKG}').strip()


def impronta_schermo():
    # solo l'impronta dell'immagine (calcolata sul telefono): serve a capire quando lo schermo ha smesso di muoversi
    return adb('exec-out "screencap | md5sum"', timeout=30)[:32]


def aspetta_fermo(massimo=5.0):
    t0 = time.time()
    prima = impronta_schermo()
    while time.time() - t0 < massimo:
        time.sleep(0.35)
        ora = impronta_schermo()
        if ora == prima:
            return time.time() - t0
        prima = ora
    return massimo


N_FOTO = [0]


def foto(nome):
    N_FOTO[0] += 1
    fn = f'{N_FOTO[0]:03d}_{re.sub(r"[^a-zA-Z0-9]+", "_", nome)[:50]}.png'
    subprocess.run(f'adb exec-out screencap -p > "{OUT}/{fn}"', shell=True)
    return fn


def immagine(fn):
    try:
        from PIL import Image
        return Image.open(os.path.join(OUT, fn)).convert('RGB')
    except Exception:
        return None


# ───────────────────────────── cosa c'è sullo schermo ─────────────────────────────

@dataclass
class Nodo:
    i: int
    cls: str
    testo: str
    desc: str
    rid: str
    pkg: str
    b: tuple
    clic: bool
    lungo: bool
    spunta: bool
    spuntato: bool
    scorre: bool
    abilitato: bool
    padre: int
    figli: list = field(default_factory=list)
    prof: int = 0

    @property
    def w(self):
        return self.b[2] - self.b[0]

    @property
    def h(self):
        return self.b[3] - self.b[1]

    @property
    def centro(self):
        return ((self.b[0] + self.b[2]) // 2, (self.b[1] + self.b[3]) // 2)

    @property
    def visibile(self):
        x1, y1, x2, y2 = self.b
        return x2 > x1 + 2 and y2 > y1 + 2 and x2 > 0 and y2 > 0 and x1 < W and y1 < H

    @property
    def campo(self):
        return 'EditText' in self.cls


def leggi_schermo():
    for _ in range(4):
        out = adb('exec-out uiautomator dump /dev/tty', timeout=60)
        a, z = out.find('<?xml'), out.rfind('</hierarchy>')
        if a >= 0 and z > 0:
            try:
                root = ET.fromstring(out[a:z + 12])
                break
            except ET.ParseError:
                pass
        time.sleep(1)
    else:
        return []
    nodi = []

    def visita(el, padre, prof):
        b = tuple(map(int, re.findall(r'-?\d+', el.get('bounds', '[0,0][0,0]'))[:4]))
        n = Nodo(len(nodi), el.get('class', ''), (el.get('text') or '').strip(), (el.get('content-desc') or '').strip(),
                 el.get('resource-id', ''), el.get('package', ''), b, el.get('clickable') == 'true',
                 el.get('long-clickable') == 'true', el.get('checkable') == 'true', el.get('checked') == 'true',
                 el.get('scrollable') == 'true', el.get('enabled') != 'false', padre, prof=prof)
        nodi.append(n)
        if padre >= 0:
            nodi[padre].figli.append(n.i)
        for c in el:
            if c.tag == 'node':
                visita(c, n.i, prof + 1)

    for c in root:
        if c.tag == 'node':
            visita(c, -1, 0)
    return nodi


def etichetta(nodi, n, limite=60):
    """Il nome con cui una persona riconosce un elemento: il suo testo, o quello che c'è dentro."""
    parti = []

    def raccogli(k):
        x = nodi[k]
        t = x.testo or x.desc
        if t:
            parti.append(t)
        for f in x.figli:
            if sum(len(p) for p in parti) > limite:
                return
            raccogli(f)

    raccogli(n.i)
    return ' '.join(parti)[:limite].strip()


def maschera(t):
    t = re.sub(r'\d[\d.,]*', '#', t)
    return t if len(t) <= 32 else t[:32] + '…'


def antenati(nodi, n):
    k = n.padre
    while k >= 0:
        yield nodi[k]
        k = nodi[k].padre


@dataclass
class Azione:
    tipo: str            # tocca | lungo | scrivi | spunta
    etichetta: str
    forma: tuple         # classe e misure: serve a ritrovare l'elemento se l'etichetta è vuota
    centro: tuple
    lista: bool = False
    testo: str = ''

    @property
    def chiave(self):
        return (self.tipo, maschera(self.etichetta) if not self.lista else '·elemento di lista·', self.forma if not self.etichetta else '', self.testo[:12])

    def __str__(self):
        cosa = {'tocca': 'tocco', 'lungo': 'tocco lungo su', 'scrivi': 'scrivo in', 'spunta': 'spunto'}[self.tipo]
        e = self.etichetta or f'[{self.forma[0]} senza nome]'
        return f'{cosa} «{e[:40]}»' + (f' «{self.testo[:20]}»' if self.testo else '')


@dataclass
class Stato:
    nodi: list
    pkg: str
    chiave: str          # identità della schermata (che controlli ha), senza i dati che cambiano
    firma: str           # tutto quello che si vede, numeri compresi
    azioni: list
    nome: str


def finestre_di_sistema(nodi):
    """Android mostra "X non risponde": se è l'app è un errore; se è il sistema (emulatore lento) si tocca Attendi."""
    testi = ' '.join(n.testo for n in nodi)
    m = re.search(r"(.{0,40}?)\s*(isn.t responding|non risponde)", testi, re.I)
    if not m:
        return False
    chi = m.group(1).strip()
    if re.search(r'Eurodex|Collezione', chi, re.I):
        problema('errore', 'blocco', 'app', f'Android dice che l\'app non risponde', foto('non_risponde'))
        salva_tracce_anr()
    else:
        log(f'    (Android: «{chi} non risponde», è il sistema dell\'emulatore: tocco Attendi)')
    attendi = next((n for n in nodi if re.fullmatch(r'Wait|Attendi', n.testo)), None)
    if attendi:
        tocca(*attendi.centro)
    else:
        indietro()
    time.sleep(2)
    return True


def salva_tracce_anr():
    """Le tracce di Android su cosa stava facendo l'app quando si è bloccata."""
    adb('root', timeout=30)
    time.sleep(2)
    elenco = adb('shell ls -t /data/anr', timeout=30).split()
    if elenco:
        adb(f'pull /data/anr/{elenco[0]} "{OUT}/traccia_blocco.txt"', timeout=60)
        log(f'  (tracce del blocco salvate in traccia_blocco.txt)')


def osserva():
    nodi = leggi_schermo()
    for _ in range(3):
        if not finestre_di_sistema(nodi):
            break
        nodi = leggi_schermo()
    pk = in_primo_piano()
    app = [n for n in nodi if n.pkg == PKG and n.visibile]
    # elementi toccabili come li vede una persona: quelli dichiarati toccabili, più i testi e le icone
    # che non stanno dentro qualcosa di toccabile (nelle pagine web non sempre i pulsanti si dichiarano)
    cand = []
    for n in app:
        if n.cls.endswith('WebView') or n.w >= W - 4 and n.h >= H * 0.6:
            continue
        dentro_toccabile = any(a.clic or a.lungo for a in antenati(nodi, n))
        if n.clic or n.lungo or n.spunta or n.campo:
            cand.append(n)
        elif not dentro_toccabile and not n.figli and n.w > 8 and n.h > 8 and \
                ((n.testo and len(n.testo) <= 25) or n.desc or 'Image' in n.cls):
            n.non_dichiarato = True
            cand.append(n)
    # gli elementi ripetuti (righe di un elenco, caselle di una griglia) si provano a campione come farebbe
    # una persona: il primo, il secondo, uno a metà, l'ultimo
    forme = defaultdict(list)
    for n in cand:
        forme[(n.padre, n.cls, n.w // 24, n.h // 24, len(n.figli))].append(n)
    azioni, in_lista = [], set()
    for gruppo in forme.values():
        if len(gruppo) >= 4:
            scelti = {gruppo[0].i, gruppo[1].i, gruppo[len(gruppo) // 2].i, gruppo[-1].i}
            for n in gruppo:
                in_lista.add(n.i)
                if n.i not in scelti:
                    n.saltato = True
    non_dich = [n for n in cand if getattr(n, 'non_dichiarato', False) and not getattr(n, 'saltato', False)]
    for n in non_dich[12:]:
        n.saltato = True
    cand.sort(key=lambda n: getattr(n, 'non_dichiarato', False))
    for n in cand:
        if getattr(n, 'saltato', False):
            continue
        et = etichetta(nodi, n)
        forma = (n.cls.split('.')[-1], round(dp(n.w) / 8), round(dp(n.h) / 8))
        if n.campo:
            for t in TESTI_DA_SCRIVERE:
                azioni.append(Azione('scrivi', et or n.rid, forma, n.centro, testo=t))
        else:
            azioni.append(Azione('spunta' if n.spunta else 'tocca', et, forma, n.centro, lista=n.i in in_lista))
            if n.lungo:
                azioni.append(Azione('lungo', et, forma, n.centro, lista=n.i in in_lista))
    controlli = sorted({maschera(a.etichetta) or str(a.forma) for a in azioni if not a.lista})
    chiave = hashlib.md5(('|'.join(controlli) + pk).encode()).hexdigest()[:10]
    firma = hashlib.md5('|'.join(f'{n.testo}{n.desc}{n.spuntato}' for n in app).encode()).hexdigest()[:10]
    titoli = [n.testo for n in app if n.testo and 3 < len(n.testo) < 40 and not n.clic and not n.cls.endswith('WebView')]
    nome = (titoli[0] if titoli else (controlli[0] if controlli else pk))[:40]
    return Stato(nodi, pk, chiave, firma, azioni, nome)


# ───────────────────────────── gesti ─────────────────────────────

def tocca(x, y):
    adb(f'shell input tap {x} {y}')


def tocco_lungo(x, y):
    adb(f'shell input swipe {x} {y} {x} {y} 900')


def scorri(su=True, area=None):
    x1, y1, x2, y2 = area or (0, int(H * 0.15), W, int(H * 0.85))
    x = (x1 + x2) // 2
    a, b = y1 + (y2 - y1) * 3 // 4, y1 + (y2 - y1) // 4
    adb(f'shell input swipe {x} {a if su else b} {x} {b if su else a} 450')


def indietro():
    adb('shell input keyevent 4')


def scrivi(testo):
    adb('shell input text ' + shlex.quote(testo.replace(' ', '%s')))
    time.sleep(0.4)
    adb('shell input keyevent 66')   # invio, come chi conferma la ricerca


def avvia(freddo=False):
    if freddo:
        adb(f'shell am force-stop {PKG}')
        time.sleep(0.5)
    out = adb(f'shell am start -W -n {PKG}/.MainActivity')
    m = re.search(r'TotalTime:\s*(\d+)', out)
    aspetta_fermo(8)
    return int(m.group(1)) if m else None


def torna_nell_app():
    for _ in range(4):
        pk = in_primo_piano()
        if pk == PKG:
            return True
        if 'permissioncontroller' in pk:
            # finestra dei permessi: una persona di solito tocca "Consenti"
            nodi = leggi_schermo()
            ok = next((n for n in nodi if re.search(r'allow_button|Consenti|Allow', n.rid + n.testo) and n.clic), None)
            if ok:
                tocca(*ok.centro)
                log('    (finestra dei permessi di Android: tocco Consenti)')
                aspetta_fermo(3)
                continue
        indietro()
        aspetta_fermo(3)
    if in_primo_piano() != PKG:
        avvia()
    return in_primo_piano() == PKG


# ───────────────────────────── controlli su una schermata ─────────────────────────────

def contrasto(c1, c2):
    def lum(c):
        r, g, b = [v / 255 for v in c]
        r, g, b = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in (r, g, b)]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    a, b = sorted([lum(c1), lum(c2)], reverse=True)
    return (a + 0.05) / (b + 0.05)


def colori_testo(img, b):
    """Sfondo = colore più diffuso nel riquadro; testo = il colore più contrastato tra quelli ben presenti.
    Se il riquadro non è "testo su un fondo" (foto, disegni, grafici: tanti colori diversi) non si misura."""
    x1, y1, x2, y2 = max(0, b[0]), max(0, b[1]), min(img.width, b[2]), min(img.height, b[3])
    if x2 - x1 < 6 or y2 - y1 < 6:
        return None
    pezzo = img.crop((x1, y1, x2, y2)).quantize(colors=12).convert('RGB')
    conta = Counter(pezzo.getdata())
    tot = sum(conta.values())
    if sum(k for _, k in conta.most_common(3)) / tot < 0.9:
        return None   # più di un fondo e un colore di scrittura (con le sfumature dei bordi): è un'immagine
    sfondo = conta.most_common(1)[0][0]
    # le lettere sottili occupano poco del riquadro: basta una piccola quota; tra i colori presenti si prende il più
    # contrastato (i bordi sfumati delle lettere hanno colori intermedi, meno contrastati del colore vero)
    altri = [(c, k) for c, k in conta.items() if c != sfondo and k / tot >= 0.005]
    if not altri:
        return None
    testo = max(altri, key=lambda ck: contrasto(ck[0], sfondo))[0]
    return testo, sfondo


FISSE = {}   # elementi che restano fermi scorrendo (barre in alto e in basso): etichetta → riquadro


def tagliato(n, nodi):
    """Elemento tagliato dal bordo di un riquadro che scorre (es. un filtro mezzo fuori da una fila che scorre di
    lato): se ne vede solo un pezzo, quindi misura e colori non sono i suoi."""
    for a in antenati(nodi, n):
        if a.scorre and (abs(n.b[0] - a.b[0]) <= 2 or abs(n.b[2] - a.b[2]) <= 2 or abs(n.b[1] - a.b[1]) <= 2
                         or abs(n.b[3] - a.b[3]) <= 2):
            return True
    return False


def sotto_una_barra(n, nodi):
    """Elemento della pagina che scorre passato sotto una barra fissa: lì sopra c'è la barra, non lui."""
    if etichetta(nodi, n) in FISSE:
        return False
    for b in FISSE.values():
        if min(n.b[3], b[3]) - max(n.b[1], b[1]) > 4 and min(n.b[2], b[2]) - max(n.b[0], b[0]) > 4:
            return True
    return False


def barre_di_pulsanti(app):
    """Le barre di pulsanti in fondo o in cima allo schermo (come quella delle schede), riconosciute anche prima di
    averle viste restare ferme scorrendo: almeno 3 elementi toccabili affiancati, con la stessa cima e lo stesso
    fondo, nel 15% più basso o più alto dello schermo. Ogni barra: (cima, fondo, indici dei suoi pulsanti)."""
    cand = sorted((n for n in app if (n.clic or n.lungo) and (n.b[1] >= H * 0.85 or n.b[3] <= H * 0.15)),
                  key=lambda n: (n.b[1], n.b[3]))
    gruppi, g = [], []
    for n in cand:
        if g and (abs(n.b[1] - g[0].b[1]) > 4 or abs(n.b[3] - g[0].b[3]) > 4):
            gruppi.append(g)
            g = []
        g.append(n)
    gruppi.append(g)
    return [(min(x.b[1] for x in g), max(x.b[3] for x in g), {x.i for x in g}) for g in gruppi if len(g) >= 3]


def controlla_sovrapposizioni(st, dove, fn=None):
    """Due cose toccabili una sopra l'altra (escluso il contenuto che scorre sotto le barre fisse, che è normale)."""
    app = [n for n in st.nodi if n.pkg == PKG and n.visibile]
    # il contenuto che passa sotto una barra di pulsanti non conta, anche sulla prima schermata, quando la barra non
    # è ancora stata vista restare ferma scorrendo (era il falso allarme «Andorra» sotto le schede, build del 21/11)
    barre = barre_di_pulsanti(app)

    def sotto_barra_di_pulsanti(n):
        # un elemento già visto restare fermo scorrendo (FISSE) non è contenuto che scorre: se tocca la barra, conta
        if etichetta(st.nodi, n) in FISSE:
            return False
        return any(n.i not in ids and min(n.b[3], y2) - max(n.b[1], y1) > 4 for y1, y2, ids in barre)

    tocc = [n for n in app if (n.clic or n.lungo or n.spunta) and not n.cls.endswith('WebView') and n.w < W - 4
            and not sotto_una_barra(n, st.nodi) and not sotto_barra_di_pulsanti(n)]
    for a in range(len(tocc)):
        for b in range(a + 1, len(tocc)):
            p, q = tocc[a], tocc[b]
            if p.i in [x.i for x in antenati(st.nodi, q)] or q.i in [x.i for x in antenati(st.nodi, p)]:
                continue
            ix = max(0, min(p.b[2], q.b[2]) - max(p.b[0], q.b[0]))
            iy = max(0, min(p.b[3], q.b[3]) - max(p.b[1], q.b[1]))
            if ix * iy > 0.25 * min(p.w * p.h, q.w * q.h):
                problema('errore', 'grafica', dove, f'«{etichetta(st.nodi, p)[:20]}» e «{etichetta(st.nodi, q)[:20]}» si sovrappongono', fn)


def controlla(st, dove, fn=None, configurazione=''):
    """Controlli di grafica e accessibilità su quello che c'è a schermo adesso."""
    dove = f'{dove}{" · " + configurazione if configurazione else ""}'
    app = [n for n in st.nodi if n.pkg == PKG and n.visibile]
    tocc = [n for n in app if (n.clic or n.lungo or n.spunta) and not n.cls.endswith('WebView') and n.w < W - 4]
    # testo che esce dallo schermo (fuori da elenchi che scorrono di lato)
    for n in app:
        if (n.testo or n.desc) and (n.b[2] > W + 2 or n.b[0] < -2):
            if not any(a.scorre for a in antenati(st.nodi, n)):
                problema('errore', 'grafica', dove, f'«{(n.testo or n.desc)[:30]}» esce dallo schermo ({n.b[0]}→{n.b[2]} su {W})', fn)
    # pulsanti senza nome
    for n in tocc:
        if not etichetta(st.nodi, n) and not n.campo:
            problema('errore', 'accessibilità', dove, f'elemento toccabile senza nome (TalkBack dice solo "pulsante"), {n.cls.split(".")[-1]} a {n.centro}', fn)
    # misura minima dei pulsanti: 48 dp (linee guida Android e Material)
    for n in tocc:
        if tagliato(n, st.nodi) or sotto_una_barra(n, st.nodi):
            continue   # se ne vede solo un pezzo: la misura letta non è la sua
        if dp(n.w) < 47.5 or dp(n.h) < 47.5:
            if not (n.testo and len(n.testo) > 25):   # i link dentro un testo lungo fanno eccezione
                problema('avviso', 'accessibilità', dove, f'«{etichetta(st.nodi, n)[:25]}» è {dp(n.w):.0f}×{dp(n.h):.0f} dp, sotto i 48×48 consigliati', fn)
    # contrasto del testo (WCAG: 4,5:1 per il testo normale, 3:1 per quello grande)
    img = immagine(fn) if fn else None
    if img is not None:
        # pulsanti con solo il disegno (nessun testo scritto): se nella parte centrale non c'è niente da vedere,
        # il disegno manca (una persona vede un riquadro vuoto e non sa cosa fa)
        def ha_testo(k):
            m = st.nodi[k]
            return bool(m.testo) or any(ha_testo(f) for f in m.figli)

        def vuoto(im, n):
            mx, my = n.w // 5, n.h // 5
            centro = im.crop((n.b[0] + mx, n.b[1] + my, n.b[2] - mx, n.b[3] - my)).quantize(colors=6).convert('RGB')
            conta = Counter(centro.getdata())
            return bool(conta) and conta.most_common(1)[0][1] / sum(conta.values()) > 0.985

        sospetti = [n for n in tocc
                    if not ha_testo(n.i) and not n.campo and 0 <= n.b[0] and n.b[2] <= W and 0 <= n.b[1] and n.b[3] <= H
                    and dp(n.w) >= 20 and dp(n.h) >= 20 and n.w * n.h <= 0.15 * W * H and vuoto(img, n)]
        if sospetti:
            # una foto può essere ancora in arrivo dalla rete: si guarda di nuovo dopo qualche secondo
            time.sleep(3)
            fn2 = foto(f'ricontrollo_{len(PROBLEMI)}')
            img2 = immagine(fn2)
            for n in sospetti:
                if img2 is not None and vuoto(img2, n):
                    problema('errore', 'grafica', dove,
                             f'«{etichetta(st.nodi, n)[:25]}» è un pulsante vuoto: non si vede nessun disegno', fn2)
        for n in app:
            if not n.testo or n.figli or n.h > 160 or n.w < 12 or not re.search(r'\w', n.testo):
                continue
            if re.search(r'Progress|SeekBar|Image', n.cls):
                continue   # barre di avanzamento e immagini: il loro "testo" è la descrizione per TalkBack, non si vede
            if sotto_una_barra(n, st.nodi) or tagliato(n, st.nodi) or n.b[3] > H or n.b[1] < 0 or n.b[0] < 0 or n.b[2] > W:
                continue   # coperto in parte da una barra o tagliato dal bordo: il colore misurato non è il suo
            c = colori_testo(img, n.b)
            if not c:
                continue
            r = contrasto(*c)
            grande = dp(n.h) >= 24
            if r < 3.0:
                problema('errore', 'contrasto', dove, f'«{n.testo[:25]}» contrasto {r:.1f}:1 (minimo {"3" if grande else "4,5"}:1)', fn)
            elif r < 4.5 and not grande:
                problema('avviso', 'contrasto', dove, f'«{n.testo[:25]}» contrasto {r:.1f}:1 (consigliato 4,5:1)', fn)


def posizioni(st):
    return {etichetta(st.nodi, n): n.b for n in st.nodi if n.pkg == PKG and n.visibile and (n.clic or n.testo)
            and (n.b[1] > H * 0.84 or n.b[3] < H * 0.14)}


def osserva_durante_gesto(area):
    """Legge lo schermo mentre il dito sta ancora tirando la pagina oltre la fine (lì si vedono i rimbalzi)."""
    x1, y1, x2, y2 = area or (0, int(H * 0.15), W, int(H * 0.85))
    x = (x1 + x2) // 2
    p = subprocess.Popen(f'adb shell input swipe {x} {y1 + (y2 - y1) * 3 // 4} {x} {y1 + (y2 - y1) // 8} 3000', shell=True)
    time.sleep(1.4)
    nodi = leggi_schermo()
    p.wait()
    return nodi


def esplora_pagina(st, dove):
    """Scorre la pagina fino in fondo come chi vuole vedere tutto: raccoglie gli elementi che compaiono,
    controlla che le barre fisse non si spostino (nemmeno tirando oltre la fine) e che l'ultimo contenuto
    non resti coperto. Poi torna su."""
    area = None
    sc = [n for n in st.nodi if n.pkg == PKG and n.scorre and n.visibile and n.h > H * 0.3]
    if sc:
        area = max(sc, key=lambda n: n.w * n.h).b
    prima = posizioni(st)
    fisse = None
    passi, viste, firme = 0, list(st.azioni), {st.firma}
    attuale = st
    # la fine della pagina si riconosce da dove stanno le cose (non solo da cosa c'è scritto: due punti diversi
    # della stessa pagina possono mostrare gli stessi testi)
    def dove_stanno(x):
        return tuple((n.testo or n.desc, n.b[1]) for n in x.nodi if n.pkg == PKG and n.visibile and (n.testo or n.desc))
    fermo, in_fondo = 0, False
    while passi < 60:
        scorri(True, area)
        aspetta_fermo(2)
        nuovo = osserva()
        passi += 1
        ora = posizioni(nuovo)
        if fisse is None:
            if nuovo.firma == attuale.firma:
                if passi >= 3:
                    fisse = {}                   # la pagina non scorre: niente da dire sulle barre
                continue                         # (oppure non ha ancora cominciato a scorrere: si riprova)
            # quello che resta fermo mentre la pagina scorre sono le barre fisse
            fisse = {e: b for e, b in ora.items() if e in prima and abs(b[1] - prima[e][1]) <= 2}
            FISSE.update(fisse)
        else:
            for e, b in ora.items():
                if e in fisse and abs(b[1] - fisse[e][1]) > 6:
                    problema('errore', 'grafica', dove, f'«{e[:20]}» dovrebbe stare fermo ma si sposta di {abs(b[1] - fisse[e][1])} px scorrendo')
        nuove = [a for a in nuovo.azioni if a.chiave not in {v.chiave for v in viste}]
        for a in nuove:
            a.passi = passi
        viste += nuove
        if dove_stanno(nuovo) == dove_stanno(attuale):
            fermo += 1
            if fermo >= 2:
                in_fondo = True
                break                            # due scorrimenti senza che si muova niente: è la fine
            continue
        fermo = 0
        firme.add(nuovo.firma)
        attuale = nuovo
    if fisse:
        durante = posizioni(Stato(osserva_durante_gesto(area), PKG, '', '', [], ''))
        for e, b in durante.items():
            if e in fisse and abs(b[1] - fisse[e][1]) > 6:
                problema('errore', 'grafica', dove, f'«{e[:20]}» si sposta di {abs(b[1] - fisse[e][1])} px quando si tira la pagina oltre la fine')
        aspetta_fermo(2)
    # in fondo alla pagina il contenuto non deve finire sotto una barra fissa. Solo se la fine è stata davvero
    # raggiunta: una pagina più lunga di 60 scorrimenti si ferma a metà, dove il contenuto passa sotto la barra
    # come deve (era il falso allarme sulle mancanti della Germania, build del 21/11)
    if passi >= 60 and not in_fondo:
        # pagina lunghissima (come le mancanti della Germania): si arriva in fondo in fretta, con scorrimenti senza
        # osservare, e il fondo si controlla lì (consiglio di Claude 2 su #6)
        for _ in range(6):                       # al massimo 6 × 25 scorrimenti veloci
            for _ in range(25):
                scorri(True, area)
            passi += 25
            aspetta_fermo(2)
            nuovo = osserva()
            if dove_stanno(nuovo) == dove_stanno(attuale):
                in_fondo = True
                break
            attuale = nuovo
        if in_fondo:
            log(f'  (pagina lunga: in fondo con gli scorrimenti veloci, {passi} in tutto)')
        else:
            log(f'  (pagina più lunga di {passi} scorrimenti: il fondo non lo controllo)')
    if passi > 1 and fisse and in_fondo:
        cima_barre = min((b[1] for b in fisse.values() if b[1] > H * 0.5), default=None)
        if cima_barre:
            coperti = [n for n in attuale.nodi if n.pkg == PKG and n.testo and n.visibile and n.b[1] < cima_barre - 4
                       and not n.cls.endswith('WebView') and not n.figli
                       and n.b[3] > cima_barre + 4 and etichetta(attuale.nodi, n) not in fisse]
            for n in coperti[:1]:
                problema('errore', 'grafica', dove, f'in fondo alla pagina «{n.testo[:25]}» resta coperto dalla barra',
                         foto('coperto_dalla_barra'))
    for _ in range(passi + 1):
        scorri(False, area)
    aspetta_fermo(2)
    return viste


# ───────────────────────────── salute dell'app ─────────────────────────────

PID = ['']
ERRORI_JS = re.compile(r'Uncaught|TypeError|ReferenceError|SyntaxError|Unhandled', re.I)


def controlla_salute(dove, dopo):
    crash = adb('logcat -b crash -d', timeout=30)
    if PKG in crash and 'FATAL' in crash:
        problema('errore', 'crash', dove, f'l\'app si è chiusa da sola dopo: {dopo}', foto('crash'))
        open(os.path.join(OUT, 'crash.txt'), 'a').write(crash + '\n\n')
        adb('logcat -b crash -c')
    ora = pid()
    if PID[0] and ora and ora != PID[0] and 'crash' not in dove:
        problema('errore', 'crash', dove, f'l\'app è ripartita da capo dopo: {dopo}')
    PID[0] = ora or PID[0]
    righe = adb('logcat -d -s Eurodex:E chromium:I Capacitor/Console:E', timeout=30)
    for r in righe.splitlines():
        if ERRORI_JS.search(r) or ' E Eurodex' in r:
            problema('errore', 'errore JavaScript', dove, f'{r.split(": ", 1)[-1][:160]} (dopo: {dopo})')
    adb('logcat -c')
    finestre_di_sistema(leggi_schermo())


def tocca_testo(t):
    n = next((n for n in leggi_schermo() if n.testo == t), None)
    if n:
        tocca(*n.centro)
        return True
    return False


# ───────────────────────────── esplorazione ─────────────────────────────

SCHERMATE = {}          # chiave -> {nome, passi, foto, azioni, controlli, primo_avvio}
PROVATE = set()         # (chiave schermata, chiave azione)
CONTEGGI = Counter()
MODIFICHE = [0]         # quante modifiche si sono fatte finora (serve a capire se una schermata va ricontrollata)
CONTROLLI_FRESCHI = Counter()


def tempo_finito():
    return time.time() - INIZIO > MINUTI * 60


def controlli(st):
    return {maschera(a.etichetta) or str(a.forma) for a in st.azioni if not a.lista and a.tipo != 'scrivi'} | \
           {'campo:' + maschera(a.etichetta) for a in st.azioni if a.tipo == 'scrivi'}


SOGLIA = [0.8]          # quanto due schermate devono somigliarsi per essere "la stessa" (più basso nei giri con altri schermi)


def simili(x, y):
    if not x and not y:
        return 1.0
    return len(x & y) / len(x | y)


def stessa(a, b):
    """Stessa schermata (magari con qualche numero o scritta cambiata), oppure se n'è aperta un'altra."""
    if a.pkg != b.pkg:
        return False
    x, y = controlli(a), controlli(b)
    return len(x ^ y) < 3 or simili(x, y) >= SOGLIA[0]


def riconosci(st):
    x = controlli(st)
    meglio, k = 0, None
    for chiave, info in SCHERMATE.items():
        if info['pkg'] != st.pkg:
            continue
        s = simili(x, info['controlli'])
        if (len(x ^ info['controlli']) < 3 or s >= SOGLIA[0]) and s > meglio:
            meglio, k = s, chiave
    return k


def trova_azione(st, a):
    for b in st.azioni:
        if b.tipo == a.tipo and maschera(b.etichetta) == maschera(a.etichetta) and (a.etichetta or b.forma == a.forma) and b.testo == a.testo:
            return b
    return None


def in_cima(st=None):
    """Riporta la pagina all'inizio (come chi torna su prima di guardarla)."""
    st = st or osserva()
    for _ in range(15):
        scorri(False)
        aspetta_fermo(2)
        ora = osserva()
        if ora.firma == st.firma:
            return ora
        st = ora
    return st


def nascondi_tastiera():
    if 'mInputShown=true' in adb('shell dumpsys input_method'):
        indietro()
        aspetta_fermo(2)


def esegui(a, st):
    """Fa l'azione come una persona: se l'elemento è più in basso scorre finché lo trova.
    Restituisce (tempo di risposta, schermata subito prima del gesto) oppure None se l'elemento non c'è più."""
    cur, passi = st, getattr(a, 'passi', 0)
    for _ in range(passi):
        scorri(True)
    if passi:
        aspetta_fermo(2)
        cur = osserva()
    b = trova_azione(cur, a)
    extra = 0
    while not b and extra < 4:
        scorri(True)
        aspetta_fermo(2)
        cur = osserva()
        b = trova_azione(cur, a)
        extra += 1
    if not b:
        in_cima(cur)
        return None
    t0 = time.time()
    if a.tipo == 'lungo':
        tocco_lungo(*b.centro)
    elif a.tipo == 'scrivi':
        tocca(*b.centro)
        time.sleep(0.6)
        adb('shell input keyevent 123 ' + ' '.join(['67'] * 60))      # fine del testo, poi cancella quello che c'era
        scrivi(a.testo)
    else:
        tocca(*b.centro)
    a.passi = passi + extra
    return aspetta_fermo(), cur


def avvia_da_capo(pulito=False):
    if pulito:
        adb(f'shell pm clear {PKG}')
        adb(f'shell pm grant {PKG} android.permission.POST_NOTIFICATIONS')
    avvia(freddo=True)
    PID[0] = pid()
    if in_primo_piano() != PKG:
        torna_nell_app()


def rifai_percorso(passi):
    """Riapre l'app da zero e rifà i passi fino a una schermata (come chi si è perso e ricomincia)."""
    avvia_da_capo()
    da, a = [p[1] for p in passi], [p[2] for p in passi]
    i = 0
    while i < len(passi):
        st = osserva()
        k = riconosci(st)
        if k in a[i:]:
            i = a.index(k, i) + 1                # ci si trova già più avanti (es. il benvenuto non ricompare)
            continue
        if k != da[i]:
            if k in da[i:]:
                i = da.index(k, i)
            else:
                return None
        if not esegui(passi[i][0], st):
            return None
        i += 1
    return osserva()


def registra(st, passi):
    k = st.chiave
    fn = foto(st.nome)
    SCHERMATE[k] = {'nome': st.nome, 'pkg': st.pkg, 'passi': list(passi), 'foto': fn, 'controlli': controlli(st),
                    'primo_avvio': CONTEGGI['azioni'] < 3 and not passi}
    log(f'▸ schermata nuova: «{st.nome}» ({len(st.azioni)} cose da provare a prima vista)')
    SCHERMATE[k]['azioni'] = esplora_pagina(st, st.nome)
    controlla(st, st.nome, fn)
    controlla_sovrapposizioni(st, st.nome, fn)
    SCHERMATE[k]['controlli'] |= {maschera(a.etichetta) for a in SCHERMATE[k]['azioni'] if not a.lista and getattr(a, 'passi', 0) == 0 and a.tipo != 'scrivi'}
    return k


def da_provare(k):
    return [a for a in SCHERMATE[k]['azioni'] if (k, a.chiave) not in PROVATE]


def controlla_freschezza(k, st, passi):
    """La schermata a cui si torna deve già mostrare le modifiche fatte più avanti, senza doverla riaprire."""
    if CONTROLLI_FRESCHI[k] >= 2:
        return st
    CONTROLLI_FRESCHI[k] += 1
    visto = in_cima(st)
    fresco = rifai_percorso(passi)
    if fresco is None:
        return None
    fresco = in_cima(fresco)
    if riconosci(fresco) == k and fresco.firma != visto.firma:
        vecchi = [n.testo for n in visto.nodi if n.pkg == PKG and n.testo]
        nuovi = [n.testo for n in fresco.nodi if n.pkg == PKG and n.testo]
        diversi = [t for t in nuovi if t not in vecchi][:3]
        problema('errore', 'aggiornamento', SCHERMATE[k]['nome'],
                 f'tornando qui dopo una modifica la schermata è vecchia; riaprendola mostra {diversi}', foto('non_aggiornata'))
    return fresco


def esplora():
    passi = []          # (azione, chiave da cui parte, chiave a cui arriva, modifiche fatte prima di entrare)
    st = osserva()
    while not tempo_finito():
        k = riconosci(st)
        if k is None:
            if st.pkg != PKG:
                log(f'  (in primo piano c\'è «{st.pkg or "niente"}», non l\'app: ci torno)')
                torna_nell_app()
                st = osserva()
                continue
            st = in_cima(st)
            k = riconosci(st) or registra(st, [(p[0], p[1], p[2]) for p in passi])
            st = osserva()
        lista = da_provare(k)
        if not lista:
            st, passi = vai_altrove(st, k, passi)
            if st is None:
                return
            continue
        a = lista[0]
        GIRI_A_VUOTO[0] = 0
        PROVATE.add((k, a.chiave))
        r = esegui(a, st)
        CONTEGGI['azioni'] += 1
        if r is None:
            st = osserva()
            continue
        durata, prima = r
        controlla_salute(SCHERMATE[k]['nome'], str(a))
        if durata > 3 and a.tipo != 'scrivi':
            problema('avviso', 'lentezza', SCHERMATE[k]['nome'], f'{a}: lo schermo si ferma dopo {durata:.1f} s')
        pk = in_primo_piano()
        if pk != PKG:
            if pk and not SISTEMA.search(pk):
                problema('avviso', 'uscita', SCHERMATE[k]['nome'], f'{a} porta fuori dall\'app ({pk})')
            log(f'  {a} → apre {pk or "un altra app"}: torno indietro')
            CONTEGGI['uscite'] += 1
            torna_nell_app()
            st = osserva()
            continue
        nuovo = osserva()
        if a.tipo == 'scrivi':
            riflesso = [n for n in nuovo.nodi if n.pkg == PKG and 'prova' in n.testo and '<b>' not in n.testo and not n.campo]
            if '<b>' in a.testo and riflesso:
                problema('errore', 'sicurezza', SCHERMATE[k]['nome'], 'il testo scritto viene interpretato come codice invece di essere mostrato così com\'è')
            nascondi_tastiera()
            nuovo = osserva()
        if stessa(nuovo, prima):
            if nuovo.firma != prima.firma:
                MODIFICHE[0] += 1
                CONTEGGI['modifiche'] += 1
                log(f'  {a} → cambia qualcosa qui')
                if a.tipo == 'spunta' and a.forma[0] != 'RadioButton':
                    # un interruttore toccato due volte deve tornare esattamente com'era (non le scelte tra più
                    # opzioni: toccare di nuovo quella già scelta la lascia scelta, come in tutte le app)
                    esegui(a, nuovo)
                    di_nuovo = osserva()
                    if di_nuovo.firma != prima.firma:
                        # un messaggio passeggero ("Annulla", "Mostro tutte le monete"…) sparisce da solo: si aspetta
                        # che se ne vada, come farebbe una persona, prima di confrontare
                        time.sleep(5)
                        di_nuovo = osserva()
                    if di_nuovo.firma != prima.firma:
                        diverse = sorted({n.testo or n.desc for n in di_nuovo.nodi if n.pkg == PKG and (n.testo or n.desc)}
                                         ^ {n.testo or n.desc for n in prima.nodi if n.pkg == PKG and (n.testo or n.desc)})
                        problema('errore', 'funzionamento', SCHERMATE[k]['nome'],
                                 f'{a} due volte non torna com\'era prima (cambia: {", ".join(x[:25] for x in diverse[:4])})',
                                 foto('non_torna'))
                    nuovo = di_nuovo
            else:
                CONTEGGI['senza_effetto'] += 1
            st = in_cima(nuovo) if getattr(a, 'passi', 0) else nuovo
            continue
        # si è aperta un'altra schermata (o una finestra sopra questa)
        aperta = riconosci(nuovo)
        log(f'  {a} → «{SCHERMATE[aperta]["nome"] if aperta else nuovo.nome}»')
        # (che una finestra aperta isoli la pagina sotto per TalkBack non si capisce con certezza da qui: lo controllano
        # le prove nel browser, che leggono direttamente lo stato della pagina)
        passi.append((a, k, aperta or nuovo.chiave, MODIFICHE[0]))
        st = nuovo


GIRI_A_VUOTO = [0]


def vai_altrove(st, k, passi):
    """Qui non c'è più niente di nuovo: si torna indietro come una persona; se si esce dall'app, la si riapre
    e si va in una parte non ancora vista."""
    GIRI_A_VUOTO[0] += 1
    if GIRI_A_VUOTO[0] > 6:
        adb(f'shell am force-stop {PKG}')        # si gira a vuoto tra schermate già viste: si ricomincia altrove
    indietro()
    aspetta_fermo(3)
    if in_primo_piano() == PKG:
        ora = osserva()
        if stessa(ora, st) and ora.firma == st.firma:
            if passi:
                problema('avviso', 'funzionamento', SCHERMATE[k]['nome'], 'il tasto Indietro non fa niente')
        else:
            dove = riconosci(ora) or riconosci(in_cima(ora))
            if passi and dove == passi[-1][1]:
                entrato = passi.pop()
                if MODIFICHE[0] > entrato[3]:
                    ora = controlla_freschezza(dove, ora, [(p[0], p[1], p[2]) for p in passi])
                    if ora is None:
                        ora = osserva()
                return ora, passi
            if dove is not None and any(p[1] == dove for p in passi):
                while passi and passi[-1][1] != dove:
                    passi.pop()
                passi.pop()
                return ora, passi
            if dove is not None:
                return ora, [(p[0], p[1], p[2], MODIFICHE[0]) for p in SCHERMATE[dove]['passi']]
            return ora, passi
    # uscito dall'app (o Indietro non serve): si sceglie una schermata con cose ancora da provare
    for chiave, info in SCHERMATE.items():
        if not da_provare(chiave) or info.get('irraggiungibile'):
            continue
        if info['primo_avvio']:
            avvia_da_capo(pulito=True)          # le finestre del primo avvio ricompaiono solo con l'app appena installata
            ora = osserva()
            if riconosci(ora) == chiave:
                return ora, []
        ora = rifai_percorso(info['passi'])
        if ora is not None and riconosci(ora) == chiave:
            return ora, [(p[0], p[1], p[2], MODIFICHE[0]) for p in info['passi']]
        info['irraggiungibile'] = True
        log(f'  (non riesco più ad arrivare a «{info["nome"]}»: la salto)')
    return None, []


# ───────────────────────────── giri finali ─────────────────────────────

def numeri(st):
    return [n.testo for n in st.nodi if n.pkg == PKG and re.search(r'\d', n.testo)]


def numeri_iniziali(volte=6):
    """I numeri della schermata iniziale appena aperta: si aspetta che finisca l'animazione d'avvio e che
    compaiano (come all'inizio dell'esplorazione), al massimo volte × 8 secondi."""
    for _ in range(volte):
        st = osserva()
        n = numeri(st) if st.pkg == PKG else []
        if n:
            return n
        time.sleep(8)
    return []


def persistenza_dalla_home(perche):
    """Ripiego quando non si riesce a tornare alla schermata di fine esplorazione (per esempio un filtro che l'app
    ricorda e che, rifacendo il percorso, si spegne): il controllo si fa sulla schermata iniziale, che si raggiunge
    sempre. I totali della collezione, chiusa e riaperta l'app, devono essere uguali."""
    log(f'  ({perche}: controllo la schermata iniziale)')
    avvia(freddo=True)
    vivo = numeri_iniziali()
    if not vivo:
        log('  (nessun numero nella schermata iniziale, nemmeno aspettando: salto)')
        return
    adb('shell input keyevent 3')
    time.sleep(1)
    adb(f'shell am kill {PKG}')
    time.sleep(1)
    avvia()
    dopo = numeri_iniziali()
    if dopo != vivo:
        diff = [x for x in dopo if x not in vivo][:3] or [x for x in vivo if x not in dopo][:3]
        problema('errore', 'dati', 'schermata iniziale', f'dopo aver chiuso e riaperto l\'app i numeri cambiano: {diff}')
    else:
        log(f'  schermata iniziale: tutto come prima ({len(vivo)} numeri controllati)')


def prova_persistenza():
    """Quello che si è fatto deve restare dopo aver chiuso l'app (anche se è Android a chiuderla in background)."""
    log('— Dati dopo chiusura e riapertura —')
    st = osserva()
    k = riconosci(st)
    if not k or st.pkg != PKG:
        persistenza_dalla_home('alla fine dell\'esplorazione non ero in una schermata nota')
        return
    st = in_cima(st)
    vivo = numeri(st)
    if not vivo:
        log('  (nessun numero sullo schermo da confrontare: salto)')
        return
    # Android che chiude l'app in background per liberare memoria: riaprendola deve essere tutto com'era
    adb('shell input keyevent 3')
    time.sleep(1)
    adb(f'shell am kill {PKG}')
    time.sleep(1)
    rifatto = rifai_percorso(SCHERMATE[k]['passi'])
    if rifatto is None:
        persistenza_dalla_home('non riesco a tornare alla stessa schermata')
        return
    dopo = numeri(in_cima(rifatto))
    if dopo != vivo:
        diff = [x for x in dopo if x not in vivo][:3] or [x for x in vivo if x not in dopo][:3]
        problema('errore', 'dati', SCHERMATE[k]['nome'], f'dopo aver chiuso e riaperto l\'app i numeri cambiano: {diff}')
    else:
        log(f'  «{SCHERMATE[k]["nome"]}»: tutto come prima ({len(vivo)} numeri controllati)')


def giro_configurazione(nome, prepara, ripristina):
    log(f'— Giro con {nome} —')
    global W, H, DPI
    prepara()
    time.sleep(2)
    W, H, DPI = schermo()
    SOGLIA[0] = 0.45
    for k, v in list(SCHERMATE.items())[:16]:
        st = rifai_percorso(v['passi'])
        if st is None or riconosci(st) != k:
            continue
        fn = foto(f'{nome}_{v["nome"]}')
        controlla(st, v['nome'], fn, nome)
        controlla_sovrapposizioni(st, f"{v['nome']} · {nome}", fn)
        controlla_salute(v['nome'], f'apertura con {nome}')
    ripristina()
    SOGLIA[0] = 0.8
    time.sleep(2)
    W, H, DPI = schermo()


def percorso_leggibile(passi):
    """Come si arriva a una schermata, per il resoconto: i passi sono (azione, da, a)."""
    return ' → '.join(str(p[0]) for p in passi) or "all'apertura"


def stress():
    log('— Stress test: 3000 tocchi, scorrimenti e gesti a caso, 8 al secondo (monkey di Android) —')
    avvia(freddo=True)
    PID[0] = pid()
    out = adb(f'shell monkey -p {PKG} --pct-syskeys 0 --pct-appswitch 0 --throttle 120 -s 2611 -v 3000', timeout=900)
    open(os.path.join(OUT, 'stress.txt'), 'w').write(out)
    if re.search(r'CRASH', out):
        problema('errore', 'crash', 'stress test', 'l\'app si è chiusa durante i tocchi a raffica', foto('stress'))
    elif re.search(r'ANR in|NOT RESPONDING', out):
        problema('errore', 'blocco', 'stress test', 'l\'app si è bloccata (non risponde) durante i tocchi a raffica', foto('stress'))
        salva_tracce_anr()
    else:
        log('  nessun crash né blocco')
    controlla_salute('stress test', 'tocchi a raffica')


# ───────────────────────────── via ─────────────────────────────

def main():
    log(f'Esploratore su {PKG} · schermo {W}×{H} a {DPI} dpi · {MINUTI:.0f} minuti di esplorazione')
    # l'emulatore appena acceso è ancora occupato ad avviare i servizi di sistema: si lascia finire
    for _ in range(12):
        carico = adb('shell cat /proc/loadavg').split()
        if carico and float(carico[0]) < 3.0:
            break
        time.sleep(10)
    finestre_di_sistema(leggi_schermo())
    adb('logcat -c')
    adb('logcat -b crash -c')
    adb('shell settings put system font_scale 1.0')
    t = avvia(freddo=True)
    log(f'Apertura a freddo: {t} ms')
    if t and t > 8000:   # emulatore senza scheda video: un telefono vero è molto più veloce
        problema('avviso', 'lentezza', 'apertura', f'l\'app ci mette {t / 1000:.1f} s ad aprirsi')
    PID[0] = pid()
    for _ in range(6):
        st = osserva()
        if st.pkg == PKG and st.azioni:
            break
        log('  (la prima schermata non è ancora pronta: aspetto)')
        time.sleep(8)
    esplora()
    log(f'Esplorazione: {len(SCHERMATE)} schermate, {CONTEGGI["azioni"]} azioni, {CONTEGGI["modifiche"]} modifiche, '
        f'{CONTEGGI["senza_effetto"]} senza effetto visibile, {CONTEGGI["uscite"]} verso altre app'
        f'{" · tempo finito" if tempo_finito() else " · visto tutto"}')
    prova_persistenza()
    giro_configurazione('tema scuro', lambda: adb('shell cmd uimode night yes'), lambda: adb('shell cmd uimode night no'))
    giro_configurazione('carattere grande', lambda: adb('shell settings put system font_scale 1.3'),
                        lambda: adb('shell settings put system font_scale 1.0'))
    giro_configurazione('schermo piccolo', lambda: (adb('shell wm size 720x1280'), adb('shell wm density 320')),
                        lambda: (adb('shell wm size reset'), adb('shell wm density reset')))
    giro_configurazione('tablet', lambda: (adb('shell wm size 1600x2560'), adb('shell wm density 320')),
                        lambda: (adb('shell wm size reset'), adb('shell wm density reset')))
    giro_configurazione('telefono ruotato', lambda: (adb('shell settings put system accelerometer_rotation 0'),
                                                     adb('shell settings put system user_rotation 1')),
                        lambda: adb('shell settings put system user_rotation 0'))
    stress()

    errori = [p for p in PROBLEMI if p['gravita'] == 'errore']
    avvisi = [p for p in PROBLEMI if p['gravita'] != 'errore']
    with open(os.path.join(OUT, 'resoconto.md'), 'w', encoding='utf-8') as f:
        f.write(f'# Esplorazione di {PKG}\n\n')
        f.write(f'- schermate trovate: {len(SCHERMATE)}\n- azioni provate: {CONTEGGI["azioni"]}\n')
        f.write(f'- errori: {len(errori)}\n- avvisi: {len(avvisi)}\n\n## Schermate\n\n')
        for v in SCHERMATE.values():
            f.write(f'- **{v["nome"]}** ({v["foto"]}): {percorso_leggibile(v["passi"])}\n')
        for titolo, elenco in (('Errori', errori), ('Avvisi', avvisi)):
            f.write(f'\n## {titolo}\n\n')
            for p in elenco:
                f.write(f'- [{p["tipo"]}] **{p["dove"]}**: {p["cosa"]}' + (f' ({p["schermata"]})' if p['schermata'] else '') + '\n')
    json.dump({'schermate': len(SCHERMATE), 'azioni': CONTEGGI['azioni'], 'problemi': PROBLEMI},
              open(os.path.join(OUT, 'esito.json'), 'w'), ensure_ascii=False, indent=1)
    log(f'FINE: {len(errori)} errori, {len(avvisi)} avvisi · dettagli in resoconto.md')
    sys.exit(1 if errori else 0)


if __name__ == '__main__':
    main()
