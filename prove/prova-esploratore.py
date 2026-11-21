"""Prove dei controlli dell'esploratore, senza emulatore: schermate finte, costruite apposta, per essere sicuri che
segnali i problemi veri e non dia falsi allarmi (quelli della build del 21/11: «Andorra» sotto la barra delle schede
e il fondo delle mancanti della Germania controllato a metà pagina).
Uso: python3 prove/prova-esploratore.py"""
import importlib.util, os, sys, tempfile

QUI = os.path.dirname(os.path.abspath(__file__))
sys.argv = ['esploratore.py', 'it.collezione.euro', tempfile.mkdtemp(prefix='prova-esploratore-'), '1']
spec = importlib.util.spec_from_file_location('esploratore', os.path.join(QUI, 'esploratore.py'))
E = importlib.util.module_from_spec(spec)
spec.loader.exec_module(E)
E.W, E.H = 1080, 2400
PKG = E.PKG
fallite = []


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        fallite.append(m)


def nodo(i, testo, b, clic=True, scorre=False, cls='android.widget.Button', padre=0):
    return E.Nodo(i=i, cls=cls, testo=testo, desc='', rid='', pkg=PKG, b=b, clic=clic, lungo=False, spunta=False,
                  spuntato=False, scorre=scorre, abilitato=True, padre=padre)


def pulisci():
    E.PROBLEMI.clear()
    E._visti.clear()
    E.FISSE.clear()


def schede(i0=10):
    nomi = ['Collezione', 'Le mie', 'Catalogo', 'Mancanti', 'Extra', 'Cerca']
    return [nodo(i0 + k, t, (k * 180, 2170, (k + 1) * 180, 2330)) for k, t in enumerate(nomi)]


def indicizza(nodi):
    # l'esploratore ritrova i nodi per posizione nell'elenco (nodi[n.i]), come nel dump di uiautomator
    for k, n in enumerate(nodi):
        n.i = k
    return nodi


class Schermo:
    def __init__(self, nodi):
        self.nodi = indicizza(nodi)


# 1. la riga di un paese che passa sotto la barra delle schede, sulla prima schermata (barre non ancora imparate)
pulisci()
radice = nodo(0, '', (0, 0, 1080, 2400), clic=False, scorre=True, cls='android.webkit.WebView', padre=-1)
andorra = nodo(1, 'Andorra 0 0/141', (40, 2120, 1040, 2260))
E.controlla_sovrapposizioni(Schermo([radice, andorra] + schede()), 'Eurodex')
ok(not E.PROBLEMI, 'una riga che passa sotto la barra delle schede non è una sovrapposizione')

# 2. due pulsanti veri uno sopra l'altro in mezzo alla pagina: va segnalato
pulisci()
a = nodo(1, 'Segna tutte', (100, 900, 600, 1050))
b = nodo(2, 'Togli tutte', (150, 920, 650, 1060))
E.controlla_sovrapposizioni(Schermo([radice, a, b] + schede()), 'Scheda')
ok(len(E.PROBLEMI) == 1 and 'si sovrappongono' in E.PROBLEMI[0]['cosa'], 'due pulsanti sovrapposti in mezzo: segnalati')

# 3. due pulsanti della barra uno sopra l'altro: va segnalato anche quello
pulisci()
barra = schede()
barra[2].b = (300, 2170, 520, 2330)       # «Catalogo» si allarga sopra «Le mie»
E.controlla_sovrapposizioni(Schermo([radice] + barra), 'Eurodex')
ok(any('Catalogo' in p['cosa'] for p in E.PROBLEMI), 'due pulsanti della barra sovrapposti: segnalati')


# 4 e 5. il fondo della pagina: una pagina lunghissima (non finisce entro 60 scorrimenti) e una che finisce con
#        l'ultima riga coperta dalla barra
def pagina_finta(righe, altezza_riga=180, passo=900):
    stato = {'y': 0}
    fine = max(0, righe * altezza_riga + 300 - 2170)

    def nodi_ora():
        nodi = [nodo(0, '', (0, 0, 1080, 2400), clic=False, scorre=True, cls='android.view.View', padre=-1)]
        for r in range(righe):
            y = 300 + r * altezza_riga - stato['y']
            if -altezza_riga < y < 2400:
                nodi.append(nodo(len(nodi), f'Riga {r}', (40, y, 1040, y + altezza_riga - 20), clic=False))
        return indicizza(nodi + schede())

    def osserva():
        n = nodi_ora()
        return E.Stato(nodi=n, pkg=PKG, chiave='pagina', firma=str(stato['y']), azioni=[], nome='Pagina')

    def scorri(giu, area):
        stato['y'] = min(fine, stato['y'] + passo) if giu else max(0, stato['y'] - passo)

    E.osserva, E.scorri = osserva, scorri
    E.aspetta_fermo = lambda *a, **k: None
    E.osserva_durante_gesto = lambda area: nodi_ora()
    E.foto = lambda *a, **k: 'foto.png'
    return osserva()


