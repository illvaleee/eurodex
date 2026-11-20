import { html, nothing, type TemplateResult } from 'lit-html';
import { bandiera, nomePaese, ordinePaesi, pezzi, tipoPerId } from '../catalogo/indice';
import { raro } from '../catalogo/proprieta';
import type { Pezzo } from '../catalogo/tipi';
import { possedute, prefs } from '../collezione/stato';
import { TAGLI, TAGLIO } from '../core/costanti';
import { numero, plurale } from '../core/formato';
import { rigaPezzo, rigaTipoConPezzi } from '../ui/componenti';
import { ICONA } from '../ui/icone';
import { stato, type FiltriMancanti } from '../ui/stato-ui';
import { ORDINAMENTI, ordina, raggruppa } from './ordine';

function perTipo(p: Pezzo, tipo: FiltriMancanti['tipo']): boolean {
  switch (tipo) {
    case 'all':
      return true;
    case 'rare':
      return raro(p);
    case 'proof':
      return p.proof;
    case 'noproof':
      return !p.proof;
  }
}

export function mancantiFiltrate(): Pezzo[] {
  const f = stato.miss;
  return pezzi.filter(
    p =>
      !possedute.has(p.key) &&
      (f.cc === 'all' || p.t.cc === f.cc) &&
      (f.denom === 'all' || (f.denom === 'comm' ? p.t.commem : p.t.denom === f.denom && !p.t.commem)) &&
      perTipo(p, f.tipo),
  );
}

const filtro = (chiave: keyof Omit<FiltriMancanti, 'limit'>, valore: string, nome: string) =>
  html`<button
    class="fchip${stato.miss[chiave] === valore ? ' on' : ''}"
    data-act="miss"
    data-f=${chiave}
    data-v=${valore}
    role="radio"
    aria-checked=${stato.miss[chiave] === valore ? 'true' : 'false'}
  >
    <span class="cv">${nome}</span>
  </button>`;

export const sceltaOrdine = (chiave: 'sortMiss' | 'sortSearch') =>
  html`<select class="sortsel" data-sort=${chiave} aria-label="Ordina">
    ${ORDINAMENTI.map(
      ([k, nome]) => html`<option value=${k} ?selected=${prefs[chiave] === k}>Ordina: ${nome}</option>`,
    )}
  </select>`;

export function vistaMancanti(): TemplateResult {
  const f = stato.miss;
  const come = prefs.sortMiss;
  const tutte = ordina(mancantiFiltrate(), come);
  const testa = html`
    <div class="flt">
      <div class="hscroll" role="radiogroup" aria-label="Paese">
        ${filtro('cc', 'all', 'Tutti i paesi')}${ordinePaesi.map(cc => filtro('cc', cc, `${bandiera(cc)} ${nomePaese(cc)}`))}
      </div>
    </div>
    <div class="flt">
      <div class="hscroll" role="radiogroup" aria-label="Taglio">
        ${filtro('denom', 'all', 'Tutti i tagli')}${TAGLI.map(d => filtro('denom', d.k, d.short))}${filtro(
          'denom',
          'comm',
          '2€ comm.',
        )}
      </div>
    </div>
    <div class="flt">
      <div class="hscroll" role="radiogroup" aria-label="Tipo">
        ${filtro('tipo', 'all', 'Tutte')}${prefs.noProof ? nothing : filtro('tipo', 'noproof', 'Senza proof')}${filtro(
          'tipo',
          'rare',
          'Solo rare',
        )}${prefs.noProof ? nothing : filtro('tipo', 'proof', 'Solo proof')}
      </div>
    </div>
    <div class="resh">
      <b data-misscount>${plurale(tutte.length, 'mancante', 'mancanti')}</b>${sceltaOrdine('sortMiss')}
    </div>
    <div class="actions2">
      <button class="btn sm" data-act="sharemiss">${ICONA.share} Condividi la lista</button
      ><button class="btn sm sec2" data-act="exportmiss">${ICONA.down} CSV / stampa</button>
    </div>
  `;
  if (!tutte.length)
    return html`${testa}
      <div class="empty">
        ${
          possedute.size
            ? 'Non ti manca niente con questi filtri 🎉'
            : 'Segna le monete che hai: qui restano quelle che ti mancano.'
        }
      </div>`;
  // "più rare" e "valore" come elenco unico; gli altri raggruppati per moneta, con i pezzi che mancano
  if (come === 'rari' || come === 'valore')
    return html`${testa}
      <div class="card plist">${tutte.slice(0, f.limit).map(p => rigaPezzo(p, come))}</div>
      ${
        tutte.length > f.limit
          ? html`<button class="more" data-act="missmore">Mostra altre (${numero(tutte.length - f.limit)})</button>`
          : nothing
      }`;
  const gruppi = raggruppa(tutte, come);
  let righe = 0;
  const sezioni: TemplateResult[] = [];
  for (const g of gruppi) {
    if (righe >= f.limit) break;
    const dentro: TemplateResult[] = [];
    for (const [id, ps] of g.tipi) {
      const t = tipoPerId[id];
      if (righe++ >= f.limit) break;
      if (t) dentro.push(rigaTipoConPezzi(t, ps, come));
    }
    sezioni.push(
      html`<div class="sec">${g.titolo}</div>
        <div class="card plist">${dentro}</div>`,
    );
  }
  const totale = gruppi.reduce((a, g) => a + g.tipi.size, 0);
  return html`${testa}${sezioni}
  ${
    totale > f.limit
      ? html`<button class="more" data-act="missmore">Mostra altre (${numero(totale - f.limit)} monete)</button>`
      : nothing
  }`;
}

/** Elenco delle mancanti da condividere come testo (WhatsApp, email…). */
export function testoMancanti(): string {
  const ps = ordina(mancantiFiltrate(), 'paese');
  const righe = [`Monete euro che mi mancano (${ps.length})`, ''];
  let cc: string | null = null;
  for (const p of ps) {
    if (p.t.cc !== cc) {
      cc = p.t.cc;
      righe.push('', `${bandiera(cc)} ${nomePaese(cc)}`);
    }
    righe.push(
      `• ${p.t.commem ? `2€ ${p.t.design || p.t.title}` : TAGLIO[p.t.denom].label} ${p.y}${p.m ? ` ${p.m}` : ''}${p.proof ? ' (proof)' : ''}`,
    );
  }
  return righe.join('\n').replace(/\n{3,}/g, '\n\n');
}
