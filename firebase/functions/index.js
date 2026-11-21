// Il "postino" di Eurodex.
// - avvisaDispositivi: quando un dispositivo modifica la collezione condivisa scrive un "evento"; questa funzione lo
//   vede subito e manda la notifica (push) agli altri dispositivi di quell'account. Chi l'ha mandato la ignora
//   (riconosce il proprio codice). Poi l'evento si cancella.
// - avvisaValerio: a ogni richiesta di accesso nuova manda una notifica ai dispositivi di Valerio.
// - cambioDiStato: quando Valerio rifiuta o toglie l'accesso chiude le sessioni di quell'account e ne toglie i
//   dispositivi; quando lo approva lo avvisa.
// (docs/progetto-accesso-su-approvazione.md, §4.3, §4.5, §4.7. La logica sta in logica.js, provata con node --test.)
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
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

exports.avvisaValerio = onDocumentCreated({ ...OPZIONI, document: 'accessi/{uid}' }, async ev => {
  const admin = L.amministratore(process.env);
  const r = ev.data && ev.data.data();
  if (!admin || !r || r.stato !== 'in_attesa' || ev.params.uid === admin) return;
  await mandaAiDispositivi(admin, L.messaggioRichiesta(ev.params.uid, r));
});

exports.cambioDiStato = onDocumentUpdated({ ...OPZIONI, document: 'accessi/{uid}' }, async ev => {
  const uid = ev.params.uid;
  const azioni = L.azioniCambioStato(ev.data.before.data(), ev.data.after.data());
  if (azioni.includes('chiudi_sessioni')) await getAuth().revokeRefreshTokens(uid);
  if (azioni.includes('togli_dispositivi')) {
    const snap = await dispositivi(uid);
    await Promise.all(snap.docs.map(d => d.ref.delete()));
  }
  if (azioni.includes('avvisa_approvato')) {
    await mandaAiDispositivi(uid, {
      notification: { title: 'Eurodex', body: "Accesso approvato: puoi usare l'app" },
      data: { tipo: 'approvato', eurodex_azione: 'accesso' },
    });
  }
});
