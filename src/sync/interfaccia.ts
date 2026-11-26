import { html, nothing, render, type TemplateResult } from 'lit-html';
import { $, inCorso } from '../core/dom';
import { quando } from '../core/formato';
import { avviso } from '../ui/avvisi';
import { dialogo } from '../ui/dialogo';
import { chiudiFoglio, foglioCon } from '../ui/foglio';
import { ICONA, ICONA_GOOGLE } from '../ui/icone';
import type { Dispositivo } from './motore';
import { apriSessioneNativa } from './sessione-nativa';
import {
  accedi,
  esci,
  idDispositivo,
  modificheInAttesa,
  quandoTuttoArrivato,
  ricezioneFerma,
  rinomina,
  seguiDispositivi,
  sincronizzaOra,
  sync,
} from './sincronizzazione';

/** La parte delle impostazioni che riguarda l'account Google e i dispositivi collegati. */

export function sezioneSync(): TemplateResult {
  if (!sync) return html`<button class="btn gbtn" data-act="syncaccedi">${ICONA_GOOGLE} Accedi con Google</button>`;
  return html`<div class="bstat ok" role="status">
      <b>✓ Attivo: collezione salvata e sincronizzata</b
      ><span
        >${sync.email || sync.account}<br />Questo dispositivo:
        ${sync.nome}${
          sync.scaduto
            ? html`<br />⚠️ Accesso scaduto: accedi di nuovo`
            : sync.errore
              ? html`<br />⚠️ Ultimo invio non riuscito: riprovo da solo`
              : ricezioneFerma
                ? html`<br />⚠️ Ricezione delle modifiche interrotta: riprovo da solo`
                : nothing
        }<span id="syncattesa"></span
      ></span>
    </div>
    ${
      sync.scaduto
        ? html`<button class="btn gbtn" data-act="syncaccedi">${ICONA_GOOGLE} Accedi di nuovo con Google</button>`
        : nothing
    }
    <div class="muted small">
      Sugli altri dispositivi apri Eurodex → Impostazioni → <b>Accedi con Google</b> con lo stesso account.
    </div>
    <div class="muted small" style="margin-top:12px">Dispositivi collegati:</div>
    <div id="disp" class="displist"></div>
    <div class="row gap">
      <button class="btn sm sec2" data-act="syncnome">Rinomina questo</button
      ><button class="btn sm sec2" data-act="syncora">Sincronizza ora</button>
    </div>
    <button class="btn sm ghost" data-act="syncscollega">Esci dall'account su questo dispositivo</button>`;
}

const sembraTablet = (modello: string | undefined) => /tab|pad|SM-X|SM-T|lenovo tb/i.test(modello ?? '');

let smettiDiSeguire: (() => void) | null = null;

function disegnaDispositivi(box: HTMLElement, l: readonly Dispositivo[] | null): void {
  const io = idDispositivo();
  if (!io) return;
  render(
    l == null
      ? html`<div class="muted small">Elenco non disponibile (sei connesso a internet?)</div>`
      : l.length
        ? html`${l.map(
            d =>
              html`<div class="disp${d.id === io ? ' me' : ''}">
                <span class="dico" aria-hidden="true"
                  >${d.tablet || sembraTablet(d.modello) ? ICONA.tablet : ICONA.telefono}</span
                >
                <div class="grow">
                  <b
                    >${d.nome || d.modello || 'Dispositivo'}${d.id === io ? html` <span class="badge">questo</span>` : nothing}</b
                  ><span
                    >${d.modello && d.modello !== d.nome ? `${d.modello} · ` : ''}${d.ultimo ? `usato ${quando(d.ultimo)}` : ''}</span
                  >
                </div>
              </div>`,
          )}`
        : html`<div class="muted small">Solo questo, per ora.</div>`,
    box,
  );
}

/**
 * Elenco dei dispositivi collegati, che si aggiorna da solo mentre è sullo schermo (un nome cambiato su un altro
 * telefono, un dispositivo aggiunto o tolto). Chiusa la scheda si smette di seguirlo.
 */
export async function mostraDispositivi(): Promise<void> {
  smettiDiSeguire?.();
  smettiDiSeguire = null;
  const box = $('#disp');
  if (!box || !sync) return;
  render(html`<div class="muted small">Carico…</div>`, box);
  const fine = (): void => {
    smettiDiSeguire?.();
    smettiDiSeguire = null;
  };
  try {
    const smetti = await seguiDispositivi(
      l => {
        if (box.isConnected) disegnaDispositivi(box, l);
        else fine();
      },
      () => {
        if (box.isConnected) disegnaDispositivi(box, null);
      },
    );
    if (!box.isConnected) smetti();
    else smettiDiSeguire = smetti;
  } catch {
    disegnaDispositivi(box, null);
  }
}

