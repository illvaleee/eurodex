import { html, nothing, render, type TemplateResult } from 'lit-html';
import { $ } from '../core/dom';
import { registraErrore } from '../core/errori';
import { quando } from '../core/formato';
import type { Decisione, Richiesta, StatoAccesso } from '../sync/accesso';
import { dopoRichiesta, muroAcceso, muroCambiato } from '../sync/muro';
import { pulitoPerRichiesta } from '../sync/muro-logica';
import { infoDispositivo, modelloLeggibile, sincronizzazioneAttiva, sync } from '../sync/sincronizzazione';
import { avviso } from '../ui/avvisi';
import { dialogo } from '../ui/dialogo';
import { apriFoglio, foglioCon } from '../ui/foglio';
import { ICONA } from '../ui/icone';

/**
 * Accesso su approvazione nelle impostazioni: lo stato del proprio account (con «Chiedi l'accesso») e, solo per
 * Valerio, la sezione per accettare o rifiutare le richieste e per accendere o spegnere il muro.
 */

const accesso = () => import('../sync/accesso');

function sezioneUtente(stato: StatoAccesso): TemplateResult {
  const box =
    stato === 'approvato'
      ? html`<div class="bstat ok" role="status"><b>✓ Accesso approvato da Valerio</b></div>`
      : stato === 'in_attesa'
        ? html`<div class="bstat ok" role="status">
            <b>⏳ Richiesta inviata</b><span>Valerio la vede e ti risponde.</span>
          </div>`
        : stato === 'rifiutato' || stato === 'revocato'
          ? html`<div class="bstat err" role="status"><b>Accesso non approvato da Valerio</b></div>`
          : html`<button class="btn sec2" data-act="accchiedi">Chiedi l'accesso</button>`;
  return html`<div class="sec">Accesso</div>
    <div class="metodo">
      <div class="mtit"><span class="mico">${ICONA.lucchetto}</span><b>Accesso a Eurodex</b></div>
      <div class="muted small">
        ${
          muroAcceso()
            ? "Eurodex è su invito: serve l'approvazione di Valerio."
            : "Presto Eurodex sarà su invito: per usarlo servirà l'approvazione di Valerio, e puoi già chiederla."
        }
      </div>
      ${box}
    </div>`;
}

function sezioneAmministratore(inAttesa: number | null): TemplateResult {
  return html`<div class="sec">Accesso</div>
    <div class="metodo">
      <div class="mtit">
        <span class="mico">${ICONA.lucchetto}</span><b>Accessi a Eurodex</b><span class="mbadge">solo per te</span>
      </div>
      <div class="muted small">
        Muro <b>${muroAcceso() ? 'acceso' : 'spento'}</b>${
          muroAcceso() ? ': solo chi approvi usa Eurodex.' : ': per ora Eurodex è aperto a tutti.'
        }${inAttesa ? html` <b>${inAttesa === 1 ? '1 richiesta' : `${inAttesa} richieste`} in attesa.</b>` : nothing}
      </div>
      <button class="btn sec2" data-act="accgestisci">Gestisci gli accessi</button>
    </div>`;
}

/** La sezione nelle impostazioni (solo con l'accesso a Google fatto): si disegna da sola appena sa lo stato. */
export async function disegnaSezioneAccesso(): Promise<void> {
  const box = $('#accessobox');
  if (!box) return;
  if (!sincronizzazioneAttiva() || !sync) {
    render(nothing, box);
    return;
  }
  const uid = sync.uid;
  const a = await accesso();
  if (a.eAmministratore(uid)) {
    render(sezioneAmministratore(null), box);
    try {
      const n = (await a.richieste()).filter(r => r.stato === 'in_attesa' && r.uid !== uid).length;
      if (box.isConnected) render(sezioneAmministratore(n), box);
    } catch {
      // senza rete il numero si vede aprendo la sezione
    }
    return;
  }
  render(sezioneUtente(a.ultimoStato(uid)), box);
  try {
    const stato = await a.leggiAccesso(uid);
    a.ricordaStato(uid, stato);
    if (box.isConnected) render(sezioneUtente(stato), box);
  } catch {
    // senza rete resta l'ultimo stato conosciuto
  }
}

