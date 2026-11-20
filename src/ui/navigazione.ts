import { html, nothing, render, type TemplateResult } from 'lit-html';
import { caricaSchede } from '../catalogo/dati';
import { bandiera, nomePaese, paesi, tipi } from '../catalogo/indice';
import { inArrivo } from '../catalogo/proprieta';
import { prefs, preferite, vistaPulita, vistaSporca } from '../collezione/stato';
import { TAGLIO, isTaglio } from '../core/costanti';
import { $, $$, necessario } from '../core/dom';
import { vistaAnno } from '../viste/anno';
import { vistaCatalogo } from '../viste/catalogo';
import { vistaCollezione } from '../viste/collezione';
import { vistaCommemorativi, vistaCommemorativiAnno } from '../viste/commemorativi';
import { vistaCerca } from '../viste/cerca';
import { vistaElenco, vistaNovita } from '../viste/elenchi';
import { vistaExtra } from '../viste/extra';
import { vistaMancanti } from '../viste/mancanti';
import { vistaMie } from '../viste/mie';
import { vistaPaese } from '../viste/paese';
import { vistaStatistiche } from '../viste/statistiche';
import { azzeraStorico, vistaStorico } from '../viste/storico';
import { vistaTaglio } from '../viste/taglio';
import { vistaValore } from '../viste/valore';
import { aggiornaContatori } from './contatori';
import { chiudiFoglio } from './foglio';
import { ICONA } from './icone';
import { miglioraSelect } from './scelte';
import { livelloAttuale, stato, type Livello, type Scheda, type Schermata } from './stato-ui';
import { chiudiZoom } from './zoom';

export const SCHEDE: readonly [Scheda, string][] = [
  ['coll', 'Collezione'],
  ['mine', 'Le mie'],
  ['cat', 'Catalogo'],
  ['miss', 'Mancanti'],
  ['extra', 'Extra'],
  ['search', 'Cerca'],
];

const TITOLI: Record<Scheda, string> = {
  coll: 'Eurodex',
  mine: 'Le mie monete',
  cat: 'Catalogo',
  miss: 'Mancanti',
  extra: 'Varianti extra',
  search: 'Cerca',
};

const VISTE: Record<Scheda, () => TemplateResult> = {
  coll: vistaCollezione,
  mine: vistaMie,
  cat: vistaCatalogo,
  miss: vistaMancanti,
  extra: vistaExtra,
  search: vistaCerca,
};

/** Titolo e contenuto di una schermata aperta sopra le schede (paese, anno, statistiche…); null se non esiste più. */
export function schermata(l: Livello): [string, () => TemplateResult] | null {
  switch (l.v) {
    case 'country':
      return l.cc && paesi[l.cc] ? [`${bandiera(l.cc)} ${nomePaese(l.cc)}`, () => vistaPaese(l.cc ?? '')] : null;
    case 'year':
      return l.y ? [String(l.y), () => vistaAnno(l.y ?? 0)] : null;
    case 'denom':
      return l.d && isTaglio(l.d) ? [TAGLIO[l.d].label, () => vistaTaglio(l.d ?? '')] : null;
    case 'commem':
      return ['2 euro commemorativi', vistaCommemorativi];
    case 'cy':
      return l.y ? [`Commemorativi ${l.y}`, () => vistaCommemorativiAnno(l.y ?? 0)] : null;
    case 'news':
      return ['Novità', vistaNovita];
    case 'soon':
      return [
        'In arrivo',
        () =>
          html`<div class="note">
              Monete già annunciate o coniate di cui la BCE non ha ancora pubblicato la foto ufficiale. Le puoi già
              segnare.
            </div>
            ${vistaElenco(tipi.filter(inArrivo), 'Nessuna moneta in arrivo.')}`,
      ];
    case 'favs':
      return [
        'Preferite',
        () =>
          vistaElenco(
            tipi.filter(t => preferite.has(t.id)),
            'Tocca ☆ nella scheda di una moneta per aggiungerla qui.',
          ),
      ];
    case 'stats':
      return ['Statistiche', vistaStatistiche];
    case 'value':
      return ['Valore della collezione', vistaValore];
    case 'hist':
      return ['Storico', vistaStorico];
  }
}

