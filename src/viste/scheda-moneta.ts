import { html, nothing, render, type TemplateResult } from 'lit-html';
import { caricaSchede, schede } from '../catalogo/dati';
import { bandiera, catalogo, nomePaese, tipoPerId } from '../catalogo/indice';
import { anni, inArrivo, raro, schedaDi, senzaFoto, sottotitoloTipo, titoloTipo } from '../catalogo/proprieta';
import type { Lato, Tipo } from '../catalogo/tipi';
import { note, possedute, preferite, prefs } from '../collezione/stato';
import { CONSERVAZIONE, CONSERVAZIONE_ESTESA, TAGLIO } from '../core/costanti';
import { $ } from '../core/dom';
import { euro, numero } from '../core/formato';
import { casellaAlbum, chip } from '../ui/componenti';
import { apriFoglio } from '../ui/foglio';
import { moneta } from '../ui/monete';

/** Pagina BCE della moneta: quella dell'anno solo se la BCE l'ha pubblicata (in italiano se c'è), altrimenti l'elenco. */
const BCE = 'https://www.ecb.europa.eu/euro/coins/';
const PAGINA_TAGLIO: Record<string, string> = {
  '1c': '1cent',
  '2c': '2cents',
  '5c': '5cents',
  '10c': '10cents',
  '20c': '20cents',
  '50c': '50cents',
  '1e': '1euro',
  '2e': '2euro',
};

function paginaBce(t: Tipo): string {
  if (!t.commem) return `${BCE}${PAGINA_TAGLIO[t.denom] ?? ''}/html/index.it.html`;
  const pagine = catalogo?.ecbPagine ?? { it: [], en: [] };
  if (pagine.it.includes(t.from)) return `${BCE}comm/html/comm_${t.from}.it.html`;
  if (pagine.en.includes(t.from)) return `${BCE}comm/html/comm_${t.from}.en.html`;
  return `${BCE}comm/html/index.it.html`;
}

let aperta: string | null = null;

const voce = (nome: string, valore: string | TemplateResult | null | undefined, classe = '') =>
  valore
    ? html`<dt>${nome}</dt>
        <dd class=${classe || nothing}>${valore}</dd>`
    : nothing;

function lato(titolo: string, l: Lato | undefined) {
  if (!l) return nothing;
  return html`<div class="sec">${titolo}</div>
    <dl class="specs">
      ${voce('Descrizione', l.d)}${voce('Scritte', l.l, 'pre')}${voce('Traduzione', l.lt)}${voce('Autore', l.a)}
    </dl>`;
}

