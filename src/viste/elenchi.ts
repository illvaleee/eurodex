import { html, type TemplateResult } from 'lit-html';
import { tipoDaMostrare } from '../catalogo/ambiti';
import { bandiera, tipi } from '../catalogo/indice';
import { anni, nomeTipo, pezzoNuovo, sottotitoloTipo, tipoNuovo } from '../catalogo/proprieta';
import type { Pezzo, Tipo } from '../catalogo/tipi';
import { prefs } from '../collezione/stato';
import { TAGLIO } from '../core/costanti';
import { album, chipTipo, rigaCommemorativo, schedaTipo, sceltaVista } from '../ui/componenti';
import { moneta } from '../ui/monete';

/** Monete entrate da poco nel catalogo (o con anni e zecche nuove), dalla più recente. */
export function novitaCatalogo(): { t: Tipo; d: string; ps: Pezzo[] }[] {
  const out: { t: Tipo; d: string; ps: Pezzo[] }[] = [];
  for (const t of tipi) {
    if (tipoNuovo(t)) {
      out.push({ t, d: t.n, ps: t.pieces });
      continue;
    }
    const ps = t.pieces.filter(pezzoNuovo);
    if (ps.length)
      out.push({
        t,
        d:
          ps
            .map(p => p.n)
            .sort()
            .pop() ?? '',
        ps,
      });
  }
  return out.sort((a, b) => b.d.localeCompare(a.d));
}

export function vistaElenco(ts: readonly Tipo[], seVuoto: string): TemplateResult {
  const visibili = ts.filter(tipoDaMostrare);
  if (!visibili.length) return html`<div class="empty">${seVuoto}</div>`;
  return html`<div class="rowsw"><span></span>${sceltaVista()}</div>
    ${
      prefs.album
        ? album(visibili, t => `${bandiera(t.cc)} ${t.commem ? t.design || '' : `${TAGLIO[t.denom].short} ${anni(t)}`}`)
        : visibili.map(t => (t.commem ? rigaCommemorativo(t) : schedaTipo(t)))
    }`;
}

export function vistaNovita(): TemplateResult {
  const l = novitaCatalogo();
  if (!l.length)
    return html`<div class="empty">
      Nessuna novità negli ultimi mesi.<br /><span class="small"
        >Il catalogo si aggiorna da solo: le monete nuove compaiono qui.</span
      >
    </div>`;
  return html`${l.map(({ t, d, ps }) => {
    const intera = ps === t.pieces;
    return html`<div class="sec">
        ${new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
      <div class="card crow1" data-lp="type:${t.id}">
        <button class="coinbtn" data-detail=${t.id} aria-label="Dettagli: ${nomeTipo(t)}">
          ${moneta(t, 'nat', 48)}
        </button>
        <div class="grow">
          <div class="ct">${bandiera(t.cc)} ${nomeTipo(t)}</div>
          <div class="cs">
            ${intera ? 'Nuova moneta' : 'Nuovi anni/zecche'} · ${t.commem ? anni(t) : sottotitoloTipo(t)}
          </div>
          <div style="margin-top:8px">${chipTipo(t, ps)}</div>
        </div>
      </div>`;
  })}`;
}
