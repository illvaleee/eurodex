import { html, nothing, type TemplateResult } from 'lit-html';
import { elenco, tipoDaMostrare } from '../catalogo/ambiti';
import { bandiera, nomePaese, ordinePaesi, tipi } from '../catalogo/indice';
import { possedute, prefs } from '../collezione/stato';
import { TAGLIO } from '../core/costanti';
import { album, rigaCommemorativo, testataConVista } from '../ui/componenti';
import { righeAnno } from './paese';

export function vistaAnno(y: number): TemplateResult {
  const sezioni = ordinePaesi.map(cc => {
    const ts = tipi.filter(t => t.cc === cc && t.pieces.some(p => p.y === y));
    if (!ts.length) return nothing;
    if (prefs.onlyMissing && !elenco(`ccy:${cc}/${y}`).some(p => !possedute.has(p.key))) return nothing;
    const circ = ts.filter(t => !t.commem);
    const com = ts.filter(t => t.commem);
    return html`<div class="sec secflag" data-scope="ccy:${cc}/${y}" data-lp="ccy:${cc}/${y}">
        <span>${bandiera(cc)} ${nomePaese(cc)}</span><span class="count" data-c></span>
      </div>
      ${
        prefs.album
          ? album(ts, t => (t.commem ? t.design || '2€ comm.' : TAGLIO[t.denom].short))
          : html`${circ.length ? html`<div class="card" style="padding:6px 14px">${righeAnno(cc, y)}</div>` : nothing}
            ${com.filter(tipoDaMostrare).map(rigaCommemorativo)}`
      }`;
  });
  return html`${testataConVista(`year:${y}`)}${sezioni}`;
}
