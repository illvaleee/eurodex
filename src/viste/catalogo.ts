import { html, type TemplateResult } from 'lit-html';
import { avanzamento, elenco } from '../catalogo/ambiti';
import { anni, ordinePaesi } from '../catalogo/indice';
import { prefs, type ModoCatalogo } from '../collezione/stato';
import { TAGLI } from '../core/costanti';
import { rigaPaese, vuotoTutto } from '../ui/componenti';
import { vistaMappa } from '../ui/mappa';
import { iconaTaglio } from '../ui/monete';
import { corpoCommemorativi } from './commemorativi';

const MODI: readonly [ModoCatalogo, string][] = [
  ['paesi', 'Paesi'],
  ['anni', 'Anni'],
  ['tagli', 'Tagli'],
  ['comm', 'Comm.'],
];

function paesi(): TemplateResult {
  const righe = ordinePaesi
    .filter(cc => !prefs.onlyMissing || avanzamento(elenco(`cc:${cc}`))[0] < elenco(`cc:${cc}`).length)
    .map(rigaPaese);
  return html`<div class="rowsw">
      <div class="seg2" role="radiogroup" aria-label="Vista dei paesi">
        <button
          class=${prefs.paesiMap ? '' : 'on'}
          data-act="pmap"
          data-v="0"
          role="radio"
          aria-checked=${prefs.paesiMap ? 'false' : 'true'}
        >
          Elenco
        </button>
        <button
          class=${prefs.paesiMap ? 'on' : ''}
          data-act="pmap"
          data-v="1"
          role="radio"
          aria-checked=${prefs.paesiMap ? 'true' : 'false'}
        >
          Mappa
        </button>
      </div>
    </div>
    ${
      prefs.paesiMap
        ? vistaMappa()
        : html`<div class="card"><div class="list">${righe.length ? righe : vuotoTutto()}</div></div>`
    }`;
}

const perAnno = () =>
  html`<div class="card">
    <div class="list">
      ${[...anni].reverse().map(
        y =>
          html`<button class="li" data-act="go" data-v="year" data-y=${y} data-lp="year:${y}">
            <span class="yearbig">${y}</span>
            <div class="grow" data-scope="year:${y}">
              <div class="sub">
                <div class="bar"><i data-bar></i></div>
                <span class="count" data-c></span>
              </div>
            </div>
            <span class="chev" aria-hidden="true">›</span>
          </button>`,
      )}
    </div>
  </div>`;

const perTaglio = () =>
  html`<div class="card">
      <div class="list">
        ${TAGLI.map(
          d =>
            html`<button class="li" data-act="go" data-v="denom" data-d=${d.k}>
              ${iconaTaglio(d.k, 36)}
              <div class="grow" data-scope="denom:${d.k}">
                <div class="name">${d.label}</div>
                <div class="sub">
                  <div class="bar"><i data-bar></i></div>
                  <span class="count" data-c></span>
                </div>
              </div>
              <span class="chev" aria-hidden="true">›</span>
            </button>`,
        )}
      </div>
    </div>
    <div class="note">Solo monete di circolazione; i 2 euro commemorativi sono in "Comm.".</div>`;

export function vistaCatalogo(): TemplateResult {
  const m = prefs.catMode;
  const corpo = m === 'paesi' ? paesi() : m === 'anni' ? perAnno() : m === 'tagli' ? perTaglio() : corpoCommemorativi();
  return html`<div class="seg" role="radiogroup" aria-label="Catalogo per">
      ${MODI.map(
        ([k, nome]) =>
          html`<button
            class=${m === k ? 'on' : ''}
            data-act="catmode"
            data-v=${k}
            role="radio"
            aria-checked=${m === k ? 'true' : 'false'}
          >
            ${nome}
          </button>`,
      )}
    </div>
    ${corpo}`;
}