/** «Chiedi l'accesso» dalle impostazioni (con il muro ancora spento). */
export async function azioneChiediAccesso(): Promise<void> {
  if (!sync) return;
  try {
    const a = await accesso();
    const telefono = modelloLeggibile(await infoDispositivo());
    await a.chiediAccesso(sync.uid, pulitoPerRichiesta(sync.account), sync.email, pulitoPerRichiesta(telefono));
    a.ricordaStato(sync.uid, 'in_attesa');
    void dopoRichiesta();
    avviso('Richiesta inviata ✓ Valerio la riceve subito', 5000);
  } catch (e) {
    registraErrore("richiesta d'accesso", e);
    avviso('Richiesta non inviata: sei connesso a internet?');
  }
  await disegnaSezioneAccesso();
}

// ───────── la sezione di Valerio ─────────

const nomeDi = (r: Richiesta) => r.nome || r.email || 'Senza nome';

function riga(r: Richiesta, pulsanti: TemplateResult): TemplateResult {
  const dettagli = [r.nome ? r.email : '', r.dispositivo, r.richiesta ? `chiesto ${quando(r.richiesta.getTime())}` : '']
    .filter(Boolean)
    .join(' · ');
  return html`<div class="disp acc">
    <span class="dico" aria-hidden="true">${nomeDi(r).slice(0, 1).toUpperCase()}</span>
    <div class="grow">
      <b>${nomeDi(r)}</b><span>${dettagli}</span>
      ${r.nota ? html`<span class="accnota">${r.nota}</span>` : nothing}
      <div class="row gap accbtn">${pulsanti}</div>
    </div>
  </div>`;
}

function elenco(tutte: readonly Richiesta[], io: string): TemplateResult {
  const l = tutte.filter(r => r.uid !== io);
  const attesa = l.filter(r => r.stato === 'in_attesa');
  const dentro = l.filter(r => r.stato === 'approvato');
  const fuori = l.filter(r => r.stato === 'rifiutato' || r.stato === 'revocato');
  const pulsante = (r: Richiesta, act: string, testo: string, classe = 'btn sm') =>
    html`<button class=${classe} data-act=${act} data-v=${r.uid} aria-label="${testo}: ${nomeDi(r)}">${testo}</button>`;
  const gruppo = (titolo: string, righe: TemplateResult[], vuoto: string) =>
    html`<div class="sec">${titolo}</div>
      ${righe.length ? html`<div class="displist">${righe}</div>` : html`<div class="muted small">${vuoto}</div>`}`;
  return html`${gruppo(
    `In attesa (${attesa.length})`,
    attesa.map(r => riga(r, html`${pulsante(r, 'accok', 'Approva')}${pulsante(r, 'accno', 'Rifiuta', 'btn sm sec2')}`)),
    'Nessuna richiesta da decidere.',
  )}
  ${gruppo(
    `Approvati (${dentro.length})`,
    dentro.map(r => riga(r, pulsante(r, 'accvia', "Togli l'accesso", 'btn sm ghost'))),
    'Ancora nessuno.',
  )}
  ${
    fuori.length
      ? gruppo(
          `Non approvati (${fuori.length})`,
          fuori.map(r => riga(r, pulsante(r, 'accok', 'Approva', 'btn sm sec2'))),
          '',
        )
      : nothing
  }`;
}

let smettiRichieste: (() => void) | null = null;

