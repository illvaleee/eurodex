import { html, type TemplateResult } from 'lit-html';
import { bandiera, nomePaese, tuttiPezzi } from '../catalogo/indice';
import type { Pezzo } from '../catalogo/tipi';
import { possedute, prefs, type FiltroExtra } from '../collezione/stato';
import { numero } from '../core/formato';
import { rigaTipoConPezzi } from '../ui/componenti';
import { sezioniPigre } from '../ui/navigazione';
import { ordina, raggruppa } from './ordine';

const FILTRI: readonly [FiltroExtra, string][] = [
  ['tutte', 'Tutte'],
  ['mie', "Ce l'ho"],
  ['mancano', 'Mi mancano'],
];

/** Scheda Extra: solo le varianti (errori di conio, lettera nella stella…), divise per paese. */
export function vistaExtra(): TemplateResult {
  const f = prefs.extraFiltro ?? 'tutte';
  const scelta = html`<div class="seg" role="radiogroup" aria-label="Mostra">
    ${FILTRI.map(
      ([k, nome]) =>
        html`<button
          class=${f === k ? 'on' : ''}
          data-act="extrafiltro"
          data-v=${k}
          role="radio"
          aria-checked=${f === k ? 'true' : 'false'}
        >
          ${nome}
        </button>`,
    )}
  </div>`;
  const tutte = tuttiPezzi.filter(p => p.extra && !(prefs.noProof && p.proof));
  const hai = tutte.filter(p => possedute.has(p.key)).length;
  const lista = ordina(
    tutte.filter(p => f === 'tutte' || (f === 'mie') === possedute.has(p.key)),
    'paese',
  );
  const testa = html`<div class="minehead">
      <b data-extratot>${numero(hai)}</b> di ${numero(tutte.length)} varianti
      <span class="muted">· ${numero(new Set(tutte.map(p => p.t.cc)).size)} paesi</span>
    </div>
    <div class="note">
      Errori di conio, lettera nella stella, stelle grandi e piccole e le altre varianti delle monete.
      ${
        prefs.noExtra !== false
          ? "Stanno solo qui: in collezione, catalogo e mancanti c'è la serie base (si cambia nelle impostazioni)."
          : 'Ora contano anche in collezione (si cambia nelle impostazioni).'
      }
    </div>`;
  if (!lista.length)
    return html`${scelta}${testa}
      <div class="empty">
        ${
          f === 'mie'
            ? 'Non hai ancora segnato varianti: tocca un anno qui sotto in «Tutte» per segnarla.'
            : f === 'mancano'
              ? 'Hai tutte le varianti 🎉'
              : 'Nessuna variante nel catalogo.'
        }
      </div>`;
  const perPaese = (cc: string): [number, number] => {
    const ps = tutte.filter(p => p.t.cc === cc);
    return [ps.filter(p => possedute.has(p.key)).length, ps.length];
  };
  const sezioni = raggruppa(lista, 'paese').map((g, i) => {
    const primo: Pezzo | undefined = [...g.tipi.values()][0]?.[0];
    const cc = primo?.t.cc ?? '';
    const [o, n] = perPaese(cc);
    return html`<div class="sec">
        ${bandiera(cc)} ${nomePaese(cc)}
        <span class="secn" data-xnum=${i} data-xtot=${n}>· ${numero(o)}/${numero(n)}</span>
      </div>
      <div class="card plist" data-xgruppo=${i} data-cc=${cc}>
        ${[...g.tipi.values()].map(ps => (ps[0] ? rigaTipoConPezzi(ps[0].t, ps, 'paese') : null))}
      </div>`;
  });
  return html`${scelta}${testa}${sezioniPigre(sezioni, 4)}`;
}
