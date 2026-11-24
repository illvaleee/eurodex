import { html, nothing, type TemplateResult } from 'lit-html';
import type { EsitoMuro } from '../sync/muro-logica';
import { ICONA, ICONA_GOOGLE } from '../ui/icone';

/**
 * La schermata davanti a tutto quando questo account non può usare Eurodex: muro acceso e accesso non ancora fatto o
 * non approvato, oppure (anche col muro spento) un account che Valerio ha rifiutato o a cui ha tolto l'accesso.
 * Stessi elementi delle altre finestre dell'app: icona, titolo, spiegazione, pulsanti.
 * `chiestoDaPoco`: «Chiedi di nuovo» premuto da meno di un minuto (si può ripremere dopo).
 */
export function schermataMuro(
  esito: Exclude<EsitoMuro, 'aperto'>,
  email: string,
  chiestoDaPoco = false,
): TemplateResult {
  const altro = html`<button class="btn ghost" data-act="muroesci">Usa un altro account</button>`;
  // chi è stato rifiutato o non ha più l'accesso può chiedere di nuovo: Valerio lo vede e può cambiare idea
  const ancora = chiestoDaPoco
    ? html`<button class="btn" data-act="muroancora" disabled>Richiesta inviata ✓</button>`
    : html`<button class="btn" data-act="muroancora">Chiedi di nuovo</button>`;
  const testi: Record<typeof esito, { titolo: string; testo: TemplateResult; pulsanti: TemplateResult }> = {
    accedi: {
      titolo: 'Eurodex è su invito',
      testo: html`Per usarlo accedi con il tuo account Google: Valerio riceve la richiesta e ti risponde.`,
      pulsanti: html`<button class="btn gbtn" data-act="muroaccedi">${ICONA_GOOGLE} Accedi con Google</button>`,
    },
    chiedi: {
      titolo: "Chiedi l'accesso",
      testo: html`Sei entrato come <b>${email}</b>. Prima di usare Eurodex, Valerio deve approvare questo account.`,
      pulsanti: html`<button class="btn" data-act="murochiedi">Chiedi l'accesso</button>${altro}`,
    },
    attesa: {
      titolo: 'Richiesta inviata',
      testo: html`Valerio deve approvare <b>${email}</b>. Quando lo fa questa schermata si apre da sola, e ti arriva una
        notifica.`,
      pulsanti: altro,
    },
    fuori: {
      titolo: 'Accesso non approvato',
      testo: html`Valerio non ha approvato l'accesso per <b>${email}</b>. Puoi chiederlo di nuovo, oppure entrare con un
        altro account.`,
      pulsanti: html`${ancora}${altro}`,
    },
    tolto: {
      titolo: 'Accesso tolto',
      testo: html`Valerio ha tolto l'accesso per <b>${email}</b>. Quello che hai segnato resta salvato su questo
        telefono. Puoi chiedere di nuovo l'accesso, oppure entrare con un altro account.`,
      pulsanti: html`${ancora}${altro}`,
    },
  };
  const t = testi[esito];
  return html`<div class="muro-in">
    <div class="nvhead">
      <div class="nvico">${esito === 'attesa' ? ICONA.clock : ICONA.lucchetto}</div>
      <h2 id="murotit">${t.titolo}</h2>
      <div class="muted">${t.testo}</div>
    </div>
    ${esito === 'attesa' ? html`<div class="bstat ok" role="status"><b>⏳ In attesa della risposta</b></div>` : nothing}
    <div class="nvbtn">${t.pulsanti}</div>
  </div>`;
}
