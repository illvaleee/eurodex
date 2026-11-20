import { html, nothing, type TemplateResult } from 'lit-html';
import { schede } from '../catalogo/dati';
import {
  anni,
  bandiera,
  catalogo,
  nomePaese,
  ordinePaesi,
  paesi,
  pezzi,
  quandoCambiaIndice,
  tipoPerId,
} from '../catalogo/indice';
import { anni as anniTipo, nomeTipo, schedaDi, sottotitoloTipo } from '../catalogo/proprieta';
import type { CodiceTaglio, Pezzo, Tipo } from '../catalogo/tipi';
import { possedute, prefs } from '../collezione/stato';
import { TAGLI, TAGLIO } from '../core/costanti';
import { plurale } from '../core/formato';
import { chip, chipTipo, stella } from '../ui/componenti';
import { moneta } from '../ui/monete';
import { stato, type FiltriCerca } from '../ui/stato-ui';
import { sceltaOrdine } from './mancanti';
import { ordina } from './ordine';

export const normalizza = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PAROLE_TAGLIO: readonly [RegExp, CodiceTaglio][] = [
  [/^(1|uno)\s*(c|cent|centesimo|centesimi|ct)$/, '1c'],
  [/^2\s*(c|cent|centesimi|ct)$/, '2c'],
  [/^5\s*(c|cent|centesimi|ct)$/, '5c'],
  [/^10\s*(c|cent|centesimi|ct)$/, '10c'],
  [/^20\s*(c|cent|centesimi|ct)$/, '20c'],
  [/^50\s*(c|cent|centesimi|ct)$/, '50c'],
  [/^1\s*(€|e|euro)$/, '1e'],
  [/^2\s*(€|e|euro)$/, '2e'],
];

export interface Domanda {
  cc: string | null;
  y: number | null;
  d: CodiceTaglio | null;
  comm: boolean;
  parole: string[];
}

/** Capisce una ricerca scritta liberamente: "Italia 2€ 2015", "galileo", "2 euro grecia". */
export function interpreta(q: string): Domanda {
  let resto = ` ${normalizza(q).replace(/(\d)\s+(c|cent|centesimi|ct|€|e|euro)\b/g, '$1$2')} `;
  const out: Domanda = { cc: null, y: null, d: null, comm: false, parole: [] };
  const anno = /\b(19|20)\d{2}\b/.exec(resto);
  if (anno) {
    out.y = Number(anno[0]);
    resto = resto.replace(anno[0], ' ');
  }
  for (const parola of resto.split(/\s+/).filter(Boolean)) {
    const taglio = PAROLE_TAGLIO.find(([re]) => re.test(parola));
    if (taglio && !out.d) {
      out.d = taglio[1];
      continue;
    }
    const cc = ordinePaesi.find(
      c => normalizza(nomePaese(c)) === parola || (parola.length === 2 && c.toLowerCase() === parola),
    );
    if (cc && !out.cc) {
      out.cc = cc;
      continue;
    }
    if (parola === 'commemorativo' || parola === 'commemorativi' || parola === 'comm') {
      out.comm = true;
      continue;
    }
    if (parola.length >= 2) out.parole.push(parola);
  }
  return out;
}

const testi = new Map<string, { s: string; completo: boolean }>();
quandoCambiaIndice(() => {
  testi.clear();
});

