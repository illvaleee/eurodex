import { html, type TemplateResult } from 'lit-html';
import { avanzamento, elenco } from '../catalogo/ambiti';
import { schede } from '../catalogo/dati';
import { pezzi, pezzoPerChiave } from '../catalogo/indice';
import { prezzo, raro } from '../catalogo/proprieta';
import { possedute, storico } from '../collezione/stato';
import { euro, numero, percentuale } from '../core/formato';

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function vistaStatistiche(): TemplateResult {
  const [o, n] = avanzamento(pezzi);
  const [oc, nc] = avanzamento(elenco('circ'));
  const [om, nm] = avanzamento(elenco('commem'));
  const rareHai = pezzi.filter(p => raro(p) && possedute.has(p.key)).length;
  const rareTutte = pezzi.filter(raro).length;
  let valore = 0;
  let conStima = 0;
  if (schede)
    for (const k of possedute) {
      const p = pezzoPerChiave[k];
      const v = p ? prezzo(p) : null;
      if (v != null) {
        valore += v;
        conStima++;
      }
    }
  const perMese = new Map<string, number>();
  for (const [ts, op] of storico) {
    const m = new Date(ts * 1000).toISOString().slice(0, 7);
    perMese.set(m, (perMese.get(m) ?? 0) + (op === '+' ? 1 : -1));
  }
  const oggi = new Date();
  const mesi = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(oggi.getFullYear(), oggi.getMonth() - 11 + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { k, mese: MESI[d.getMonth()] ?? '', v: Math.max(0, perMese.get(k) ?? 0) };
  });
  const massimo = Math.max(1, ...mesi.map(m => m.v));
  const barra = (nome: string, a: number, b: number) =>
    html`<div class="drow">
      <span class="dl">${nome}</span>
      <div
        class="bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax=${b}
        aria-valuenow=${a}
        aria-label="${nome}: ${a} su ${b}"
      >
        <i style="width:${b ? (a / b) * 100 : 0}%"></i>
      </div>
      <span class="count">${numero(a)}/${numero(b)}</span>
    </div>`;
  return html`
    <div class="card">
      <div class="kpis">
        <div><b>${numero(o)}</b><span>${o === 1 ? 'posseduta' : 'possedute'} su ${numero(n)}</span></div>
        <div><b>${percentuale(o, n)}%</b><span>completamento</span></div>
        <div><b>${numero(rareHai)}</b><span>rare su ${numero(rareTutte)}</span></div>
        <div>
          <b>${conStima ? euro(valore) : '—'}</b
          ><span
            >${conStima ? `valore stimato (${numero(conStima)} pezzi con stima)` : 'valore stimato: in arrivo'}</span
          >
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Aggiunte negli ultimi 12 mesi</h3>
      <div
        class="mchart"
        role="img"
        aria-label="Monete aggiunte per mese: ${mesi.map(m => `${m.mese} ${m.v}`).join(', ')}"
      >
        ${mesi.map(
          m =>
            html`<div class="mcol">
              <em>${m.v || ''}</em><i style="height:${Math.round((m.v / massimo) * 82)}%"></i><span>${m.mese}</span>
            </div>`,
        )}
      </div>
    </div>
    <div class="card">
      <h3>Circolazione e commemorativi</h3>
      ${barra('Circ.', oc, nc)}${barra('Comm.', om, nm)}
    </div>
    <div class="note">
      L'avanzamento per paese, anno e taglio è in Catalogo; le monete che hai, divise per taglio, paese o anno, sono in
      <b>Le mie</b>.
    </div>
    <button class="btn sec2" data-act="go" data-v="hist">Storico delle modifiche</button>
  `;
}