/**
 * Se ci sono modifiche fatte qui e non ancora arrivate al server (senza rete), la scheda dell'account lo dice invece
 * di "sincronizzata", e la riga sparisce da sola appena arrivano.
 */
export async function mostraInAttesa(): Promise<void> {
  if (!(await modificheInAttesa())) return;
  const riga = $('#syncattesa');
  if (!riga) return;
  render(html`<br />⏳ Modifiche in attesa di rete: partono da sole appena c'è connessione`, riga);
  try {
    await quandoTuttoArrivato();
  } catch {
    return;
  }
  if (riga.isConnected) render(nothing, riga);
}

function aggiornaSezione(): void {
  const box = $('#syncbox');
  if (!box) return;
  render(sezioneSync(), box);
  void mostraDispositivi();
  void mostraInAttesa();
}

export async function azioneAccedi(): Promise<void> {
  const r = await inCorso('[data-act="syncaccedi"]', null, () => accedi());
  if (!r.ok) {
    if (r.motivo === 'nessunAccount')
      avviso("Su questo dispositivo non c'è un account Google: aggiungilo nelle Impostazioni di Android");
    else if (r.motivo === 'nonDisponibile')
      avviso(
        r.dettaglio === 'nonDisponibile'
          ? "L'accesso con Google si fa nell'app installata sul telefono"
          : `Accesso non riuscito: ${r.dettaglio ?? ''}`,
      );
    else if (r.motivo === 'rete') avviso('Accesso non riuscito: sei connesso a internet?');
    else if (r.motivo === 'negato') avviso('Questo account non è approvato da Valerio');
    return;
  }
  if (foglioCon('.nvsheet') || foglioCon('.welcome')) chiudiFoglio();
  aggiornaSezione();
  avviso(`Fatto ✓ Collezione sincronizzata con ${sync?.email || 'il tuo account Google'}`, 5000);
}

/** «Continua» nell'ultimo passo dell'accesso (passo 5): la sessione nativa con lo stesso account. Vero se c'è. */
export async function azioneSessioneNativa(): Promise<boolean> {
  if (!sync) return false;
  const { uid, email } = sync;
  const r = await inCorso('[data-act="sessionenativa"]', null, () => apriSessioneNativa(uid, email));
  if (r === 'ok') {
    if (foglioCon('.nvsheet')) chiudiFoglio();
    avviso('Fatto ✓ Versioni e catalogo nuovi arriveranno da soli', 5000);
    return true;
  }
  if (r === 'altroAccount') avviso(`Scegli lo stesso account con cui sei entrato${email ? `: ${email}` : ''}`, 6000);
  else if (r === 'nessunAccount')
    avviso("Su questo dispositivo non c'è un account Google: aggiungilo nelle Impostazioni di Android");
  else if (r === 'errore') avviso('Non è riuscito: sei connesso a internet?');
  return false;
}

export async function azioneRinomina(): Promise<void> {
  if (!sync) return;
  const nome = await dialogo({
    titolo: 'Rinomina questo dispositivo',
    testo: "È il nome che vedono gli altri dispositivi nelle notifiche e nell'elenco.",
    campo: { valore: sync.nome, segnaposto: 'Es. Telefono di Marco', max: 40 },
    ok: 'Salva',
  });
  if (!nome) return;
  await rinomina(nome);
  aggiornaSezione();
}

export async function azioneSincronizzaOra(): Promise<void> {
  const esito = await inCorso('[data-act="syncora"]', 'Sincronizzo…', () => sincronizzaOra());
  avviso(
    {
      inviate: 'Modifiche inviate ✓ Tutto allineato',
      allineato: 'Tutto allineato ✓',
      senzaRete: "Senza connessione: le modifiche partono da sole appena c'è rete",
      errore: 'Invio non riuscito: riprovo alla prossima modifica',
      scaduto: 'Accesso scaduto: accedi di nuovo con Google',
    }[esito],
  );
  aggiornaSezione();
}

export async function azioneEsci(): Promise<void> {
  const ok = await dialogo({
    titolo: "Uscire dall'account?",
    testo:
      "La collezione resta su questo dispositivo com'è, ma le modifiche non arriveranno più agli altri dispositivi (e viceversa). Puoi riaccedere quando vuoi.",
    ok: 'Esci',
    pericolo: true,
  });
  if (!ok) return;
  await esci();
  aggiornaSezione();
  avviso("Uscito dall'account su questo dispositivo");
}
