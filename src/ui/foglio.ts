import { nothing, render, type TemplateResult } from 'lit-html';
import { $, fogliAperti, necessario } from '../core/dom';
import { aggiornaContatori } from './contatori';
import { isola, libera } from './modale';
import { ridisegnaSottoSeServe } from './navigazione';

/**
 * Le schede che salgono dal basso (scheda moneta, impostazioni, finestre di avvio…). Si chiudono con il tasto
 * Indietro, toccando fuori o tirandole giù.
 */

let alChiudere: (() => void) | null = null;

export function apriFoglio(contenuto: TemplateResult, classe = ''): void {
  const corpo = necessario('#sheetbody');
  render(nothing, corpo); // si ridisegna da capo: niente resti della scheda di prima
  render(contenuto, corpo);
  necessario('#sheetwrap').className = classe;
  document.body.classList.add('open-sheet');
  necessario('.sheet').setAttribute('aria-hidden', 'false');
  isola(necessario('#sheetwrap'));
  const dentro = $('.sheet .in');
  if (dentro) dentro.scrollTop = 0;
  aggiornaContatori();
}

/** Apre una scheda e aspetta che si chiuda (serve a mettere in fila le finestre all'avvio). */
export function apriFoglioEAspetta(contenuto: TemplateResult, classe = ''): Promise<void> {
  return new Promise(ok => {
    apriFoglio(contenuto, classe);
    alChiudere = ok;
  });
}

export function chiudiFoglio(): void {
  ridisegnaSottoSeServe();
  document.body.classList.remove('open-sheet');
  necessario('.sheet').setAttribute('aria-hidden', 'true');
  libera(necessario('#sheetwrap'));
  const foglio = $('.sheet');
  if (foglio) foglio.style.transform = '';
  const f = alChiudere;
  alChiudere = null;
  if (f) setTimeout(f, 320);
}

export const foglioCon = (selettore: string): boolean =>
  fogliAperti() && !!$(`#sheetwrap ${selettore}, #sheetwrap${selettore}`);

/**
 * Trascinamento per chiudere: dalla maniglia in qualsiasi momento, oppure da qualsiasi punto quando il contenuto è
 * già in cima. Il pannello segue il dito (e lo sfondo si schiarisce); lasciato oltre un quarto dell'altezza, o con
 * un colpo veloce verso il basso, si chiude, altrimenti torna su.
 */
export function attivaTrascinamento(): void {
  let y0: number | null = null;
  let x0 = 0;
  let dy = 0;
  let foglio: HTMLElement | null = null;
  let dentro: HTMLElement | null = null;
  let sfondo: HTMLElement | null = null;
  let maniglia = false;
  let trascina = false;
  let punti: [number, number][] = [];
  let nienteClicFino = 0;

  function inizio(x: number, y: number, bersaglio: Element) {
    y0 = null;
    trascina = false;
    if (!fogliAperti()) return;
    foglio = bersaglio.closest<HTMLElement>('.sheet');
    if (!foglio) return;
    dentro = foglio.querySelector<HTMLElement>('.in');
    sfondo = $('.backdrop');
    maniglia = !!bersaglio.closest('.grab') || bersaglio === dentro;
    if ((!maniglia && (dentro?.scrollTop ?? 0) > 0) || bersaglio.closest('input, textarea, .ruota')) {
      foglio = null;
      return;
    }
    y0 = y;
    x0 = x;
    dy = 0;
    punti = [[performance.now(), y]];
  }

  function movimento(x: number, y: number, ev: Event | null) {
    if (y0 == null || !foglio || !dentro) return;
    const ddy = y - y0;
    const ddx = x - x0;
    if (!trascina) {
      if (Math.abs(ddy) < 6 && Math.abs(ddx) < 6) return; // un tocco che trema appena resta un tocco
      // si decide al primo movimento vero: verso il basso = si trascina; in su o di lato = si scorre
      if (ddy <= 0 || Math.abs(ddx) > Math.abs(ddy) || (!maniglia && dentro.scrollTop > 0)) {
        y0 = null;
        foglio = null;
        return;
      }
      trascina = true;
      foglio.style.transition = 'none';
      if (sfondo) sfondo.style.transition = 'none';
    }
    if (ev?.cancelable) ev.preventDefault();
    const ora = performance.now();
    punti.push([ora, y]);
    while (punti.length > 2 && ora - (punti[0]?.[0] ?? ora) > 100) punti.shift();
    dy = Math.max(0, ddy);
    foglio.style.transform = `translateY(${dy}px)`;
    if (sfondo) sfondo.style.opacity = String(Math.max(0, 1 - dy / Math.max(200, dentro.offsetHeight)));
  }

  function fine() {
    if (y0 == null || !foglio || !dentro) {
      y0 = null;
      return;
    }
    // velocità del dito negli ultimi 100 millesimi di secondo (pixel al millesimo)
    const p0 = punti[0];
    const p1 = punti[punti.length - 1];
    const velocita = p0 && p1 && p1[0] > p0[0] ? (p1[1] - p0[1]) / (p1[0] - p0[0]) : 0;
    const f = foglio;
    const chiudi = trascina && (dy > Math.min(160, dentro.offsetHeight * 0.25) || (dy > 24 && velocita > 0.4));
    y0 = null;
    foglio = null;
    if (!trascina) return;
    nienteClicFino = performance.now() + 350; // il tocco che ha trascinato non deve anche premere un pulsante
    f.style.transition = '';
    if (sfondo) {
      sfondo.style.transition = '';
      sfondo.style.opacity = '';
    }
    if (chiudi) chiudiFoglio();
    else f.style.transform = '';
  }

  document.addEventListener(
    'touchstart',
    e => {
      const t = e.touches[0];
      if (e.touches.length === 1 && t && e.target instanceof Element) inizio(t.clientX, t.clientY, e.target);
      else y0 = null;
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    e => {
      const t = e.touches[0];
      if (y0 != null && t) movimento(t.clientX, t.clientY, e);
    },
    { passive: false },
  );
  document.addEventListener('touchend', fine);
  document.addEventListener('touchcancel', fine);
  // con il mouse (anteprima sul computer)
  document.addEventListener(
    'pointerdown',
    e => {
      if (e.pointerType === 'mouse' && e.target instanceof Element) inizio(e.clientX, e.clientY, e.target);
    },
    { passive: true },
  );
  document.addEventListener(
    'pointermove',
    e => {
      if (e.pointerType === 'mouse' && y0 != null) movimento(e.clientX, e.clientY, null);
    },
    { passive: true },
  );
  document.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') fine();
  });
  document.addEventListener(
    'click',
    e => {
      if (performance.now() < nienteClicFino) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}