pulisci()
st = pagina_finta(righe=400)             # 400 righe: ben oltre 60 scorrimenti
E.esplora_pagina(st, 'Mancanti')
ok(not any('resta coperto' in p['cosa'] for p in E.PROBLEMI), 'pagina più lunga di 60 scorrimenti: nessun falso «coperto»')
diario = open(os.path.join(sys.argv[2], 'diario.txt'), encoding='utf-8').read()
ok('il fondo non lo controllo' in diario, 'e il diario dice che il fondo non è stato controllato')

pulisci()
st = pagina_finta(righe=30)
orig = E.osserva


def osserva_con_ultima_coperta():
    s = orig()
    # in fondo, l'ultima riga finisce sotto la barra (il bug che il controllo deve trovare)
    for n in s.nodi:
        if n.testo == 'Riga 29' and int(s.firma) > 0:
            n.b = (40, 2100, 1040, 2260)
    return s


E.osserva = osserva_con_ultima_coperta
E.esplora_pagina(st, 'Mancanti')
ok(any('resta coperto' in p['cosa'] for p in E.PROBLEMI), 'in fondo vero l\'ultima riga coperta dalla barra: segnalata')

# 6 e 7. dati dopo chiusura e riapertura, sulla schermata iniziale quando non si torna a quella di prima
def finta_riapertura(prima, dopo, vuote=0):
    # prima dei numeri, `vuote` letture senza numeri (l'animazione d'avvio che non è ancora finita)
    letture = iter([[]] * vuote + [prima] + [[]] * vuote + [dopo])
    E.avvia = lambda *a, **k: None
    E.adb = lambda *a, **k: ''
    E.osserva = lambda: E.Stato(nodi=[], pkg=PKG, chiave='home', firma='', azioni=[], nome='Eurodex')
    E.in_cima = lambda st=None: st
    E.numeri = lambda st: next(letture)
    E.time.sleep = lambda s: None


pulisci()
finta_riapertura(['1575', '4818', '33%'], ['1575', '4818', '33%'])
E.persistenza_dalla_home('non riesco a tornare alla stessa schermata')
diario = open(os.path.join(sys.argv[2], 'diario.txt'), encoding='utf-8').read()
ok(not E.PROBLEMI and 'schermata iniziale: tutto come prima' in diario,
   'riaperta l\'app, la schermata iniziale è uguale: il controllo c\'è e passa (non più "salto")')

pulisci()
finta_riapertura(['1575', '4818', '33%'], ['1574', '4818', '33%'])
E.persistenza_dalla_home('non riesco a tornare alla stessa schermata')
ok(any(p['tipo'] == 'dati' for p in E.PROBLEMI), 'riaperta l\'app, un totale cambia: segnalato come errore di dati')

pulisci()
finta_riapertura(['1575', '4818'], ['1575', '4818'], vuote=2)
E.persistenza_dalla_home('alla fine dell\'esplorazione non ero in una schermata nota')
diario = open(os.path.join(sys.argv[2], 'diario.txt'), encoding='utf-8').read()
ok(not E.PROBLEMI and diario.count('schermata iniziale: tutto come prima') >= 2,
   'con l\'animazione d\'avvio ancora in corso aspetta i numeri invece di saltare')

# 8. il resoconto finale: i percorsi delle schermate si scrivono senza far cadere l'esploratore (prima cercava un campo
#    'percorso' che non esiste: KeyError alla fine di ogni esplorazione, quindi il job falliva sempre)
az = E.Azione(tipo='tocca', etichetta='Mancanti', forma=('Button', 1, 1), centro=(1, 1))
ok(E.percorso_leggibile([(az, 'Eurodex', 'Mancanti')]) == 'tocco «Mancanti»' and E.percorso_leggibile([]) == "all'apertura",
   'il resoconto scrive i percorsi delle schermate (niente più KeyError alla fine)')
sorgente = open(os.path.join(QUI, 'esploratore.py'), encoding='utf-8').read()
ok("v['percorso']" not in sorgente and 'v["percorso"]' not in sorgente, 'nessun riferimento al campo che non esiste')

print('RISULTATO:', 'TUTTO OK' if not fallite else f'{len(fallite)} PROBLEMI')
raise SystemExit(1 if fallite else 0)
