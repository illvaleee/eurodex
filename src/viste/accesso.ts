import { html, nothing, render, type TemplateResult } from 'lit-html';
import { $ } from '../core/dom';
import { registraErrore } from '../core/errori';
import { quando } from '../core/formato';
import type { Decisione, Richiesta, StatoAccesso } from '../sync/accesso';
import type { Dispositivo } from '../sync/motore';
import {
  chiediDalleImpostazioni,
  inProvaAutomatica,
  muroAcceso,
  muroAccesoSulServer,
  muroCambiato,
  preparaNotifiche,
} from '../sync/muro';
import { sincronizzazioneAttiva, sync } from '../sync/sincronizzazione';
import { avviso } from '../ui/avvisi';
import { dialogo } from '../ui/dialogo';
import { apriFoglio, foglioCon } from '../ui/foglio';
import { ICONA } from '../ui/icone';

/**
 * Accesso su approvazione nelle impostazioni: lo stato del proprio account e, solo per Valerio, la sezione con tutti
 * gli account che hanno fatto l'accesso (su quali telefoni, quando), per approvare, rifiutare o togliere l'accesso, e
 * l'interruttore del muro.
 */

const accesso = () => import('../sync/accesso');
const motore = () => import('../sync/motore');

function sezioneUtente(stato: StatoAccesso): TemplateResult {
  const box =
    stato === 'approvato'
      ? html`<div class="bstat ok" role="status"><b>✓ Accesso approvato da Valerio</b></div>`
      : stato === 'in_attesa'
        ? html`<div class="bstat ok" role="status">
            <b>⏳ In attesa dell'approvazione</b><span>Valerio ha ricevuto la tua richiesta.</span>
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
            : "Presto Eurodex sarà su invito: per usarlo servirà l'approvazione di Valerio."
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
        Muro <b>${muroAccesoSulServer() ? 'acceso' : 'spento'}</b>${
          muroAccesoSulServer()
            ? ': solo chi approvi usa Eurodex.'
            : ': per ora Eurodex è aperto a tutti, tranne chi hai escluso.'
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
    // appena entrato dalle impostazioni (anche su un telefono nuovo): da subito gli arrivano richieste e tentativi
    void preparaNotifiche().catch(() => undefined);
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

/** «Chiedi l'accesso» dalle impostazioni, se la richiesta automatica non era partita (per esempio senza rete). */
export async function azioneChiediAccesso(): Promise<void> {
  if (await chiediDalleImpostazioni()) {
    (await accesso()).ricordaStato(sync?.uid ?? '', 'in_attesa');
    avviso('Richiesta inviata ✓ Valerio la riceve subito', 5000);
  } else avviso('Richiesta non inviata: sei connesso a internet?');
  await disegnaSezioneAccesso();
}

// ───────── la sezione di Valerio ─────────

// in grassetto l'email, che viene da Google e non si può inventare; il nome lo sceglie la persona (revisione di Claude
// 3 su #14: un nome come «Mamma (…)» non deve sembrare l'identità)
const chiE = (r: Richiesta) => r.email || 'senza email';
const ultimaVolta = (r: Richiesta) => (r.ultimoTentativo ?? r.richiesta)?.getTime() ?? 0;

/** I telefoni su cui ogni account usa Eurodex (dalla sincronizzazione): si leggono una volta per apertura. */
let telefoni = new Map<string, Dispositivo[] | 'errore'>();

function righeTelefoni(uid: string): TemplateResult | typeof nothing {
  const t = telefoni.get(uid);
  if (!t) return nothing;
  if (t === 'errore') return html`<span>Telefoni non disponibili</span>`;
  if (!t.length) return html`<span>Non sincronizza su nessun telefono</span>`;
  return html`<span
    >${t.length === 1 ? 'Usa Eurodex su' : `Usa Eurodex su ${t.length} dispositivi`}:
    ${t
      .map(d =>
        [d.nome || d.modello || 'Telefono', d.versione ?? '', d.ultimo ? `aperta ${quando(d.ultimo)}` : '']
          .filter(Boolean)
          .join(' · '),
      )
      .join('; ')}</span
  >`;
}

function riga(r: Richiesta, pulsanti: TemplateResult): TemplateResult {
  const fuori = r.stato === 'revocato' ? 'accesso tolto' : r.stato === 'rifiutato' ? 'rifiutato' : '';
  const ultimo = ultimaVolta(r);
  const dettagli = [
    r.nome,
    fuori,
    ultimo ? `ultimo accesso ${quando(ultimo)}${r.dispositivo ? ` da ${r.dispositivo}` : ''}` : r.dispositivo,
    r.tentativi > 1 ? `${r.tentativi} accessi` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return html`<div class="disp acc">
    <span class="dico" aria-hidden="true">${chiE(r).slice(0, 1).toUpperCase()}</span>
    <div class="grow">
      <b>${chiE(r)}</b><span>${dettagli}</span>${righeTelefoni(r.uid)}
      ${r.nota ? html`<span class="accnota">${r.nota}</span>` : nothing}
      <div class="row gap accbtn">${pulsanti}</div>
    </div>
  </div>`;
}

function elenco(tutte: readonly Richiesta[], io: string): TemplateResult {
  const l = tutte.filter(r => r.uid !== io).sort((x, y) => ultimaVolta(y) - ultimaVolta(x));
  const attesa = l.filter(r => r.stato === 'in_attesa');
  const dentro = l.filter(r => r.stato === 'approvato');
  const fuori = l.filter(r => r.stato === 'rifiutato' || r.stato === 'revocato');
  const pulsante = (r: Richiesta, act: string, testo: string, classe = 'btn sm') =>
    html`<button class=${classe} data-act=${act} data-v=${r.uid} aria-label="${testo}: ${chiE(r)}">${testo}</button>`;
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

/** I telefoni degli account nuovi nell'elenco (e di quelli che non ne avevano ancora: il telefono di chi ha appena
 * fatto l'accesso si registra un attimo dopo); quando arrivano, l'elenco si ridisegna. */
async function caricaTelefoni(l: readonly Richiesta[], ridisegna: () => void): Promise<void> {
  const vuoto = (uid: string) => {
    const t = telefoni.get(uid);
    return t === undefined || (Array.isArray(t) && t.length === 0);
  };
  const nuovi = l.map(r => r.uid).filter(vuoto);
  if (!nuovi.length) return;
  const m = await motore();
  const mappa = telefoni;
  await Promise.all(
    nuovi.map(async uid => {
      try {
        mappa.set(uid, await m.dispositivi(uid));
      } catch (e) {
        registraErrore('telefoni di un account', e);
        mappa.set(uid, 'errore');
      }
    }),
  );
  if (mappa === telefoni) ridisegna();
}

let smettiRichieste: (() => void) | null = null;

/** La sezione di Valerio: interruttore del muro e richieste, che si aggiornano da sole mentre è aperta. */
export async function apriGestioneAccessi(): Promise<void> {
  if (!sync) return;
  const io = sync.uid;
  const a = await accesso();
  if (!a.eAmministratore(io)) return;
  // durante le prove automatiche (un giro con tocchi a caso sul telefono di Valerio) il foglio non si apre: lì un tocco
  // accende il muro per tutti o decide di una persona vera, e a quella arriva la notifica (revisione di Claude 3)
  if (await inProvaAutomatica()) {
    avviso('Durante le prove automatiche la gestione degli accessi non si apre', 5000);
    return;
  }
  apriFoglio(html`
    <h2 data-foglio="accessi">Accessi a Eurodex</h2>
    <label class="tgl"
      ><span
        ><b>Solo chi approvi può usare Eurodex</b
        ><small
          >Acceso: chi non è approvato vede solo la schermata per accedere e chiedere l'accesso. Spento: Eurodex è
          aperto a tutti, tranne chi hai rifiutato o a cui hai tolto l'accesso.</small
        ></span
      ><input type="checkbox" data-muro .checked=${muroAccesoSulServer()} /><i aria-hidden="true"></i
    ></label>
    <div id="acclist"></div>
    <button class="btn" data-act="close" style="margin-top:18px">Chiudi</button>
  `);
  smettiRichieste?.();
  smettiRichieste = null;
  const box = $('#acclist');
  if (!box) return;
  // tutto quello che sta nel riquadro lo disegna lit (anche l'attesa), così l'elenco lo sostituisce
  render(html`<div class="muted small">Carico gli accessi…</div>`, box);
  telefoni = new Map();
  const smetti = a.seguiRichieste(
    l => {
      if (!box.isConnected) {
        smetti();
        smettiRichieste = null;
        return;
      }
      ultime = new Map(l.map(r => [r.uid, r]));
      render(elenco(l, io), box);
      // arrivati i telefoni si ridisegna l'elenco più recente (non quello di quando sono stati chiesti)
      void caricaTelefoni(l, () => {
        if (box.isConnected) render(elenco([...ultime.values()], io), box);
      }).catch(() => undefined);
    },
    e => {
      registraErrore('elenco delle richieste di accesso', e);
      if (box.isConnected)
        render(html`<div class="muted small">Elenco non disponibile (sei connesso a internet?)</div>`, box);
    },
  );
  smettiRichieste = smetti;
}

/** Le conferme, con l'email vera (e il nome scelto dalla persona, detto come tale). */
function domanda(stato: Decisione, r: Richiesta | undefined): { titolo: string; testo: string; ok: string } {
  const email = r?.email || 'questo account';
  const nome = r?.nome ? `Nome sull'account Google: «${r.nome}» (lo sceglie la persona, l'email no). ` : '';
  if (stato === 'approvato')
    return {
      titolo: `Approvare ${email}?`,
      testo: `${nome}Potrà usare Eurodex anche col muro acceso, e gli arriva una notifica.`,
      ok: 'Approva',
    };
  if (stato === 'rifiutato')
    return {
      titolo: `Rifiutare ${email}?`,
      testo: `${nome}Non potrà usare Eurodex, nemmeno col muro spento. Se ci riprova ti arriva una notifica, e puoi sempre approvarlo dopo.`,
      ok: 'Rifiuta',
    };
  return {
    titolo: `Togliere l'accesso a ${email}?`,
    testo: `${nome}Da subito non potrà più usare Eurodex, nemmeno col muro spento, e gli arriva una notifica. Quello che ha segnato resta salvato sul suo telefono. Puoi riapprovarlo quando vuoi.`,
    ok: "Togli l'accesso",
  };
}

