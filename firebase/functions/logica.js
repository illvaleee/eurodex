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

/** La notifica per Valerio quando arriva una richiesta di accesso. */
function messaggioRichiesta(uid, r) {
  const nome = String((r && r.nome) || 'Qualcuno').slice(0, 80);
  const email = String((r && r.email) || '').slice(0, 120);
  return {
    notification: { title: 'Richiesta di accesso a Eurodex', body: email ? `${nome} (${email})` : nome },
    data: { tipo: 'accesso', uid: String(uid) },
    android: { priority: 'high', ttl: 7 * 24 * 3600 * 1000 },
  };
}

/** Cosa fare quando Valerio cambia lo stato di un account. */
function azioniCambioStato(prima, dopo) {
  const p = prima && prima.stato;
  const d = dopo && dopo.stato;
  if (!STATI.includes(d) || p === d) return [];
  if (d === 'rifiutato' || d === 'revocato') return ['chiudi_sessioni', 'togli_dispositivi'];
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

/** L'amministratore: l'UID scritto in .env (lo stesso delle regole di Firestore). */
function amministratore(env) {
  const uid = String((env && env.ADMIN_UID) || '').trim();
  return /^[A-Za-z0-9]{20,64}$/.test(uid) ? uid : null;
}

module.exports = { STATI, datiSync, tokenDi, messaggioRichiesta, azioniCambioStato, tokenDaTogliere, amministratore };
