// La logica delle funzioni, senza Firebase dentro: così si prova con node --test, senza emulatori né rete.
// (index.js la collega a Firestore, Authentication e Cloud Messaging.)
'use strict';

const STATI = ['in_attesa', 'approvato', 'rifiutato', 'revocato'];

/** I dati della notifica di sincronizzazione (gli stessi di sempre: le app vecchie e nuove li leggono uguali). */
function datiSync(cid, d) {
  return {
    tipo: 'sync',
    cid,
    did: String(d.did || ''),
    nome: String(d.nome || 'un altro dispositivo').slice(0, 60),
    testo: String(d.testo).slice(0, 500),
    ts: String(d.ts || Date.now()),
  };
}

/** I token validi tra i documenti dei dispositivi di un account (senza doppioni). */
function tokenDi(documenti) {
  const visti = new Set();
  for (const d of documenti) {
    const t = d && typeof d.token === 'string' ? d.token.trim() : '';
    if (t.length >= 20 && t.length <= 4096) visti.add(t);
  }
  return [...visti];
}

/** Testo da fuori senza caratteri di controllo o di direzione (che possono rigirare quello che segue). */
function pulito(x, max) {
  return String(x || '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .slice(0, max);
}

/** Data di Firestore (Timestamp), Date o numero → millisecondi (0 se non si legge). */
function millis(x) {
  if (!x) return 0;
  if (typeof x === 'number') return x;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (x instanceof Date) return x.getTime();
  return 0;
}

const UN_MINUTO = 60 * 1000;
const ANDROID = { priority: 'high', ttl: 7 * 24 * 3600 * 1000 };

/**
 * Chi ha fatto il tentativo, per le notifiche di Valerio: prima l'email, che è quella vera dell'account (la prende
 * la funzione da Authentication), poi nome e telefono, che sono solo un aiuto (revisione di Claude 3 su #8).
 */
function chi(t) {
  const parti = [pulito(t && t.email, 120), pulito(t && t.nome, 80), pulito(t && t.dispositivo, 80)];
  return parti.filter(Boolean).join(' · ') || 'Qualcuno';
}

/** Una notifica per Valerio: toccandola l'app apre la sua sezione; titolo e testo li mostra l'app se è aperta. */
function notificaPerValerio(uid, titolo, corpo) {
  return {
    notification: { title: titolo, body: corpo },
    data: { tipo: 'accesso', uid: String(uid), eurodex_azione: 'accessi', titolo, testo: corpo },
    android: ANDROID,
  };
}

/** La notifica per Valerio quando un account nuovo chiede l'accesso (avvisaValerio, alla creazione). */
function messaggioRichiesta(uid, r) {
  return notificaPerValerio(uid, 'Richiesta di accesso a Eurodex', chi(r));
}

/**
 * Un tentativo di accesso (ogni accesso con Google nell'app, scelta di Valerio del 21/11): cosa scrivere
 * sull'account e quale notifica mandare a Valerio.
 * - Account nuovo: richiesta in attesa; la notifica la manda avvisaValerio, quando il documento nasce.
 * - Già deciso: la decisione resta (approvato o rifiutato in automatico) e a Valerio arriva la notifica, così può
 *   cambiare idea. Ancora in attesa: glielo si ricorda.
 * - Al massimo una notifica al minuto per account (dieci tocchi di fila non fanno dieci notifiche).
 */
function dopoTentativo(uid, r, t, ora) {
  // nome e telefono li sceglie la persona: senza @, così l'unico campo con la chiocciola resta l'email, che viene da
  // Authentication (come faceva la regola di #8; revisione di Claude 2 e Claude 3 su #14)
  const senzaChiocciola = x => pulito(x, 200).replace(/@/g, '').slice(0, 80);
  const info = {
    nome: senzaChiocciola(t && t.nome),
    email: pulito(t && t.email, 120),
    dispositivo: senzaChiocciola(t && t.dispositivo),
  };
  if (!r) return { nuovo: true, campi: { stato: 'in_attesa', ...info, tentativi: 1 }, notifica: null };
  const campi = { ...info, tentativi: (Number(r.tentativi) || 1) + 1 };
  if (ora - millis(r.avvisato) < UN_MINUTO) return { nuovo: false, campi, notifica: null };
  const stato = STATI.includes(r.stato) ? r.stato : 'in_attesa';
  const titolo =
    stato === 'approvato'
      ? 'Accesso approvato in automatico'
      : stato === 'in_attesa'
        ? 'Richiesta di accesso a Eurodex'
        : 'Accesso rifiutato in automatico';
  const dopo =
    stato === 'in_attesa' ? ' · ancora in attesa' : t && t.motivo === 'ancora' ? ' · ha chiesto di nuovo' : '';
  return { nuovo: false, campi, notifica: notificaPerValerio(uid, titolo, chi(info) + dopo) };
}

/** Per chi viene approvato: toccandola, l'app si apre e il muro si toglie da solo. */
function messaggioApprovato() {
  return {
    notification: { title: 'Eurodex', body: "Accesso approvato: puoi usare l'app" },
    data: { tipo: 'approvato', eurodex_azione: 'accesso' },
    android: ANDROID,
  };
}

/** Per chi perde l'accesso (scelta di Valerio del 21/11): parte prima che i suoi dispositivi vengano tolti. */
function messaggioTolto() {
  return {
    notification: { title: 'Eurodex', body: 'Valerio ha tolto il tuo accesso a Eurodex' },
    data: { tipo: 'tolto', eurodex_azione: 'accesso' },
    android: ANDROID,
  };
}

/**
 * Cosa fare quando Valerio cambia lo stato di un account. I telefoni dell'account restano registrati: chi viene
 * rifiutato o perde l'accesso può ritentare, e se Valerio poi lo approva gli arriva la notifica (un account escluso
 * non riceve altro: non può scrivere eventi di sincronizzazione).
 */
function azioniCambioStato(prima, dopo) {
  const p = prima && prima.stato;
  const d = dopo && dopo.stato;
  if (!STATI.includes(d) || p === d) return [];
  if (d === 'revocato') return ['avvisa_tolto', 'chiudi_sessioni'];
  if (d === 'rifiutato') return ['chiudi_sessioni'];
  if (d === 'approvato') return ['avvisa_approvato'];
  return [];
}

/** I token da togliere dopo un invio: quelli che Cloud Messaging dice non più registrati. */
function tokenDaTogliere(tokens, risposte) {
  const via = [];
  (risposte || []).forEach((r, i) => {
    const codice = r && r.error && r.error.code;
    if (codice === 'messaging/registration-token-not-registered' || codice === 'messaging/invalid-registration-token') {
      via.push(tokens[i]);
    }
  });
  return via;
}

/** Invii che non devono dipendere l'uno dall'altro (argomento e token): partono tutti anche se uno dà errore, anche
 * subito, e alla fine l'errore si vede lo stesso, così resta nei log della funzione. Restituisce i risultati in ordine. */
async function inviiIndipendenti(invii) {
  const esiti = await Promise.allSettled(invii.map(async invio => invio()));
  const errori = esiti.filter(e => e.status === 'rejected').map(e => e.reason);
  if (errori.length === 1) throw errori[0];
  if (errori.length > 1) throw new AggregateError(errori, `${errori.length} invii su ${invii.length} non sono partiti`);
  return esiti.map(e => e.value);
}

/** L'amministratore: l'UID scritto in .env (lo stesso delle regole di Firestore). */
function amministratore(env) {
  const uid = String((env && env.ADMIN_UID) || '').trim();
  return /^[A-Za-z0-9]{20,64}$/.test(uid) ? uid : null;
}

module.exports = {
  STATI,
  UN_MINUTO,
  pulito,
  millis,
  datiSync,
  tokenDi,
  chi,
  messaggioRichiesta,
  dopoTentativo,
  messaggioApprovato,
  messaggioTolto,
  azioniCambioStato,
  tokenDaTogliere,
  inviiIndipendenti,
  amministratore,
};
