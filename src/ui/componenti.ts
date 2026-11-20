import { html, nothing, type TemplateResult } from 'lit-html';
import { avanzamento, pezziDaMostrare, tipoDaMostrare } from '../catalogo/ambiti';
import { bandiera, nomePaese, paesi } from '../catalogo/indice';
import { anni, inArrivo, nomeTipo, pezzoNuovo, prezzo, raro, sottotitoloTipo, tipoNuovo } from '../catalogo/proprieta';
import type { Pezzo, Tipo } from '../catalogo/tipi';
import { possedute, preferite, prefs, type Ordinamento } from '../collezione/stato';
import { TAGLIO } from '../core/costanti';
import { euro, numero } from '../core/formato';
import { ICONA } from './icone';
import { moneta } from './monete';
import { stato } from './stato-ui';

/** Circonferenza dell'anello di avanzamento (raggio 52). */
export const CIRCONFERENZA = 2 * Math.PI * 52;

/** Pulsante di un pezzo: toccandolo si segna o si toglie dalla collezione. */
export function chip(p: Pezzo, etichetta: string, extra = ''): TemplateResult {
  const classi = [
    'chip',
    extra,
    p.proof ? 'pp' : '',
    possedute.has(p.key) ? 'on' : '',
    raro(p) ? 'rare' : '',
    pezzoNuovo(p) ? 'nw' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // nome completo per TalkBack ("2002 R", non solo "R": l'anno sta scritto a fianco, ma chi non vede non lo sa)
  const nome = `${p.y}${p.m ? ` ${p.m}` : ''}${p.proof ? ' proof' : ''}`;
  return html`<button
    class=${classi}
    data-key=${p.key}
    aria-pressed=${possedute.has(p.key) ? 'true' : 'false'}
    aria-label=${etichetta === nome ? nothing : nome}
    title=${raro(p) && p.mint != null ? `Tiratura ${numero(p.mint)}` : nothing}
  >
    <span class="cv">${etichetta}</span>
  </button>`;
}

export const barraMini = (ambito: string) =>
  html`<div class="mini" data-scope=${ambito}>
    <div class="bar"><i data-bar></i></div>
    <span class="count" data-c></span>
  </div>`;

export const barraAvanzamento = (ambito: string, stile = '') =>
  html`<div class="card slim${stile ? ` ${stile}` : ''}" data-scope=${ambito}>
    <div class="row">
      <div class="bar"><i data-bar></i></div>
      <span class="count" data-c></span>
    </div>
  </div>`;

export function chipAnno(ps: readonly Pezzo[]): TemplateResult {
  if (!ps.some(p => p.m))
    return html`<div class="ycol">
      <div class="chips">${ps.map(p => (p.proof ? chip(p, 'Proof', 'm') : chip(p, '', 'chk')))}</div>
    </div>`;
  const normali = ps.filter(p => !p.proof);
  const proof = ps.filter(p => p.proof);
  return html`<div class="ycol">
    ${
      normali.length
        ? html`<div class="chips">${normali.map(p => (p.m ? chip(p, p.m, 'm') : chip(p, '', 'chk')))}</div>`
        : nothing
    }
    ${
      proof.length
        ? html`<div class="chips pprow">
            <span class="pplab">Proof</span>${proof.map(p => chip(p, p.m || 'PP', 'm'))}
          </div>`
        : nothing
    }
  </div>`;
}

export function chipTipo(t: Tipo, lista?: readonly Pezzo[], tutti = false): TemplateResult {
  const ps = tutti ? (lista ?? t.pieces) : pezziDaMostrare(lista ?? t.pieces);
  if (!ps.length) return html`<div class="muted small">Le hai tutte ✓</div>`;
  if (!ps.some(p => p.m))
    return html`<div class="chips">${ps.map(p => chip(p, p.proof ? `${p.y} PP` : `${p.y}`))}</div>`;
  const perAnno = new Map<number, Pezzo[]>();
  for (const p of ps) perAnno.set(p.y, [...(perAnno.get(p.y) ?? []), p]);
  return html`${[...perAnno].map(
    ([y, l]) => html`<div class="yrow"><span class="ylab">${y}</span>${chipAnno(l)}</div>`,
  )}`;
}

export const stella = (t: Tipo) =>
  preferite.has(t.id) ? html`<span class="star" aria-label="preferita">★</span>` : nothing;

const distintivi = (t: Tipo) => html`${stella(t)}${tipoNuovo(t) ? html`<span class="badge nb">nuova</span>` : nothing}`;

/** Scheda di un tipo in elenco: si apre per vedere i pezzi (anni, zecche). */
export function schedaTipo(t: Tipo, lista?: readonly Pezzo[]): TemplateResult {
  const id = t.id + (lista?.[0] ? `@${lista[0].y}` : '');
  const aperta = stato.aperte.has(id);
  return html`<div class="tcard${aperta ? ' open' : ''}" data-card=${id} data-lp="type:${t.id}">
    <div class="thead" data-toggle=${id}>
      <button class="coinbtn" data-detail=${t.id} aria-label="Dettagli: ${nomeTipo(t)}">${moneta(t, 'nat', 52)}</button>
      <div class="tinfo" role="button" tabindex="0" aria-expanded=${aperta ? 'true' : 'false'}>
        <div class="tname">
          ${nomeTipo(t)}${distintivi(t)}${
            inArrivo(t) ? html`<span class="badge">${t.pf ? 'foto in arrivo' : 'foto provvisoria'}</span>` : nothing
          }
        </div>
        <div class="tsub">${t.commem ? `${nomePaese(t.cc)} · ${anni(t)}` : sottotitoloTipo(t)}</div>
        ${barraMini(`type:${t.id}`)}
      </div>
      <span class="chev" aria-hidden="true">›</span>
    </div>
    <div class="tbody">${aperta ? chipTipo(t, lista) : nothing}</div>
  </div>`;
}

export function casellaAlbum(t: Tipo, etichetta?: string): TemplateResult {
  const [o, n] = avanzamento(t.pieces);
  const classe = o === n ? 'all' : o ? 'part' : 'none';
  return html`<button class="atile ${classe}" data-detail=${t.id} data-lp="type:${t.id}">
    ${moneta(t, 'nat', 74)}${
      o === n ? html`<span class="aok">✓</span>` : o ? html`<span class="apart">${o}/${n}</span>` : nothing
    }
    <span class="alab">${etichetta ?? (t.commem ? t.design || t.title : TAGLIO[t.denom].short)}</span>
  </button>`;
}

export const vuotoTutto = () =>
  html`<div class="empty">${prefs.onlyMissing ? 'Nessuna moneta mancante qui 🎉' : 'Nessuna moneta.'}</div>`;

export function album(ts: readonly Tipo[], etichetta?: (t: Tipo) => string): TemplateResult {
  const visibili = ts.filter(tipoDaMostrare);
  if (!visibili.length) return vuotoTutto();
  return html`<div class="album">${visibili.map(t => casellaAlbum(t, etichetta?.(t)))}</div>`;
}

export const sceltaVista = () =>
  html`<div class="vsw" role="radiogroup" aria-label="Vista">
    <button
      class=${prefs.album ? '' : 'on'}
      data-act="album"
      data-v="0"
      aria-label="Elenco"
      role="radio"
      aria-checked=${prefs.album ? 'false' : 'true'}
    >
      ${ICONA.list}
    </button>
    <button
      class=${prefs.album ? 'on' : ''}
      data-act="album"
      data-v="1"
      aria-label="Album"
      role="radio"
      aria-checked=${prefs.album ? 'true' : 'false'}
    >
      ${ICONA.grid}
    </button>
  </div>`;

export function rigaPaese(cc: string): TemplateResult {
  const p = paesi[cc];
  return html`<button class="li" data-act="go" data-v="country" data-cc=${cc} data-lp="cc:${cc}">
    <span class="flag" aria-hidden="true">${p?.flag}</span>
    <div class="grow" data-scope="cc:${cc}">
      <div class="name">${nomePaese(cc)}</div>
      <div class="sub">
        <div class="bar"><i data-bar></i></div>
        <span class="count" data-c></span>
      </div>
    </div>
    <span class="chev" aria-hidden="true">›</span>
  </button>`;
}

/** Riga di un commemorativo (o di una moneta con un solo pezzo): foto, nome, paese e pezzi da segnare. */
export function rigaCommemorativo(t: Tipo): TemplateResult {
  const ps = pezziDaMostrare(t.pieces);
  const unico = t.pieces.length === 1 && t.pieces[0] && !t.pieces[0].m && !t.pieces[0].proof ? t.pieces[0] : null;
  return html`<div class="card crow1" data-lp="type:${t.id}">
    <button class="coinbtn" data-detail=${t.id} aria-label="Dettagli: ${t.design || t.title}">
      ${moneta(t, 'nat', 48)}
    </button>
    <div class="grow">
      <div data-detail=${t.id}>
        <div class="ct">${t.design || t.title}${distintivi(t)}</div>
        <div class="cs">${bandiera(t.cc)} ${nomePaese(t.cc)}${t.ev ? ` · ${t.ev}` : ''}</div>
      </div>
      ${
        unico
          ? nothing
          : html`<div style="margin-top:8px">
              ${ps.length ? chipTipo(t) : html`<span class="muted small">Le hai tutte ✓</span>`}
            </div>`
      }
    </div>
    ${unico ? chip(unico, '', 'chk') : nothing}
  </div>`;
}

/** Riga di una moneta con i suoi pezzi (mancanti, varianti, le mie). */
export function rigaTipoConPezzi(t: Tipo, ps: readonly Pezzo[], come: Ordinamento | 'paese'): TemplateResult {
  const etichetta = (p: Pezzo) =>
    `${come === 'anno' ? '' : p.y}${p.m ? (come === 'anno' ? '' : ' ') + p.m : ''}${p.proof ? ' PP' : ''}`.trim();
  const dove = come !== 'paese' ? `${bandiera(t.cc)} ${nomePaese(t.cc)}` : '';
  const sotto = [dove, t.commem ? (come === 'paese' ? anni(t) : '') : t.design].filter(Boolean).join(' · ');
  return html`<div class="mrow" data-lp="type:${t.id}">
    <button class="coinbtn" data-detail=${t.id} aria-label="Dettagli: ${nomeTipo(t)}">${moneta(t, 'nat', 40)}</button>
    <div class="grow">
      <div data-detail=${t.id}>
        <div class="ct1">${nomeTipo(t)}</div>
        <div class="cs1">${sotto}</div>
      </div>
      <div class="chips">${ps.map(p => (etichetta(p) ? chip(p, etichetta(p)) : chip(p, '', 'chk')))}</div>
    </div>
  </div>`;
}

/** Riga di un singolo pezzo (elenchi "più rare" e "valore"). */
export function rigaPezzo(p: Pezzo, come: Ordinamento): TemplateResult {
  const t = p.t;
  const pr = prezzo(p);
  const info = [
    come !== 'paese' ? `${bandiera(t.cc)} ${nomePaese(t.cc)}` : '',
    p.mint != null ? `tiratura ${numero(p.mint)}` : '',
    pr != null ? `FDC ${euro(pr)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return html`<div class="prow">
    <button class="coinbtn" data-detail=${t.id} aria-label="Dettagli: ${nomeTipo(t)}">${moneta(t, 'nat', 40)}</button>
    <div class="grow" data-detail=${t.id}>
      <div class="ct">
        ${
          t.commem
            ? t.design || t.title
            : html`${TAGLIO[t.denom].label}${t.design ? html` <span class="muted">· ${t.design}</span>` : nothing}`
        }
      </div>
      <div class="cs">
        ${p.y}${p.m ? ` · ${p.m}` : ''}${p.proof ? ' · proof' : ''}${
          raro(p) ? html` · <b class="rr">rara</b>` : nothing
        }${info ? ` · ${info}` : ''}
      </div>
    </div>
    ${chip(p, '', 'chk')}
  </div>`;
}

/** Riga di intestazione con l'avanzamento di un gruppo e lo scambio elenco/album. */
export const testataConVista = (ambito: string) =>
  html`<div class="rowsw">
    <div class="card slim grow" data-scope=${ambito} style="margin:0">
      <div class="row">
        <div class="bar"><i data-bar></i></div>
        <span class="count" data-c></span>
      </div>
    </div>
    ${sceltaVista()}
  </div>`;
