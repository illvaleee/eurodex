import { html, nothing, type TemplateResult } from 'lit-html';
import { avanzamento, elenco } from '../catalogo/ambiti';
import { bandiera, ordinePaesi, tipi } from '../catalogo/indice';
import { inArrivo } from '../catalogo/proprieta';
import { meta, possedute, preferite } from '../collezione/stato';
import { TAGLI, TAGLIO } from '../core/costanti';
import { giorniDa } from '../core/formato';
import { nativo } from '../nativo/plugin';
import { casellaAlbum, CIRCONFERENZA, rigaPaese } from '../ui/componenti';
import { ICONA } from '../ui/icone';
import { iconaTaglio } from '../ui/monete';
import { stato } from '../ui/stato-ui';
import { novitaCatalogo } from './elenchi';
import { schedaValore } from './valore';

function promemoriaBackup(): TemplateResult | typeof nothing {
  if (!possedute.size) return nothing;
  if (nativo() && meta.drive && !meta.driveErr) return nothing;
  if (meta.drive && meta.driveErr)
    return html`<button class="banner warn" data-act="settings">
      ${ICONA.warn}
      <div><b>Backup su Drive non riuscito</b><span>Tocca per ricollegare il file</span></div>
    </button>`;
  if (giorniDa(meta.lastExport || meta.created) < 14) return nothing;
  return html`<button class="banner" data-act="settings">
    ${ICONA.cloud}
    <div>
      <b>Metti al sicuro la collezione</b
      ><span>${nativo() ? 'Collega Google Drive: il backup si aggiorna da solo' : 'Fai un backup ogni tanto'}</span>
    </div>
  </button>`;
}

export function vistaCollezione(): TemplateResult {
  const novita = novitaCatalogo();
  const preferiti = tipi.filter(t => preferite.has(t.id));
  const inArrivoN = tipi.filter(inArrivo).length;
  const completati = ordinePaesi.filter(cc => {
    const [o, t] = avanzamento(elenco(`cc:${cc}`));
    return t && o === t;
  });
  return html`
    ${
      stato.update
        ? html`<button class="banner up" data-act="update">
            ${ICONA.down}
            <div><b>Nuova versione ${stato.update.version}</b><span>Tocca per aggiornare l'app</span></div>
          </button>`
        : nothing
    }
    ${promemoriaBackup()}
    <div class="card" data-scope="all">
      <div class="hero">
        <div class="ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="rbg" cx="60" cy="60" r="52" fill="none" stroke-width="10" />
            <circle
              class="rfg"
              data-ring
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke-width="10"
              stroke-dasharray=${CIRCONFERENZA}
              stroke-dashoffset=${CIRCONFERENZA}
            />
          </svg>
          <div class="rtxt"><b data-p>0%</b></div>
        </div>
        <div>
          <div class="big" data-o>0</div>
          <div class="lbl">monete in collezione</div>
          <div class="miss">Ne <span data-mv>mancano</span> <b data-miss>0</b></div>
          <button class="linkbtn" data-act="go" data-v="stats">Statistiche ›</button>
        </div>
      </div>
    </div>
    ${schedaValore()}
    ${
      novita.length
        ? html`<button class="card li2" data-act="go" data-v="news">
            <span class="ico nb">${ICONA.spark}</span>
            <div class="grow">
              <b>Novità</b
              ><span
                >${novita.length} ${novita.length === 1 ? 'moneta aggiunta' : 'monete aggiunte'} di recente al
                catalogo</span
              >
            </div>
            <span class="chev" aria-hidden="true">›</span>
          </button>`
        : nothing
    }
    ${
      preferiti.length
        ? html`<div class="card">
            <h3>Preferite <button class="h3link" data-act="go" data-v="favs">Tutte ›</button></h3>
            <div class="hrow">
              ${preferiti
                .slice(0, 12)
                .map(t => casellaAlbum(t, `${bandiera(t.cc)} ${t.commem ? t.from : TAGLIO[t.denom].short}`))}
            </div>
          </div>`
        : nothing
    }
    <div class="card">
      <h3>Per taglio</h3>
      ${TAGLI.map(
        d =>
          html`<button class="drow" data-act="go" data-v="denom" data-d=${d.k} data-scope="denom:${d.k}">
            ${iconaTaglio(d.k, 30)}
            <span class="dl">${d.short}</span>
            <div class="bar"><i data-bar></i></div>
            <span class="count" data-c></span>
          </button>`,
      )}
      <button class="drow" data-act="go" data-v="commem" data-scope="commem">
        ${iconaTaglio('2e', 30)}
        <span class="dl">Comm.</span>
        <div class="bar"><i data-bar></i></div>
        <span class="count" data-c></span>
      </button>
    </div>
    <div class="card">
      <h3>Paesi${completati.length ? ` · ${completati.length} completati` : ''}</h3>
      <div class="list">${ordinePaesi.map(rigaPaese)}</div>
    </div>
    ${
      inArrivoN
        ? html`<button class="card li2" data-act="go" data-v="soon">
            <span class="ico">${ICONA.clock}</span>
            <div class="grow">
              <b>In arrivo</b><span>${inArrivoN} monete annunciate, foto ufficiale non ancora pubblicata</span>
            </div>
            <span class="chev" aria-hidden="true">›</span>
          </button>`
        : nothing
    }
  `;
}