/** La sezione di Valerio: interruttore del muro e richieste, che si aggiornano da sole mentre è aperta. */
export async function apriGestioneAccessi(): Promise<void> {
  if (!sync) return;
  const io = sync.uid;
  const a = await accesso();
  if (!a.eAmministratore(io)) return;
  apriFoglio(html`
    <h2 data-foglio="accessi">Accessi a Eurodex</h2>
    <label class="tgl"
      ><span
        ><b>Solo chi approvi può usare Eurodex</b
        ><small
          >Acceso: chi non è approvato vede solo la schermata per chiedere l'accesso, e non ha più sincronizzazione,
          notifiche e aggiornamenti. Spento: tutto come prima.</small
        ></span
      ><input type="checkbox" data-muro .checked=${muroAcceso()} /><i aria-hidden="true"></i
    ></label>
    <div id="acclist"></div>
    <button class="btn" data-act="close" style="margin-top:18px">Chiudi</button>
  `);
  smettiRichieste?.();
  smettiRichieste = null;
  const box = $('#acclist');
  if (!box) return;
  // tutto quello che sta nel riquadro lo disegna lit (anche l'attesa), così l'elenco lo sostituisce
  render(html`<div class="muted small">Carico le richieste…</div>`, box);
  const smetti = a.seguiRichieste(
    l => {
      if (box.isConnected) render(elenco(l, io), box);
      else {
        smetti();
        smettiRichieste = null;
      }
    },
    e => {
      registraErrore('elenco delle richieste di accesso', e);
      if (box.isConnected)
        render(html`<div class="muted small">Elenco non disponibile (sei connesso a internet?)</div>`, box);
    },
  );
  smettiRichieste = smetti;
}

const DOMANDE: Partial<Record<Decisione, { titolo: string; testo: string; ok: string }>> = {
  rifiutato: {
    titolo: 'Rifiutare la richiesta?',
    testo: 'Non potrà usare Eurodex finché il muro è acceso. Puoi sempre ripensarci e approvarlo dopo.',
    ok: 'Rifiuta',
  },
  revocato: {
    titolo: "Togliere l'accesso?",
    testo:
      "Da subito non avrà più sincronizzazione e notifiche, e col muro acceso vedrà solo la schermata per chiedere l'accesso. La sua collezione resta salvata.",
    ok: "Togli l'accesso",
  },
};

/** Approva, rifiuta o toglie l'accesso (chiedendo conferma per rifiutare e togliere). */
export async function decidiAccesso(uid: string | undefined, stato: Decisione): Promise<void> {
  if (!uid) return;
  const d = DOMANDE[stato];
  if (d && !(await dialogo({ ...d, pericolo: true }))) return;
  try {
    await (await accesso()).decidi(uid, stato);
    avviso(
      stato === 'approvato'
        ? 'Approvato ✓ Gli arriva una notifica'
        : stato === 'rifiutato'
          ? 'Richiesta rifiutata'
          : 'Accesso tolto',
    );
  } catch (e) {
    registraErrore("decisione sull'accesso", e);
    avviso('Non riuscito: sei connesso a internet?');
  }
}

/** L'interruttore del muro. Per accenderlo si chiede conferma, dicendo quanti sono già approvati. */
export async function cambiaMuro(el: HTMLInputElement): Promise<void> {
  const acceso = el.checked;
  const a = await accesso();
  if (acceso) {
    let approvati = 0;
    try {
      approvati = (await a.richieste()).filter(r => r.stato === 'approvato').length;
    } catch {
      // senza rete il numero non si sa: la conferma si chiede lo stesso
    }
    const ok = await dialogo({
      titolo: 'Accendere il muro?',
      testo: `Da subito chi non hai approvato vedrà solo la schermata per chiedere l'accesso, e non avrà più sincronizzazione e notifiche. Approvati adesso: ${approvati}. Puoi spegnerlo quando vuoi.`,
      ok: 'Accendi',
      pericolo: true,
    });
    if (!ok) {
      el.checked = false;
      return;
    }
  }
  try {
    await a.impostaObbligo(acceso);
    muroCambiato(acceso);
    avviso(
      acceso ? 'Muro acceso: ora solo chi hai approvato usa Eurodex' : 'Muro spento: Eurodex è di nuovo aperto a tutti',
    );
  } catch (e) {
    el.checked = !acceso;
    registraErrore('interruttore del muro', e);
    avviso('Non riuscito: sei connesso a internet?');
  }
  if (foglioCon('[data-foglio="impostazioni"]')) await disegnaSezioneAccesso();
}