// ───────── elenchi lunghissimi: disegnati a pezzi mentre si scorre ─────────

let daDisegnare: { pezzi: TemplateResult[]; i: number } | null = null;
let osservatore: IntersectionObserver | null = null;

export function sezioniPigre(sezioni: TemplateResult[], subito: number): TemplateResult {
  if (sezioni.length <= subito) return html`${sezioni}`;
  daDisegnare = { pezzi: sezioni.slice(subito), i: 0 };
  return html`${sezioni.slice(0, subito)}
    <div id="lazymore" aria-hidden="true" style="height:1px"></div>`;
}

function passoPigro(n = 2): boolean {
  const segno = $('#lazymore');
  if (!daDisegnare || !segno) return false;
  const contenitore = document.createElement('div');
  contenitore.style.display = 'contents';
  render(html`${daDisegnare.pezzi.slice(daDisegnare.i, daDisegnare.i + n)}`, contenitore);
  segno.before(contenitore);
  daDisegnare.i += n;
  if (daDisegnare.i >= daDisegnare.pezzi.length) {
    segno.remove();
    daDisegnare = null;
  }
  miglioraSelect(contenitore);
  aggiornaContatori();
  return true;
}

function osservaPigri(): void {
  osservatore?.disconnect();
  osservatore = null;
  const segno = $('#lazymore');
  if (!segno) return;
  osservatore = new IntersectionObserver(
    voci => {
      if (!voci.some(v => v.isIntersecting)) return;
      passoPigro();
      const prossimo = $('#lazymore');
      osservatore?.disconnect();
      if (prossimo) osservatore?.observe(prossimo);
      else osservatore = null;
    },
    { rootMargin: '1600px 0px' },
  );
  osservatore.observe(segno);
}

/** Disegna subito tutte le sezioni che aspettano (serve alle prove automatiche). */
export function disegnaTutto(): void {
  while (passoPigro(10));
}

/** Prima di tornare a una posizione salvata si disegna abbastanza pagina da arrivarci. */
function riempiFino(y: number): void {
  for (let k = 0; daDisegnare && document.documentElement.scrollHeight < y + innerHeight + 400 && k < 50; k++)
    passoPigro(4);
}

// ───────── disegno della pagina ─────────

export type Transizione = 'avanti' | 'indietro' | 'scheda' | '';

export function ridisegna(transizione: Transizione = ''): void {
  daDisegnare = null;
  const sopra = livelloAttuale();
  let titolo = TITOLI[stato.tab];
  let vista = VISTE[stato.tab];
  if (sopra) {
    const s = schermata(sopra);
    if (s) [titolo, vista] = s;
  }
  const main = necessario('#main');
  main.dataset.v = sopra ? sopra.v : stato.tab; // serve all'impaginazione sugli schermi larghi
  const senzaFiltro = !sopra && (stato.tab === 'miss' || stato.tab === 'mine' || stato.tab === 'extra');
  render(nothing, main); // si ridisegna da capo: niente resti della pagina di prima
  render(
    html`${
      prefs.onlyMissing && !senzaFiltro
        ? html`<button class="omnote" data-act="onlymiss">Stai vedendo solo le mancanti · <b>mostra tutte</b></button>`
        : nothing
    }${vista()}`,
    main,
  );
  render(
    sopra ? html`<button class="iconbtn" data-act="back" aria-label="Indietro">${ICONA.back}</button>` : nothing,
    necessario('#hleft'),
  );
  necessario('#htitle').textContent = titolo;
  render(
    html`${
        !senzaFiltro
          ? html`<button
              class="iconbtn${prefs.onlyMissing ? ' act' : ''}"
              data-act="onlymiss"
              aria-label="Solo mancanti"
              aria-pressed=${prefs.onlyMissing ? 'true' : 'false'}
            >
              ${prefs.onlyMissing ? ICONA.eyeoff : ICONA.eye}
            </button>`
          : nothing
      }<button class="iconbtn" data-act="settings" aria-label="Impostazioni">${ICONA.gear}</button>`,
    necessario('#hright'),
  );
  render(
    html`${SCHEDE.map(
      ([k, nome]) =>
        html`<button
          class=${stato.tab === k ? 'on' : ''}
          data-act="tab"
          data-tab=${k}
          aria-current=${stato.tab === k ? 'page' : nothing}
        >
          ${ICONA[k]}<span>${nome}</span>
        </button>`,
    )}`,
    necessario('#nav'),
  );
  for (const h of $$('.hscroll')) {
    const on = $('.fchip.on', h);
    if (on) h.scrollLeft = Math.max(0, on.offsetLeft - h.offsetLeft - 16);
  }
  miglioraSelect(main);
  osservaPigri();
  if (transizione) {
    main.classList.remove('in-avanti', 'in-indietro', 'in-scheda');
    main.getBoundingClientRect(); // riparte l'animazione di entrata
    main.classList.add(`in-${transizione}`);
  }
  aggiornaContatori();
}

