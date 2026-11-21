#!/usr/bin/env python3
"""Diagnosi dello sfocato delle barre (backdrop-filter di header.top e nav.tabs) nel WebView dell'app, con gli
strumenti di sviluppo (protocollo CDP). Solo libreria standard di Python: niente pacchetti da installare.

Sull'emulatore (build con webContentsDebuggingEnabled e app aperta):
    python3 prove/sfocato-devtools.py --uscita sfocato
In locale, contro un Chrome avviato con --remote-debugging-port=9333:
    python3 prove/sfocato-devtools.py --senza-adb --porta 9333 --pagina app-prova --uscita sfocato

Stampa e salva in <uscita>/diagnosi.json: stile calcolato delle due barre e dei loro antenati, i layer del compositore
che le contengono (con il perché sono layer), e la nitidezza sotto la barra in due immagini: quella che il motore
disegna (Page.captureScreenshot) e quella che arriva davvero sullo schermo (adb exec-out screencap). Se la prima è
sfocata e la seconda no, lo sfocato si perde dopo il motore, quando Android compone il WebView.
"""
import argparse
import base64
import json
import os
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.request

PKG = 'it.collezione.euro'


def adb(args, seriale=None, binario=False):
    cmd = ['adb'] + (['-s', seriale] if seriale else []) + args
    out = subprocess.run(cmd, capture_output=True, check=True, timeout=60).stdout
    return out if binario else out.decode('utf-8', 'replace')


def collega_webview(porta, seriale):
    """adb forward dal PC al socket degli strumenti di sviluppo del WebView dell'app (quello con il suo pid)."""
    pid = adb(['shell', 'pidof', PKG], seriale).strip().split()
    socket_trovati = sorted(set(re.findall(r'@(webview_devtools_remote_\d+)', adb(['shell', 'cat', '/proc/net/unix'], seriale))))
    nome = next((s for s in socket_trovati if pid and s.endswith('_' + pid[0])), None)
    if not nome:
        sys.exit(f'niente socket degli strumenti di sviluppo per {PKG} (pid {pid}, trovati {socket_trovati}): '
                 'la build ha webContentsDebuggingEnabled e l\'app è aperta?')
    adb(['forward', f'tcp:{porta}', f'localabstract:{nome}'], seriale)
    return nome


class WebSocket:
    """Client WebSocket minimo (RFC 6455), quanto basta per il protocollo CDP: testo, maschera, ping, frammenti."""

    def __init__(self, url):
        m = re.match(r'ws://([^/:]+):(\d+)(/.*)', url)
        if not m:
            raise ValueError(f'indirizzo WebSocket inatteso: {url}')
        self.s = socket.create_connection((m.group(1), int(m.group(2))), timeout=30)
        chiave = base64.b64encode(os.urandom(16)).decode()
        richiesta = (f'GET {m.group(3)} HTTP/1.1\r\nHost: {m.group(1)}:{m.group(2)}\r\nUpgrade: websocket\r\n'
                     f'Connection: Upgrade\r\nSec-WebSocket-Key: {chiave}\r\nSec-WebSocket-Version: 13\r\n\r\n')
        self.s.sendall(richiesta.encode())
        testa = b''
        while b'\r\n\r\n' not in testa:
            pezzo = self.s.recv(1)
            if not pezzo:
                raise ConnectionError('connessione chiusa durante l\'apertura del WebSocket')
            testa += pezzo
        if b' 101 ' not in testa.split(b'\r\n', 1)[0]:
            raise ConnectionError(f'il WebSocket non si apre: {testa.splitlines()[0]!r}')

    def _leggi(self, n):
        dati = b''
        while len(dati) < n:
            pezzo = self.s.recv(n - len(dati))
            if not pezzo:
                raise ConnectionError('connessione chiusa')
            dati += pezzo
        return dati

    def _manda(self, opcode, dati):
        lung = len(dati)
        testa = bytes([0x80 | opcode])
        if lung < 126:
            testa += bytes([0x80 | lung])
        elif lung < 65536:
            testa += bytes([0x80 | 126]) + struct.pack('!H', lung)
        else:
            testa += bytes([0x80 | 127]) + struct.pack('!Q', lung)
        maschera = os.urandom(4)
        self.s.sendall(testa + maschera + bytes(b ^ maschera[i % 4] for i, b in enumerate(dati)))

    def manda(self, testo):
        self._manda(0x1, testo.encode())

    def ricevi(self):
        messaggio = b''
        while True:
            b0, b1 = self._leggi(2)
            fin, opcode, lung = b0 & 0x80, b0 & 0x0F, b1 & 0x7F
            if lung == 126:
                lung = struct.unpack('!H', self._leggi(2))[0]
            elif lung == 127:
                lung = struct.unpack('!Q', self._leggi(8))[0]
            maschera = self._leggi(4) if b1 & 0x80 else None
            dati = self._leggi(lung)
            if maschera:
                dati = bytes(b ^ maschera[i % 4] for i, b in enumerate(dati))
            if opcode == 0x9:                       # ping: si risponde pong
                self._manda(0xA, dati)
                continue
            if opcode == 0x8:
                raise ConnectionError('il WebSocket è stato chiuso')
            if opcode in (0x0, 0x1, 0x2):
                messaggio += dati
                if fin:
                    return messaggio.decode('utf-8', 'replace')


