import { html, nothing, type TemplateResult } from 'lit-html';
import { pezziDaMostrare, tipoDaMostrare } from '../catalogo/ambiti';
import { paesi, tipi } from '../catalogo/indice';
import { anni } from '../catalogo/proprieta';
import { prefs } from '../collezione/stato';
import { TAGLIO } from '../core/costanti';
import { album, barraMini, chipAnno, schedaTipo, sceltaVista, vuotoTutto } from '../ui/componenti';
import { moneta } from '../ui/monete';
import { stato } from '../ui/stato-ui';

/** Monete di circolazione di un paese in un anno, una riga per taglio. */
export function righeAnno(cc: string, y: number): TemplateResult {
  const righe = tipi
    .filter(t => t.cc === cc && !t.commem && t.pieces.some(p => p.y === y))
    .map(t => {
      const ps = pezziDaMostrare(t.pieces.filter(p => p.y === y));
      if (!ps.length) return null;
      return html`<div class="drow2">
        <span class="dl">${TAGLIO[t.denom].short}</span>${chipAnno(ps)}
        <button class="coinbtn" data-detail=${t.id} aria-label="Dettagli: ${TAGLIO[t.denom].label}">
          ${moneta(t, 'nat', 30)}
        </button>
      </div>`;
    })
    .filter(r => r !== null);
  return righe.length ? html`${righe}` : html`<div class="muted small">Le hai tutte ✓</div>`;
}

export function vistaPaese(cc: string): TemplateResult {
  const p = paesi[cc];
  const ts = tipi.filter(t => t.cc === cc);
  const circ = ts.filter(t => !t.commem);
  const com = ts.filter(t => t.commem).sort((a, b) => a.from - b.from);
  let corpo: TemplateResult;
  if (prefs.album)
    corpo =
      stato.countryMode === 'taglio'
        ? album(circ, t => TAGLIO[t.denom].short + (t.design ? ` · ${t.design}` : ''))
        : album(circ, t => `${TAGLIO[t.denom].short} ${anni(t)}`);
  else if (stato.countryMode === 'taglio') {
    const schede = circ.filter(tipoDaMostrare).map(t => schedaTipo(t));
    corpo = schede.length ? html`${schede}` : vuotoTutto();
  } else {
    const elencoAnni = [...new Set(circ.flatMap(t => pezziDaMostrare(t.pieces).map(x => x.y)))].sort((a, b) => b - a);
    corpo = elencoAnni.length
      ? html`${elencoAnni.map(y => {
          const id = `Y|${cc}|${y}`;
          const aperta = stato.aperte.has(id);
          return html`<div class="tcard${aperta ? ' open' : ''}" data-card=${id} data-lp="cyear:${cc}/${y}">
            <div class="thead" data-toggle=${id} role="button" tabindex="0" aria-expanded=${aperta ? 'true' : 'false'}>
              <div class="tinfo">
                <div class="tname" style="font-size:17px">${y}</div>
                ${barraMini(`cyear:${cc}/${y}`)}
              </div>
              <span class="chev" aria-hidden="true">›</span>
            </div>
            <div class="tbody">${aperta ? righeAnno(cc, y) : nothing}</div>
          </div>`;
        })}`
      : vuotoTutto();
  }
  const comVisibili = com.filter(tipoDaMostrare);
  const scelta = html`<div class="seg2" role="group" aria-label="Raggruppa">
    <button class=${stato.countryMode === 'taglio' ? 'on' : ''} data-act="mode" data-mode="taglio">Per taglio</button>
    <button class=${stato.countryMode === 'anno' ? 'on' : ''} data-act="mode" data-mode="anno">Per anno</button>
  </div>`;
  return html`
    <div class="card">
      <div class="chead" data-scope="cc:${cc}" data-lp="cc:${cc}">
        <span class="flag" aria-hidden="true">${p?.flag}</span>
        <div class="grow">
          <div class="stat">
            <b data-o>0</b> <span data-op>possedute</span> · <span data-miss>0</span> <span data-mp>mancanti</span>
          </div>
          <div class="row">
            <div class="bar"><i data-bar></i></div>
            <span class="count" style="min-width:40px" data-p>0%</span>
          </div>
        </div>
      </div>
    </div>
    ${circ.length ? html`<div class="rowsw">${scelta}${sceltaVista()}</div>` : sceltaVista()} ${corpo}
    ${
      com.length
        ? html`<div class="sec">2 euro commemorativi · ${com.length}</div>
            ${
              prefs.album
                ? album(com, t => `${t.from} · ${t.design || ''}`)
                : comVisibili.length
                  ? comVisibili.map(t => schedaTipo(t))
                  : vuotoTutto()
            }`
        : nothing
    }
  `;
}