/** Dopo una modifica fatta in una scheda: la pagina sotto si ridisegna restando dov'era. */
export function ridisegnaSottoSeServe(): void {
  if (!vistaSporca) return;
  vistaPulita();
  const y = window.scrollY;
  ridisegna();
  riempiFino(y);
  window.scrollTo(0, y);
}

/** Se la schermata aperta non esiste più (es. dopo un aggiornamento del catalogo) si torna alla scheda. */
export function verificaSchermata(): void {
  const sopra = livelloAttuale();
  if (sopra && !schermata(sopra)) stato.stack = [];
}

const posizioneSchede: Partial<Record<Scheda, number>> = {};

export function vai(
  v: Schermata,
  dati: { cc?: string | undefined; y?: string | number | undefined; d?: string | undefined },
): void {
  if (v === 'hist') azzeraStorico();
  const l: Livello = { v };
  if (dati.cc) l.cc = dati.cc;
  if (dati.y) l.y = Number(dati.y);
  if (dati.d) l.d = dati.d;
  const prima = livelloAttuale();
  if (prima) prima.sy = window.scrollY;
  else posizioneSchede[stato.tab] = window.scrollY;
  chiudiFoglio();
  chiudiZoom();
  stato.stack.push(l);
  ridisegna('avanti');
  window.scrollTo(0, 0);
  if (v === 'stats' || v === 'value')
    void caricaSchede().then(() => {
      const s = livelloAttuale();
      if (s && (s.v === 'stats' || s.v === 'value')) ridisegna();
    });
}

/** Toccando la scheda in cui si è già si torna in cima; da un'altra scheda si torna dove si era rimasti. */
export function cambiaScheda(tab: Scheda): void {
  const stessa = stato.tab === tab && !stato.stack.length;
  if (!stato.stack.length) posizioneSchede[stato.tab] = window.scrollY;
  stato.tab = tab;
  stato.stack = [];
  chiudiFoglio();
  ridisegna(stessa ? '' : 'scheda');
  if (!stessa) riempiFino(posizioneSchede[tab] ?? 0);
  window.scrollTo(stessa ? { top: 0, behavior: 'smooth' } : { top: posizioneSchede[tab] ?? 0 });
}

/** Indietro: chiude quello che è aperto, poi torna alla schermata o alla scheda di prima. Falso = uscire. */
export function indietro(): boolean {
  if (stato.stack.length) {
    stato.stack.pop();
    const sopra = livelloAttuale();
    ridisegna('indietro');
    const y = sopra ? (sopra.sy ?? 0) : (posizioneSchede[stato.tab] ?? 0);
    riempiFino(y);
    window.scrollTo(0, y);
    return true;
  }
  if (stato.tab !== 'coll') {
    posizioneSchede[stato.tab] = window.scrollY;
    stato.tab = 'coll';
    ridisegna('scheda');
    riempiFino(posizioneSchede.coll ?? 0);
    window.scrollTo(0, posizioneSchede.coll ?? 0);
    return true;
  }
  return false;
}
