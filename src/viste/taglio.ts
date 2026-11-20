import { html, nothing, type TemplateResult } from 'lit-html';
import { tipoDaMostrare } from '../catalogo/ambiti';
import { bandiera, nomePaese, ordinePaesi, tipi } from '../catalogo/indice';
import { anni } from '../catalogo/proprieta';
import { prefs } from '../collezione/stato';
import { album, schedaTipo, testataConVista } from '../ui/componenti';

export function vistaTaglio(d: string): TemplateResult {
  const sezioni = ordinePaesi.map(cc => {
    const ts = tipi.filter(t => t.cc === cc && t.denom === d && !t.commem).filter(tipoDaMostrare);
    if (!ts.length) return nothing;
    return html`<div class="sec secflag" data-scope="ccd:${cc}/${d}">
        <span>${bandiera(cc)} ${nomePaese(cc)}</span><span class="count" data-c></span>
      </div>
      ${prefs.album ? album(ts, t => `${t.design || ''} ${anni(t)}`) : ts.map(t => schedaTipo(t))}`;
  });
  return html`${testataConVista(`denom:${d}`)}${sezioni}`;
}