class CDP:
    def __init__(self, url_ws):
        self.ws, self.n, self.eventi = WebSocket(url_ws), 0, []

    def chiama(self, metodo, **parametri):
        self.n += 1
        self.ws.manda(json.dumps({'id': self.n, 'method': metodo, 'params': parametri}))
        while True:
            r = json.loads(self.ws.ricevi())
            if r.get('id') == self.n:
                if 'error' in r:
                    raise RuntimeError(f'{metodo}: {r["error"]}')
                return r.get('result', {})
            self.eventi.append(r)

    def aspetta_evento(self, metodo, secondi=10):
        fine = time.time() + secondi
        while time.time() < fine:
            for i, e in enumerate(self.eventi):
                if e.get('method') == metodo:
                    return self.eventi.pop(i)
            self.ws.s.settimeout(max(0.1, fine - time.time()))
            try:
                self.eventi.append(json.loads(self.ws.ricevi()))
            except (socket.timeout, TimeoutError):
                break
        return None


STATO_JS = r"""(() => {
  const props = ['filter', 'opacity', 'mask-image', '-webkit-mask-image', 'clip-path', 'mix-blend-mode', 'will-change',
    'isolation', 'transform', 'contain', 'position', 'z-index', 'overflow', 'backdrop-filter', '-webkit-backdrop-filter',
    'background-color', 'content-visibility', 'view-transition-name'];
  const nome = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '');
  const catena = el => { const out = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e);
    const o = { el: nome(e) }; for (const p of props) o[p] = cs.getPropertyValue(p); out.push(o); } return out; };
  const h = document.querySelector('header.top'), n = document.querySelector('nav.tabs');
  return { ua: navigator.userAgent, dpr: devicePixelRatio, scrollY,
    supporta: CSS.supports('backdrop-filter', 'blur(1px)'), supportaWebkit: CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
    menoTrasparenza: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    html: document.documentElement.className, stileHtml: document.documentElement.getAttribute('style'),
    rettHeader: h && h.getBoundingClientRect().toJSON(), rettNav: n && n.getBoundingClientRect().toJSON(),
    header: h && catena(h), nav: n && catena(n) };
})()"""


