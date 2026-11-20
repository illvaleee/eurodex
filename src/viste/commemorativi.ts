import { html, type TemplateResult } from 'lit-html';
import { elenco, tipoDaMostrare } from '../catalogo/ambiti';
import { bandiera, nomePaese, tipi } from '../catalogo/indice';
import { prefs } from '../collezione/stato';
import { numero } from '../core/formato';
import { album, barraAvanzamento, rigaCommemorativo, testataConVista, vuotoTutto } from '../ui/componenti';

/** Commemorativi: prima si sceglie l'anno (griglia con quante monete ci sono e quante ne hai), poi le monete. */
export function corpoCommemorativi(): TemplateResult {
  const com = tipi.filter(t => t.commem && tipoDaMostrare(t));
  const anni = [...new Set(com.map(t => t.from))].sort((a, b) => b - a);
  if (!anni.length) return vuotoTutto();
  return html`${barraAvanzamento('commem', 'mb12')}
    <div class="ygrid">
      ${anni.map(y => {
        const tot = elenco(`cyc:${y}`).length;
        return html`<button
          class="ycard"
          data-act="go"
          data-v="cy"
          data-y=${y}
          data-scope="cyc:${y}"
          data-lp="cyc:${y}"
        >
          <span class="ytop"><b class="yy">${y}</b><span class="ypc" data-p>0%</span></span
          ><span class="yl">${numero(tot)} ${tot === 1 ? 'moneta' : 'monete'}</span
          ><span class="yl"><b data-o>0</b> <span data-op>possedute</span></span>
          <div class="bar"><i data-bar></i></div>
        </button>`;
      })}
    </div>`;
}

export const vistaCommemorativi = corpoCommemorativi;

export function vistaCommemorativiAnno(y: number): TemplateResult {
  const visibili = tipi
    .filter(t => t.commem && t.from === y && tipoDaMostrare(t))
    .sort((a, b) => nomePaese(a.cc).localeCompare(nomePaese(b.cc), 'it'));
  if (!visibili.length) return vuotoTutto();
  return html`${testataConVista(`cyc:${y}`)}
  ${prefs.album ? album(visibili, t => `${bandiera(t.cc)} ${t.design || ''}`) : visibili.map(rigaCommemorativo)}`;
}