/** Le richieste dell'ultimo elenco disegnato (per le conferme). */
let ultime = new Map<string, Richiesta>();

/** Approva, rifiuta o toglie l'accesso, sempre con conferma (con l'email vera). */
export async function decidiAccesso(uid: string | undefined, stato: Decisione): Promise<void> {
  if (!uid) return;
  if (!(await dialogo({ ...domanda(stato, ultime.get(uid)), pericolo: stato !== 'approvato' }))) return;
  try {
    await (await accesso()).decidi(uid, stato);
    avviso(
      stato === 'approvato'
        ? 'Approvato ✓ Gli arriva una notifica'
        : stato === 'rifiutato'
          ? 'Richiesta rifiutata'
          : 'Accesso tolto ✓ Gli arriva una notifica',
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
      testo: `Da subito chi non hai approvato vedrà solo la schermata per accedere e chiedere l'accesso. Approvati adesso: ${approvati}. Puoi spegnerlo quando vuoi.`,
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
      acceso
        ? 'Muro acceso: ora solo chi hai approvato usa Eurodex'
        : 'Muro spento: Eurodex è di nuovo aperto a tutti, tranne chi hai escluso',
    );
  } catch (e) {
    el.checked = !acceso;
    registraErrore('interruttore del muro', e);
    avviso('Non riuscito: sei connesso a internet?');
  }
  if (foglioCon('[data-foglio="impostazioni"]')) await disegnaSezioneAccesso();
}
