import { html, svg, type TemplateResult } from 'lit-html';
import { paesi } from '../catalogo/indice';
import MAPPA from '../dati/mappa.json';

interface DatiMappa {
  view?: string;
  shapes: { cc: string | null; n: string; d: string }[];
  dots: { cc: string; x: number; y: number }[];
}

const temaScuro = (): boolean => matchMedia('(prefers-color-scheme: dark)').matches;

/** Dal colore "da iniziare" al blu dell'app, verde quando il paese è completo. */
export function coloreMappa(pct: number, completo = false): string {
  const scuro = temaScuro();
  if (completo) return scuro ? '#3CCB7F' : '#12A150';
  if (pct <= 0) return scuro ? '#2A3350' : '#DCE3F5';
  const a = 0.25 + 0.75 * pct;
  const da = scuro ? [42, 51, 80] : [220, 227, 245];
  const a1 = scuro ? [124, 149, 255] : [35, 72, 200];
  const mix = (i: number) => Math.round((da[i] ?? 0) + ((a1[i] ?? 0) - (da[i] ?? 0)) * a);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

export function vistaMappa(): TemplateResult {
  const m = MAPPA as DatiMappa;
  const forme = m.shapes.map(s =>
    s.cc && paesi[s.cc]
      ? svg`<path d=${s.d} data-mapcc=${s.cc} data-act="go" data-v="country" data-cc=${s.cc} class="mc"
          role="button" aria-label=${paesi[s.cc]?.name ?? s.cc}></path>`
      : svg`<path d=${s.d} class="mo"></path>`,
  );
  const punti = m.dots
    .filter(d => paesi[d.cc])
    .map(
      d =>
        svg`<g data-act="go" data-v="country" data-cc=${d.cc} class="mdot" role="button" aria-label=${paesi[d.cc]?.name ?? d.cc}>
          <circle cx=${d.x} cy=${d.y} r="13" class="mhit"></circle>
          <circle cx=${d.x} cy=${d.y} r="6.5" data-mapcc=${d.cc} class="mdc"></circle>
        </g>`,
    );
  return html`<div class="card mapcard">
    <svg viewBox=${m.view ?? '92 88 790 790'} class="map">${forme}${punti}</svg>
    <div class="mleg">
      <span><i style="background:${coloreMappa(0)}"></i>da iniziare</span>
      <span><i style="background:${coloreMappa(0.5)}"></i>in corso</span>
      <span><i style="background:${coloreMappa(1, true)}"></i>completato</span>
    </div>
    <div class="note" style="margin:6px 0 0">Tocca un paese per aprirlo. I pallini sono i microstati.</div>
  </div>`;
}
