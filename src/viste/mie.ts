import { html, type TemplateResult } from 'lit-html';
import { pezzi, tipoPerId } from '../catalogo/indice';
import { possedute, prefs, type ModoMie } from '../collezione/stato';
import { numero } from '../core/formato';
import { rigaTipoConPezzi } from '../ui/componenti';
import { sezioniPigre } from '../ui/navigazione';
import { ordina, raggruppa } from './ordine';

const MODI: readonly [ModoMie, string][] = [
  ['taglio', 'Per taglio'],
  ['paese', 'Per paese'],
  ['anno', 'Per anno'],
];

const NOMI_GRUPPI: Record<ModoMie, [string, string]> = {
  taglio: ['taglio', 'tagli'],
  paese: ['paese', 'paesi'],
  anno: ['anno', 'anni'],
};

/** Le mie: solo le monete che hai, divise per taglio, paese o anno. */
export function vistaMie(): TemplateResult {
  const come = prefs.mineMode ?? 'taglio';
  const scelta = html`<div class="seg" role="radiogroup" aria-label="Raggruppa">
    ${MODI.map(
      ([k, nome]) =>
        html`<button
          class=${come === k ? 'on' : ''}
          data-act="minemode"
          data-v=${k}
          role="radio"
          aria-checked=${come === k ? 'true' : 'false'}
        >
          ${nome}
        </button>`,
    )}
  </div>`;
  const mie = ordina(
    pezzi.filter(p => possedute.has(p.key)),
    come,
  );
  if (!mie.length)
    return html`${scelta}
      <div class="empty">
        Qui trovi solo le monete che hai, divise per taglio, per paese o per anno.<br />Per segnarle tocca un anno nel
        Catalogo o in Cerca.
      </div>`;
  const gruppi = raggruppa(mie, come);
  const diverse = new Set(mie.map(p => p.t.id)).size;
  const [uno, tanti] = NOMI_GRUPPI[come];
  const sezioni = gruppi.map(
    (g, i) =>
      html`<div class="sec">${g.titolo} <span class="secn" data-gnum=${i}>· ${numero(g.n)}</span></div>
        <div class="card plist" data-gruppo=${i}>
          ${[...g.tipi].map(([id, ps]) => {
            const t = tipoPerId[id];
            return t ? rigaTipoConPezzi(t, ps, come) : null;
          })}
        </div>`,
  );
  return html`${scelta}
    <div class="minehead">
      <b data-minetot>${numero(mie.length)}</b> ${mie.length === 1 ? 'moneta' : 'monete'}
      <span class="muted"
        >· ${numero(diverse)} ${diverse === 1 ? 'tipo' : 'tipi'} diversi · ${numero(gruppi.length)}
        ${gruppi.length === 1 ? uno : tanti}</span
      >
    </div>
    ${sezioniPigre(sezioni, 3)}`;
}