/** Tutto il testo di una moneta in cui cercare (nome, tema, paese, serie, ricorrenza, parole chiave…). */
function testoTipo(t: Tipo): string {
  const c = testi.get(t.id);
  if (c && (!schede || c.completo)) return c.s;
  const d = schedaDi(t);
  const s = normalizza(
    [
      t.title,
      t.design,
      nomePaese(t.cc),
      d?.se,
      d?.ct,
      d?.tg?.join(' '),
      d?.ob?.a,
      t.di != null ? catalogo?.ds?.[t.di] : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  testi.set(t.id, { s, completo: !!schede });
  return s;
}

/** "Ce l'ho?": paese, anno e taglio, e la risposta subito. */
function celHo(): TemplateResult {
  const q = stato.qc;
  const anniPaese = q.cc
    ? [...new Set(pezzi.filter(p => p.t.cc === q.cc).map(p => p.y))].sort((a, b) => b - a)
    : [...anni].reverse();
  const scelta = (k: 'cc' | 'y' | 'd', opzioni: [string | number, string][], titolo: string) =>
    html`<select data-qc=${k} aria-label=${titolo}>
      <option value="">${titolo}</option>
      ${opzioni.map(([v, nome]) => html`<option value=${v} ?selected=${q[k] === String(v)}>${nome}</option>`)}
    </select>`;
  let risposta: TemplateResult | typeof nothing = nothing;
  if (q.cc && q.y && q.d) {
    const ps = pezzi.filter(
      p => p.t.cc === q.cc && p.y === Number(q.y) && (q.d === 'comm' ? p.t.commem : p.t.denom === q.d && !p.t.commem),
    );
    risposta = ps.length
      ? html`${ps.map(
          p =>
            html`<div class="qres ${possedute.has(p.key) ? 'yes' : 'no'}" data-qk=${p.key}>
              <button class="coinbtn" data-detail=${p.t.id} aria-label="Dettagli: ${nomeTipo(p.t)}">
                ${moneta(p.t, 'nat', 44)}
              </button>
              <div class="grow">
                <b>${possedute.has(p.key) ? "Ce l'hai ✓" : 'Ti manca'}</b
                ><span
                  >${p.t.commem ? p.t.design || p.t.title : TAGLIO[p.t.denom].label}${p.m ? ` · ${p.m}` : ''}${
                    p.proof ? ' · proof' : ''
                  }</span
                >
              </div>
              ${chip(p, '', 'chk')}
            </div>`,
        )}`
      : html`<div class="qres none">Questa moneta non esiste nel catalogo.</div>`;
  }
  return html`<div class="card qc">
    <h3>Ce l'ho?</h3>
    <div class="qsel">
      ${scelta(
        'cc',
        ordinePaesi.map(cc => [cc, `${bandiera(cc)} ${nomePaese(cc)}`]),
        'Paese',
      )}
      ${scelta(
        'y',
        anniPaese.map(y => [y, String(y)]),
        'Anno',
      )}
      ${scelta('d', [...TAGLI.map(d => [d.k, d.short] as [string, string]), ['comm', '2€ comm.']], 'Taglio')}
    </div>
    ${risposta}
  </div>`;
}

const filtro = (chiave: keyof Pick<FiltriCerca, 'cc' | 'denom' | 'stato' | 'tipo'>, valore: string, nome: string) =>
  html`<button
    class="fchip${stato.ex[chiave] === valore ? ' on' : ''}"
    data-act="ex"
    data-f=${chiave}
    data-v=${valore}
    role="radio"
    aria-checked=${stato.ex[chiave] === valore ? 'true' : 'false'}
  >
    <span class="cv">${nome}</span>
  </button>`;

export function vistaCerca(): TemplateResult {
  const f = stato.ex;
  const come = prefs.sortSearch;
  const dq = interpreta(f.q);
  const primo = anni[0] ?? 1999;
  const ultimo = anni[anni.length - 1] ?? new Date().getFullYear();
  const da = Math.max(f.from, primo);
  const a = Math.min(f.to, ultimo);
  const sceltaAnno = (sel: number, campo: 'from' | 'to', nome: string) =>
    html`<select data-exsel=${campo} aria-label=${nome}>
      ${anni.map(y => html`<option value=${y} ?selected=${y === sel}>${y}</option>`)}
    </select>`;
  const filtriAttivi = f.cc !== 'all' || f.denom !== 'all' || f.stato !== 'all' || f.tipo !== 'all';
  const attiva = !!f.q.trim() || filtriAttivi || da > primo || a < ultimo;
  let risultati: Pezzo[] = [];
  if (attiva) {
    risultati = ordina(
      pezzi.filter(
        p =>
          (f.cc === 'all' || p.t.cc === f.cc) &&
          (!dq.cc || p.t.cc === dq.cc) &&
          (f.denom === 'all' || p.t.denom === f.denom) &&
          (!dq.d || p.t.denom === dq.d) &&
          (!dq.comm || p.t.commem) &&
          p.y >= da &&
          p.y <= a &&
          (!dq.y || p.y === dq.y) &&
          (f.tipo === 'all' || (f.tipo === 'com') === p.t.commem) &&
          (f.stato === 'all' || (f.stato === 'own') === possedute.has(p.key)) &&
          (!dq.parole.length || dq.parole.every(w => testoTipo(p.t).includes(w))),
      ),
      come,
    );
  }
  const perTipo = new Map<string, Pezzo[]>();
  for (const p of risultati) perTipo.set(p.t.id, [...(perTipo.get(p.t.id) ?? []), p]);
  const gruppi = [...perTipo];
  const mancano = risultati.filter(p => !possedute.has(p.key)).length;
  return html`
    ${celHo()}
    <input
      class="search"
      type="search"
      placeholder="Cerca: Galileo, Italia 2005, 2 euro Grecia…"
      aria-label="Cerca nel catalogo"
      .value=${f.q}
      data-exq
    />
    <details class="fbox" ?open=${filtriAttivi}>
      <summary>Filtri</summary>
      <div class="flt">
        <div class="fl" id="fl-paese">Paese</div>
        <div class="hscroll" role="radiogroup" aria-labelledby="fl-paese">
          ${filtro('cc', 'all', 'Tutti')}${ordinePaesi.map(cc => filtro('cc', cc, `${paesi[cc]?.flag ?? ''} ${nomePaese(cc)}`))}
        </div>
      </div>
      <div class="flt">
        <div class="fl" id="fl-taglio">Taglio</div>
        <div class="hscroll" role="radiogroup" aria-labelledby="fl-taglio">
          ${filtro('denom', 'all', 'Tutti')}${TAGLI.map(d => filtro('denom', d.k, d.short))}
        </div>
      </div>
      <div class="flt">
        <div class="fl">Anni</div>
        <div class="years">
          ${sceltaAnno(da, 'from', 'Dal')}<span class="muted" aria-hidden="true">→</span>${sceltaAnno(a, 'to', 'Al')}
        </div>
      </div>
      <div class="flt">
        <div class="fl" id="fl-tipo">Tipo</div>
        <div class="hscroll" role="radiogroup" aria-labelledby="fl-tipo">
          ${filtro('tipo', 'all', 'Tutte')}${filtro('tipo', 'circ', 'Circolazione')}${filtro('tipo', 'com', 'Commemorative')}
        </div>
      </div>
      <div class="flt">
        <div class="fl" id="fl-stato">Stato</div>
        <div class="hscroll" role="radiogroup" aria-labelledby="fl-stato">
          ${filtro('stato', 'all', 'Tutte')}${filtro('stato', 'own', "Ce l'ho")}${filtro('stato', 'miss', 'Mancanti')}
        </div>
      </div>
    </details>
    ${
      attiva
        ? html`<div class="resh">
              <b>${plurale(risultati.length, 'moneta', 'monete')}</b>${sceltaOrdine('sortSearch')}
            </div>
            <div class="muted small" style="margin:-4px 2px 10px">${plurale(mancano, 'mancante', 'mancanti')}</div>
            ${
              gruppi.length
                ? gruppi.slice(0, f.limit).map(([id, ps]) => {
                    const t = tipoPerId[id];
                    if (!t) return nothing;
                    return html`<div class="xrow" data-lp="type:${t.id}">
                      <div class="row">
                        <button class="coinbtn" data-detail=${id} aria-label="Dettagli: ${nomeTipo(t)}">
                          ${moneta(t, 'nat', 40)}
                        </button>
                        <div class="tinfo">
                          <div class="tname">${bandiera(t.cc)} ${nomeTipo(t)}${stella(t)}</div>
                          <div class="tsub">
                            ${t.commem ? `2 euro commemorativo · ${anniTipo(t)}` : sottotitoloTipo(t)}
                          </div>
                        </div>
                      </div>
                      ${chipTipo(t, ps)}
                    </div>`;
                  })
                : html`<div class="empty">Nessuna moneta trovata.</div>`
            }
            ${
              gruppi.length > f.limit
                ? html`<button class="more" data-act="more">Mostra altre (${gruppi.length - f.limit})</button>`
                : nothing
            }`
        : html`<div class="note">
            Scrivi un tema, un paese, un anno o un taglio, anche insieme (es. "Italia 2€ 2015"), oppure usa i filtri.
          </div>`
    }
  `;
}
