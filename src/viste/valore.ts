import { html, nothing, type TemplateResult } from 'lit-html';
import { schede } from '../catalogo/dati';
import { bandiera, nomePaese, pezzi, pezzoPerChiave, visibile } from '../catalogo/indice';
import { prezzo, VALORE_NOMINALE } from '../catalogo/proprieta';
import type { Pezzo } from '../catalogo/tipi';
import { possedute, prefs } from '../collezione/stato';
import { TAGLIO } from '../core/costanti';
import { euro, numero } from '../core/formato';
import { moneta } from '../ui/monete';

function datiValore() {
  const opzioni = { noProof: !!prefs.noProof, noExtra: prefs.noExtra !== false };
  const mie = [...possedute].map(k => pezzoPerChiave[k]).filter((p): p is Pezzo => !!p && visibile(p, opzioni));
  const nominale = mie.reduce((a, p) => a + (VALORE_NOMINALE[p.t.denom] ?? 0), 0);
  let stima = 0;
  const conStima: [Pezzo, number][] = [];
  if (schede)
    for (const p of mie) {
      const v = prezzo(p);
      if (v != null) {
        stima += v;
        conStima.push([p, v]);
      }
    }
  return { mie, nominale, stima, conStima };
}

export function schedaValore(): TemplateResult | typeof nothing {
  const { nominale, stima, conStima, mie } = datiValore();
  if (!mie.length) return nothing;
  return html`<button class="card li2" id="valcard" data-act="go" data-v="value">
    <span class="ico val" aria-hidden="true">€</span>
    <div class="grow">
      <b>Valore della collezione</b>
      <span
        >${
          conStima.length >= mie.length * 0.5
            ? `circa ${euro(stima)} · ${numero(conStima.length)} di ${numero(mie.length)} pezzi stimati`
            : `valore nominale ${euro(nominale)} · stime in arrivo (${numero(conStima.length)} di ${numero(mie.length)})`
        }</span
      >
    </div>
    <span class="chev" aria-hidden="true">›</span>
  </button>`;
}

export function vistaValore(): TemplateResult {
  if (!schede) return html`<div class="empty">Carico le stime…</div>`;
  const { mie, nominale, stima, conStima } = datiValore();
  if (!mie.length)
    return html`<div class="empty">Segna le monete che hai: qui vedrai quanto vale la tua collezione.</div>`;
  const copertura = conStima.length / mie.length;
  const preziose = [...conStima].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const perPaese = new Map<string, number>();
  for (const [p, v] of conStima) perPaese.set(p.t.cc, (perPaese.get(p.t.cc) ?? 0) + v);
  const righePaesi = [...perPaese].sort((a, b) => b[1] - a[1]);
  const massimo = Math.max(1, ...righePaesi.map(r => r[1]));
  const preziosiMancanti = pezzi
    .filter(p => !possedute.has(p.key))
    .map(p => [p, prezzo(p)] as const)
    .filter((x): x is readonly [Pezzo, number] => x[1] != null)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const riga = ([p, v]: readonly [Pezzo, number]) =>
    html`<div class="prow">
      <button class="coinbtn" data-detail=${p.t.id} aria-label="Dettagli">${moneta(p.t, 'nat', 40)}</button>
      <div class="grow" data-detail=${p.t.id}>
        <div class="ct">${p.t.commem ? p.t.design || p.t.title : TAGLIO[p.t.denom].label}</div>
        <div class="cs">
          ${bandiera(p.t.cc)} ${nomePaese(p.t.cc)} · ${p.y}${p.m ? ` ${p.m}` : ''}${p.proof ? ' · proof' : ''}
        </div>
      </div>
      <b class="vv">${euro(v)}</b>
    </div>`;
  return html`
    <div class="card vhero">
      ${
        copertura >= 0.5
          ? html`<div class="vl">Valore stimato</div>
              <div class="vbig">circa ${euro(stima)}</div>`
          : html`<div class="vl">Valore stimato</div>
              <div class="vbig vsoon">in arrivo</div>
              <div class="vsub">
                Le stime di Numista si completano da sole mese dopo mese: finora
                ${
                  conStima.length
                    ? `${numero(conStima.length)} dei tuoi pezzi valgono in tutto ${euro(stima)}`
                    : 'nessuno dei tuoi pezzi ha una stima'
                }.
              </div>`
      }
      <div class="vcov">
        <div class="bar"><i style="width:${copertura * 100}%"></i></div>
        <span>${numero(conStima.length)} di ${numero(mie.length)} pezzi con una stima</span>
      </div>
      <div class="kpis two">
        <div><b>${euro(nominale)}</b><span>valore nominale</span></div>
        <div><b>${numero(mie.length)}</b><span>pezzi che hai</span></div>
      </div>
    </div>
    <div class="note">
      Le stime vengono da Numista (prezzo in fior di conio, altrimenti nella conservazione migliore disponibile) e si
      completano da sole ogni mese, a partire dalle monete più rare. Sono un'indicazione, non un prezzo di vendita.
    </div>
    ${
      preziose.length
        ? html`<div class="sec">Le più preziose che hai</div>
            <div class="card plist">${preziose.map(riga)}</div>`
        : nothing
    }
    ${
      righePaesi.length
        ? html`<div class="card">
            <h3>Valore per paese</h3>
            ${righePaesi.map(
              ([cc, v]) =>
                html`<div class="drow">
                  <span class="dl">${bandiera(cc)} ${cc}</span>
                  <div class="bar"><i style="width:${(v / massimo) * 100}%"></i></div>
                  <span class="count">${euro(v)}</span>
                </div>`,
            )}
          </div>`
        : nothing
    }
    ${
      preziosiMancanti.length
        ? html`<div class="sec">Le più preziose che ti mancano</div>
            <div class="card plist">${preziosiMancanti.map(riga)}</div>`
        : nothing
    }
  `;
}
