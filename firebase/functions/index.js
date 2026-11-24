// Il "postino" di Eurodex.
// - avvisaDispositivi: quando un dispositivo modifica la collezione condivisa scrive un "evento"; questa funzione lo
//   vede subito e manda la notifica (push) agli altri dispositivi di quell'account. Chi l'ha mandato la ignora
//   (riconosce il proprio codice). Poi l'evento si cancella.
// - tentativoDiAccesso: a ogni accesso con Google nell'app (un "tentativo") l'account nuovo diventa una richiesta in
//   attesa; quello già deciso resta com'è (approvato o rifiutato in automatico) e Valerio riceve la notifica.
// - avvisaValerio: a ogni richiesta di accesso nuova manda una notifica ai dispositivi di Valerio.
// - cambioDiStato: quando Valerio rifiuta o toglie l'accesso chiude le sessioni di quell'account (a chi perde
//   l'accesso arriva una notifica); quando lo approva lo avvisa.
// (docs/progetto-accesso-su-approvazione.md, §4.3, §4.5, §4.7. La logica sta in logica.js, provata con node --test.)
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const L = require('./logica');

initializeApp();
const OPZIONI = { region: 'europe-west1', maxInstances: 3, memory: '256MiB' };

async function dispositivi(uid) {
  return getFirestore().collection('accessi').doc(uid).collection('dispositivi').get();
}

/** Manda a tutti i dispositivi registrati di un account, e toglie i token che non esistono più. */
async function mandaAiDispositivi(uid, messaggio) {
  const snap = await dispositivi(uid);
  const tokens = L.tokenDi(snap.docs.map(d => d.data()));
  if (!tokens.length) return 0;
  const esito = await getMessaging().sendEachForMulticast({ ...messaggio, tokens });
  const via = new Set(L.tokenDaTogliere(tokens, esito.responses));
  await Promise.all(snap.docs.filter(d => via.has(d.data().token)).map(d => d.ref.delete().catch(() => {})));
  return esito.successCount;
}

exports.avvisaDispositivi = onDocumentCreated({ ...OPZIONI, document: 'collezioni/{cid}/eventi/{eid}' }, async ev => {
  const snap = ev.data;
  if (!snap) return;
  const d = snap.data() || {};
  const cid = ev.params.cid;
  if (!/^[A-Za-z0-9]{10,64}$/.test(cid) || !d.testo) {
    await snap.ref.delete().catch(() => {});
    return;
  }
  const data = L.datiSync(cid, d);
  const android = { priority: 'high', ttl: 24 * 3600 * 1000 };
  try {
    // le app fino alla 1.0.80 ascoltano l'argomento; quelle nuove ricevono sul proprio token (§4.5, passaggio)
    await getMessaging().send({ topic: 'c_' + cid, data, android });
    await mandaAiDispositivi(cid, { data, android });
  } finally {
    await snap.ref.delete().catch(() => {});
  }
});

exports.tentativoDiAccesso = onDocumentCreated({ ...OPZIONI, document: 'accessi/{uid}/tentativi/{tid}' }, async ev => {
  const snap = ev.data;
  if (!snap) return;
  const uid = ev.params.uid;
  const admin = L.amministratore(process.env);
  try {
    if (!admin || uid === admin) return;
    // nome ed email veri dell'account (non quelli che potrebbe scrivere l'app); account cancellato: niente
    const utente = await getAuth()
      .getUser(uid)
      .catch(() => null);
    if (!utente) return;
    const t = snap.data() || {};
    const info = { nome: utente.displayName, email: utente.email, dispositivo: t.dispositivo, motivo: t.motivo };
    const ref = getFirestore().collection('accessi').doc(uid);
    const ora = Date.now();
    const esito = await getFirestore().runTransaction(async tx => {
      const r = await tx.get(ref);
      const e = L.dopoTentativo(uid, r.exists ? r.data() : null, info, ora);
      const quando = { ultimoTentativo: FieldValue.serverTimestamp() };
      if (e.nuovo) {
        tx.create(ref, {
          ...e.campi,
          ...quando,
          richiesta: FieldValue.serverTimestamp(),
          avvisato: Timestamp.fromMillis(ora),
        });
      } else {
        tx.update(ref, { ...e.campi, ...quando, ...(e.notifica ? { avvisato: Timestamp.fromMillis(ora) } : {}) });
      }
      return e;
    });
    if (esito.notifica) await mandaAiDispositivi(admin, esito.notifica);
  } finally {
    await snap.ref.delete().catch(() => {});
  }
});

exports.avvisaValerio = onDocumentCreated({ ...OPZIONI, document: 'accessi/{uid}' }, async ev => {
  const admin = L.amministratore(process.env);
  const r = ev.data && ev.data.data();
  if (!admin || !r || r.stato !== 'in_attesa' || ev.params.uid === admin) return;
  await mandaAiDispositivi(admin, L.messaggioRichiesta(ev.params.uid, r));
});

exports.cambioDiStato = onDocumentUpdated({ ...OPZIONI, document: 'accessi/{uid}' }, async ev => {
  const uid = ev.params.uid;
  const azioni = L.azioniCambioStato(ev.data.before.data(), ev.data.after.data());
  // prima la notifica, poi le sessioni chiuse; i telefoni restano registrati (così riceve anche una nuova approvazione)
  if (azioni.includes('avvisa_tolto')) await mandaAiDispositivi(uid, L.messaggioTolto()).catch(() => 0);
  if (azioni.includes('chiudi_sessioni')) await getAuth().revokeRefreshTokens(uid);
  if (azioni.includes('avvisa_approvato')) await mandaAiDispositivi(uid, L.messaggioApprovato());
});
