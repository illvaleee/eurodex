import { html, nothing, type TemplateResult } from 'lit-html';
import { bandiera, pezzoPerChiave, tipoPerId } from '../catalogo/indice';
import { etichettaPezzo } from '../catalogo/proprieta';
import { storico, type VoceStorico } from '../collezione/stato';
import { numero } from '../core/formato';

/** Storico: dalle modifiche più recenti, 100 alla volta (con il pulsante per vedere le successive). */
const PASSO = 100;
let quante = PASSO;

export function azzeraStorico(): void {
  quante = PASSO;
}
export function altroStorico(): void {
  quante += PASSO;
}

/**
 * Le monete importate da un file CSV hanno solo la data (il file non ha l'ora): segnate così all'importazione
 * (4° campo "d"), oppure importate prima di questo segno con l'ora messa d'ufficio a mezzogiorno in punto.
 */
const soloData = (v: VoceStorico): boolean => {
  if (v[3] === 'd') return true;
  const d = new Date(v[0] * 1000);
  return d.getHours() === 12 && d.getMinutes() === 0 && d.getSeconds() === 0;
};

export function vistaStorico(): TemplateResult {
  if (!storico.length) return html`<div class="empty">Ancora nessuna modifica.</div>`;
  const tutte = storico.length;
  const voci = [...storico].sort((a, b) => b[0] - a[0]).slice(0, quante);
  const giorni = new Map<string, VoceStorico[]>();
  for (const v of voci) {
    const g = new Date(v[0] * 1000).toLocaleDateString('it-IT', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    giorni.set(g, [...(giorni.get(g) ?? []), v]);
  }
  const resto = tutte - voci.length;
  return html`<div class="note">
      ${numero(tutte)} ${tutte === 1 ? 'modifica' : 'modifiche'}, dalla più recente. Tocca una moneta per aprire la sua
      scheda.
    </div>
    ${[...giorni].map(
      ([giorno, vs]) =>
        html`<div class="sec">${giorno}</div>
          <div class="card plist">
            ${vs.map(v => {
              const [ts, op, k] = v;
              const p = pezzoPerChiave[k];
              const apribile = !!p && !!tipoPerId[p.t.id];
              const da = typeof v[3] === 'string' && v[3].startsWith('@') ? v[3].slice(1) : '';
              return html`<div class="hrow1${apribile ? ' htap' : ''}" data-detail=${apribile ? p.t.id : nothing}>
                <span class="hop ${op === '+' ? 'plus' : 'minus'}" aria-label=${op === '+' ? 'aggiunta' : 'tolta'}
                  >${op === '+' ? '+' : '−'}</span
                ><span class="grow"
                  >${
                    p ? `${bandiera(p.t.cc)} ${etichettaPezzo(p)}${p.t.commem ? ` · ${p.t.design || ''}` : ''}` : k
                  }</span
                >${
                  soloData(v)
                    ? html`<span class="muted small hwhen">importata</span>`
                    : html`<span class="muted small hwhen"
                        >${da ? html`<span class="hda">${da}</span> · ` : nothing}${new Date(
                          ts * 1000,
                        ).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span
                      >`
                }
              </div>`;
            })}
          </div>`,
    )}
    ${
      resto > 0
        ? html`<button class="more" data-act="histmore">
            Mostra le ${numero(Math.min(PASSO, resto))} successive
            <span class="muted">· ne restano ${numero(resto)}</span>
          </button>`
        : tutte > PASSO
          ? html`<div class="note">Fine dello storico: sono tutte qui.</div>`
          : nothing
    }`;
}