def nitidezza(png, riquadro):
    """Energia del laplaciano nel riquadro (x0, y0, x1, y1), in pixel dell'immagine. Serve PIL, se c'è."""
    try:
        import io
        from PIL import Image
    except ImportError:
        return None
    img = Image.open(io.BytesIO(png)).convert('L').crop(tuple(int(v) for v in riquadro))
    w, h = img.size
    px = img.load()
    tot = n = 0
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            lap = 4 * px[x, y] - px[x - 1, y] - px[x + 1, y] - px[x, y - 1] - px[x, y + 1]
            tot += lap * lap
            n += 1
    return round(tot / n, 2) if n else None


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--porta', type=int, default=9222)
    a.add_argument('--seriale')
    a.add_argument('--senza-adb', action='store_true', help='Chrome locale già aperto con --remote-debugging-port')
    a.add_argument('--pagina', default='https://localhost', help='pezzo dell\'indirizzo della pagina da guardare')
    a.add_argument('--scorri', type=int, default=300)
    a.add_argument('--uscita', default='sfocato')
    o = a.parse_args()
    os.makedirs(o.uscita, exist_ok=True)
    diagnosi = {}
    if not o.senza_adb:
        diagnosi['socket'] = collega_webview(o.porta, o.seriale)
    pagine = json.load(urllib.request.urlopen(f'http://127.0.0.1:{o.porta}/json', timeout=30))
    pagina = next((p for p in pagine if p.get('type') == 'page' and o.pagina in p.get('url', '')), None)
    if not pagina:
        sys.exit(f'nessuna pagina con «{o.pagina}» nell\'indirizzo: {[p.get("url") for p in pagine]}')
    diagnosi['pagina'] = pagina.get('url')
    cdp = CDP(pagina['webSocketDebuggerUrl'])

    # testo sotto le barre: si scorre la pagina, e si aspettano due fotogrammi
    cdp.chiama('Runtime.evaluate', expression=f'window.scrollTo(0, {o.scorri}); 1', returnByValue=True)
    cdp.chiama('Runtime.evaluate', expression='new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))',
               awaitPromise=True, returnByValue=True)
    stato = cdp.chiama('Runtime.evaluate', expression=STATO_JS, returnByValue=True)['result'].get('value', {})
    diagnosi['stato'] = stato

    # layer del compositore: quali contengono le barre, e perché
    cdp.chiama('DOM.enable')
    radice = cdp.chiama('DOM.getDocument', depth=1)['root']['nodeId']
    nodi = {}
    for sel in ('header.top', 'nav.tabs', 'main#main', '.app', 'body', 'html'):
        nid = cdp.chiama('DOM.querySelector', nodeId=radice, selector=sel).get('nodeId')
        if nid:
            nodi[cdp.chiama('DOM.describeNode', nodeId=nid)['node']['backendNodeId']] = sel
    cdp.chiama('LayerTree.enable')
    # l'elenco dei layer arriva con un evento al prossimo aggiornamento: si muove la pagina di un pixel avanti e
    # indietro, e si tiene l'ultimo elenco non vuoto
    layer, fine = [], time.time() + 15
    while time.time() < fine and not layer:
        cdp.chiama('Runtime.evaluate', expression=f'window.scrollTo(0, {o.scorri + 1}); window.scrollTo(0, {o.scorri}); 1',
                   returnByValue=True)
        evento = cdp.aspetta_evento('LayerTree.layerTreeDidChange', 3)
        layer = (evento or {}).get('params', {}).get('layers') or []
    diagnosi['layer_totali'] = len(layer)
    diagnosi['nodi_cercati'] = {str(k): v for k, v in nodi.items()}
    diagnosi['layer'] = [{'id': l['layerId'], 'genitore': l.get('parentLayerId'), 'nodo': l.get('backendNodeId'),
                          'riquadro': [l.get('offsetX'), l.get('offsetY'), l.get('width'), l.get('height')],
                          'disegna': l.get('drawsContent')} for l in layer]
    # i layer non sempre dicono a quale elemento appartengono (backendNodeId): allora si riconoscono dalla misura,
    # cioè quella della barra per dpr
    dpr = stato.get('dpr') or 1
    misure = {nome: (r['width'] * dpr, r['height'] * dpr) for nome, r in
              (('header.top', stato.get('rettHeader')), ('nav.tabs', stato.get('rettNav'))) if r}
    diagnosi['layer_barre'] = []
    for l in layer:
        elemento = nodi.get(l.get('backendNodeId'))
        if not elemento:
            elemento = next((nome for nome, (w, h) in misure.items()
                             if abs((l.get('width') or 0) - w) <= 12 and abs((l.get('height') or 0) - h) <= 4), None)
        try:
            perche = cdp.chiama('LayerTree.compositingReasons', layerId=l['layerId'])
            perche = perche.get('compositingReasonIds') or perche.get('compositingReasons') or []
        except RuntimeError as e:
            perche = [f'errore: {e}']
        for voce in diagnosi['layer']:
            if voce['id'] == l['layerId']:
                voce['perche'] = perche
        if elemento:
            diagnosi['layer_barre'].append({'elemento': elemento, 'layerId': l['layerId'], 'perche': perche,
                                            'riquadro': [l.get('offsetX'), l.get('offsetY'), l.get('width'), l.get('height')]})

    # le due immagini: quella del motore e quella dello schermo (sull'emulatore), con la nitidezza sotto la barra
    motore = base64.b64decode(cdp.chiama('Page.captureScreenshot', format='png')['data'])
    open(os.path.join(o.uscita, 'motore.png'), 'wb').write(motore)
    rh = stato.get('rettHeader') or {}
    if rh:
        # a destra del titolo, dove si vede solo quello che passa sotto la barra
        x0, x1, y1 = rh['width'] * 0.55, rh['width'] - 8, rh['bottom'] - 4
        diagnosi['nitidezza_motore'] = nitidezza(motore, (x0 * dpr, 4 * dpr, x1 * dpr, y1 * dpr))
    if not o.senza_adb:
        schermo = adb(['exec-out', 'screencap', '-p'], o.seriale, binario=True)
        open(os.path.join(o.uscita, 'schermo.png'), 'wb').write(schermo)
        # l'app è a tutto schermo (edge-to-edge: la barra di stato sta sopra il WebView, e header.top ha già il suo
        # spazio con env(safe-area-inset-top)), quindi le coordinate della pagina × dpr sono quelle dello schermo.
        # Le due immagini vanno comunque guardate a occhio: sono salvate accanto a diagnosi.json.
        if rh:
            diagnosi['nitidezza_schermo'] = nitidezza(schermo, (x0 * dpr, 4 * dpr, x1 * dpr, y1 * dpr))
    print(json.dumps(diagnosi, ensure_ascii=False, indent=1))
    with open(os.path.join(o.uscita, 'diagnosi.json'), 'w', encoding='utf-8') as f:
        json.dump(diagnosi, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
