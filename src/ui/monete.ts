import { html, nothing, svg, type TemplateResult } from 'lit-html';
import { indirizzoFoto } from '../catalogo/dati';
import { tipi } from '../catalogo/indice';
import type { CodiceTaglio, Faccia, Tipo } from '../catalogo/tipi';
import { TAGLIO } from '../core/costanti';

type TipoDisegnabile = Pick<Tipo, 'denom' | 'cc' | 'commem' | 'from'>;

const INCHIOSTRO = 'rgba(45,32,12,.55)';
const CARATTERE = 'system-ui,sans-serif';

/** Moneta disegnata (al posto della foto, finché la foto non è pronta o se la BCE non l'ha pubblicata). */
export function disegnoMoneta(t: TipoDisegnabile, faccia: Faccia, misura: number): TemplateResult {
  const d = TAGLIO[t.denom];
  let esterno: string = d.metal;
  let interno: string | null = null;
  if (d.metal === 'bi1') [esterno, interno] = ['au', 'ag'];
  if (d.metal === 'bi2') [esterno, interno] = ['ag', 'au'];
  let contenuto;
  if (faccia === 'common') {
    contenuto = svg`<text x="50" y=${interno ? 55 : 56} text-anchor="middle" font-size=${d.num.length > 1 ? 30 : 36}
        font-weight="700" fill=${INCHIOSTRO} font-family=${CARATTERE}>${d.num}</text>
      <text x="50" y=${interno ? 69 : 72} text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1.5"
        fill=${INCHIOSTRO} font-family=${CARATTERE}>${d.unit}</text>`;
  } else {
    const stelle = Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      return svg`<circle cx=${(50 + 40 * Math.sin(a)).toFixed(1)} cy=${(50 - 40 * Math.cos(a)).toFixed(1)} r="2.1"
        fill=${INCHIOSTRO} />`;
    });
    contenuto = svg`${stelle}<text x="50" y=${t.commem ? 52 : 57} text-anchor="middle" font-size=${t.commem ? 17 : 20}
        font-weight="800" letter-spacing="1" fill=${INCHIOSTRO} font-family=${CARATTERE}>${t.cc}</text>
      ${
        t.commem
          ? svg`<text x="50" y="66" text-anchor="middle" font-size="9" font-weight="700" fill=${INCHIOSTRO}
              font-family=${CARATTERE}>${t.from}</text>`
          : nothing
      }`;
  }
  return html`<svg class="coin" viewBox="0 0 100 100" width=${misura} height=${misura} aria-hidden="true">
    <circle cx="50" cy="50" r="48" fill="url(#g-${esterno})" />
    <circle cx="50" cy="50" r="45.5" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="1" />
    ${
      interno
        ? svg`<circle cx="50" cy="50" r="31" fill="url(#g-${interno})" />
          <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(0,0,0,.14)" stroke-width="1" />`
        : nothing
    }
    ${contenuto}
  </svg>`;
}

export function fotoTipo(t: Pick<Tipo, 'img'>, faccia: Faccia): string {
  const nome = t.img?.[faccia === 'common' ? 1 : 0];
  return nome ? indirizzoFoto(nome) : '';
}

/** La foto si mostra (e il disegno sotto si nasconde) solo quando è pronta da disegnare: mai un cerchio vuoto. */
function fotoPronta(e: Event): void {
  const img = e.currentTarget as HTMLImageElement;
  const fatto = () => {
    img.classList.add('ok');
    img.parentElement?.classList.add('ld');
  };
  img.decode().then(fatto, fatto);
}

function fotoMancante(e: Event): void {
  (e.currentTarget as HTMLImageElement).remove();
}

export function moneta(t: Tipo, faccia: Faccia, misura: number): TemplateResult {
  const src = fotoTipo(t, faccia);
  return html`<span class="cwrap" style="width:${misura}px;height:${misura}px"
    >${disegnoMoneta(t, faccia, misura)}${
      src
        ? html`<img src=${src} alt="" loading="lazy" decoding="async" @load=${fotoPronta} @error=${fotoMancante} />`
        : nothing
    }</span
  >`;
}

/**
 * Icona di un taglio: la foto vera del lato comune (il "retro" uguale per tutti i paesi). Si prende una moneta
 * recente, così si vede il lato comune attuale (dal 2007); i commemorativi hanno il lato comune del 2 euro.
 */
function tipoConLatoComune(d: CodiceTaglio): Tipo | null {
  const conFoto = (t: Tipo) => !t.commem && t.denom === d && !!t.img?.[1];
  for (const cc of ['HR', 'LT', 'LV', 'EE', 'SK', 'MT']) {
    const t = tipi.find(x => x.cc === cc && conFoto(x));
    if (t) return t;
  }
  return tipi.find(conFoto) ?? null;
}

export function iconaTaglio(d: CodiceTaglio, misura: number): TemplateResult {
  const t = tipoConLatoComune(d);
  return t
    ? moneta(t, 'common', misura)
    : disegnoMoneta({ denom: d, cc: '', commem: false, from: 0 }, 'common', misura);
}