function tabellaEmissioni(t: Tipo): TemplateResult {
  const info = schedaDi(t)?.pi ?? {};
  const conPrezzi = t.pieces.some(p => info[p.key]?.pr);
  return html`<div class="tblwrap">
    <table class="tbl">
      <thead>
        <tr>
          <th>Anno</th>
          <th>Zecca · note</th>
          <th class="r">Tiratura</th>
          ${conPrezzi ? html`<th class="r">FDC</th>` : nothing}
          <th class="c">Ce l'ho</th>
        </tr>
      </thead>
      <tbody>
        ${t.pieces.map(p => {
          const e = info[p.key] ?? {};
          const pr = e.pr ?? {};
          return html`<tr class=${possedute.has(p.key) ? 'own' : ''}>
            <td>${p.y}${p.proof ? html` <span class="pp1">PP</span>` : nothing}</td>
            <td>
              ${p.m || '—'}${e.c ? html`<div class="tnote">${e.c}</div>` : nothing}${
                e.v ? html`<div class="tnote">${e.v}</div>` : nothing
              }
            </td>
            <td class="r">
              ${p.mint != null ? numero(p.mint) : '—'}${raro(p) ? html`<div class="rr">rara</div>` : nothing}
            </td>
            ${
              conPrezzi
                ? html`<td class="r">${pr.unc != null ? euro(pr.unc) : pr.au != null ? euro(pr.au) : '—'}</td>`
                : nothing
            }
            <td class="c">${chip(p, '', 'chk sm')}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

function dettagli(t: Tipo): TemplateResult {
  const d = schedaDi(t) ?? {};
  const info = d.pi ?? {};
  const misura = (v: number | undefined, unita: string) => (v == null ? '' : `${String(v).replace('.', ',')} ${unita}`);
  const ps = t.pieces;
  const conPrezzi = ps.filter(p => info[p.key]?.pr);
  const gradi = (schede?.grades ?? []).filter(g => conPrezzi.some(p => info[p.key]?.pr?.[g] != null));
  const aggiornate = ps
    .map(p => info[p.key]?.pa)
    .filter((x): x is string => !!x)
    .sort()
    .pop();
  const collegati = (d.rl ?? []).map(id => tipoPerId[String(id)]).filter((x): x is Tipo => !!x);
  const allineamento = d.or === 'medal' ? 'medaglia (↑↑)' : d.or === 'coin' ? 'moneta (↑↓)' : (d.or ?? '');
  return html`
    ${
      conPrezzi.length
        ? html`<details class="more2">
            <summary>Valori stimati per conservazione</summary>
            <div class="tblwrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Anno</th>
                    ${gradi.map(g => html`<th class="r" title=${CONSERVAZIONE_ESTESA[g] ?? g}>${CONSERVAZIONE[g]}</th>`)}
                  </tr>
                </thead>
                <tbody>
                  ${conPrezzi.map(
                    p =>
                      html`<tr>
                        <td>${p.y}${p.m ? ` ${p.m}` : ''}${p.proof ? ' PP' : ''}</td>
                        ${gradi.map(g => {
                          const v = info[p.key]?.pr?.[g];
                          return html`<td class="r">${v != null ? euro(v) : '—'}</td>`;
                        })}
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>
            <div class="note">
              Stime Numista${aggiornate ? ` aggiornate a ${aggiornate.split('-').reverse().join('/')}` : ''}.
              ${gradi.map(g => `${CONSERVAZIONE[g] ?? g} = ${(CONSERVAZIONE_ESTESA[g] ?? g).toLowerCase()}`).join(' · ')}.
            </div>
          </details>`
        : html`<div class="note">Valori stimati: in arrivo con i prossimi aggiornamenti mensili.</div>`
    }
    <div class="sec">Caratteristiche</div>
    <dl class="specs">
      ${voce('Metallo', d.me)}${voce('Peso', misura(d.w, 'g'))}${voce('Diametro', misura(d.dia, 'mm'))}${voce(
        'Spessore',
        misura(d.th, 'mm'),
      )}${voce('Forma', d.sh)}${voce('Tecnica', d.tec)}${voce('Allineamento', allineamento)}${voce('Periodo', d.ru)}${voce(
        'Serie',
        d.se,
      )}${voce('Ricorrenza', d.ct)}${voce('Zecca', d.mi?.length ? d.mi.join(' · ') : '')}${voce('Emittente', d.ie)}${voce(
        'Fuori corso',
        d.dm,
      )}${voce('Riferimenti', d.rf ? `${d.rf} · N# ${t.nid}` : `N# ${t.nid}`)}
    </dl>
    ${lato(t.commem ? 'Lato commemorativo' : 'Lato nazionale', d.ob)} ${lato('Lato comune', d.rv)}
    ${lato('Bordo', d.ed)}
    ${d.tg?.length ? html`<div class="tags">${d.tg.map(x => html`<span>${x}</span>`)}</div>` : nothing}
    ${
      d.co
        ? html`<details class="more2">
            <summary>Note dal catalogo</summary>
            <p class="dtext pre">${d.co}</p>
          </details>`
        : nothing
    }
    ${
      collegati.length
        ? html`<div class="sec">Della stessa serie</div>
            <div class="hrow">
              ${collegati.map(r => casellaAlbum(r, `${r.from}${r.commem ? '' : ` ${TAGLIO[r.denom].short}`}`))}
            </div>`
        : nothing
    }
    <div class="links">
      <a class="ext" href="https://it.numista.com/${t.nid}" target="_blank" rel="noopener">Scheda su Numista ↗</a>
      <a class="ext" href=${paginaBce(t)} target="_blank" rel="noopener">Pagina BCE ↗</a>
    </div>
    <div class="credits">
      ${
        t.fn
          ? `Foto del lato nazionale: ${t.fc}, da Numista (la BCE non l'ha pubblicata). Lato comune: BCE / Commissione europea.`
          : `Immagini e descrizione ufficiale: Banca centrale europea${t.commem ? '' : ' · lato comune: BCE / Commissione europea'}.`
      }
      Dati tecnici, tirature e stime: Numista.
    </div>
  `;
}

export function apriScheda(id: string): void {
  const t = tipoPerId[id];
  if (!t) return;
  aperta = id;
  const nome = nomePaese(t.cc);
  const descrizione = t.di != null ? catalogo?.ds?.[t.di] : '';
  const preferita = preferite.has(id);
  const notaFoto = inArrivo(t)
    ? html`<div class="pfnote">
        ${
          t.pf
            ? 'Foto ufficiale non ancora pubblicata dalla BCE: arriverà da sola con un prossimo aggiornamento.'
            : 'Foto provvisoria presa da Numista: quella ufficiale della BCE non è ancora pubblicata e arriverà da sola con un prossimo aggiornamento.'
        }
      </div>`
    : senzaFoto(t)
      ? html`<div class="pfnote">
          La BCE non pubblica la foto di questa versione della moneta: qui è disegnata. Le differenze rispetto alle
          altre versioni sono descritte nella scheda qui sotto.
        </div>`
      : html`<div class="muted small center">Tocca una moneta per ingrandirla</div>`;
  apriFoglio(html`
    <div class="dhead">
      <div class="grow">
        <h2>${bandiera(t.cc)} ${t.commem ? t.design || t.title : `${titoloTipo(t)} · ${nome}`}</h2>
        <div class="muted">${t.commem ? `2 euro commemorativo · ${nome} · ${anni(t)}` : sottotitoloTipo(t)}</div>
      </div>
      <button
        class="starbtn${preferita ? ' on' : ''}"
        data-act="fav"
        data-id=${id}
        aria-label=${preferita ? 'Togli dalle preferite' : 'Aggiungi alle preferite'}
        aria-pressed=${preferita ? 'true' : 'false'}
      >
        ${preferita ? '★' : '☆'}
      </button>
    </div>
    <div class="coins2">
      <figure>
        <button data-act="zoom" data-id=${id} data-side="nat" aria-label="Ingrandisci il lato nazionale">
          ${moneta(t, 'nat', 128)}
        </button>
        <figcaption>${t.commem ? 'Lato commemorativo' : 'Lato nazionale'}</figcaption>
      </figure>
      <figure>
        <button data-act="zoom" data-id=${id} data-side="common" aria-label="Ingrandisci il lato comune">
          ${moneta(t, 'common', 128)}
        </button>
        <figcaption>Lato comune</figcaption>
      </figure>
    </div>
    ${notaFoto}
    <div data-scope="type:${t.id}" class="dprog">
      <div class="row">
        <div class="bar"><i data-bar></i></div>
        <span class="count" data-c></span>
      </div>
    </div>
    <div class="row gap">
      <button class="btn sm sec2" data-act="markall" data-id=${id} data-v="1">Segna tutte</button
      ><button class="btn sm sec2" data-act="markall" data-id=${id} data-v="0">Togli tutte</button>
    </div>
    ${
      descrizione
        ? html`<div class="sec">Descrizione ufficiale (BCE)</div>
            <p class="dtext">${descrizione}</p>`
        : nothing
    }
    ${
      t.ev || t.ed
        ? html`<dl class="specs">${voce('Tiratura ufficiale', t.ev)}${voce('Data di emissione', t.ed)}</dl>`
        : nothing
    }
    <div class="sec">Emissioni</div>
    <div id="emis"></div>
    ${
      prefs.noExtra !== false && t.extras.length
        ? html`<div class="sec">Varianti <span class="secn">· nella scheda Extra</span></div>
            <div class="chips" style="margin-bottom:14px">
              ${t.extras.map(p => chip(p, `${p.y} ${p.m}${p.proof ? ' PP' : ''}`, 'm'))}
            </div>`
        : nothing
    }
    <div id="detx"></div>
    <div class="sec">La tua nota</div>
    <textarea
      class="unote"
      data-note=${id}
      aria-label="La tua nota"
      placeholder="Scrivi una nota (dove l'hai presa, scambi, condizioni…)"
      .value=${note[id] ?? ''}
    ></textarea>
    <button class="btn sec2" data-act="close" style="margin-top:14px">Chiudi</button>
  `);
  // tabella e scheda completa hanno contenitori propri: si aggiornano quando arrivano i dati, senza ridisegnare il resto
  const disegna = (completa: boolean) => {
    const em = $('#emis');
    const dx = $('#detx');
    if (aperta !== id || !em || !dx) return;
    render(tabellaEmissioni(t), em);
    render(completa ? dettagli(t) : html`<div class="muted small">Carico la scheda completa…</div>`, dx);
  };
  disegna(false);
  void caricaSchede().then(() => {
    disegna(true);
  });
}
