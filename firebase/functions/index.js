// Il "postino" di Eurodex: quando un dispositivo modifica la collezione condivisa scrive un "evento";
// questa funzione lo vede subito e manda la notifica (push) a tutti i dispositivi collegati a quella
// collezione. Chi l'ha mandato la ignora (riconosce il proprio codice). Poi l'evento si cancella.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

exports.avvisaDispositivi = onDocumentCreated(
  { document: 'collezioni/{cid}/eventi/{eid}', region: 'europe-west1', maxInstances: 3, memory: '256MiB' },
  async ev => {
    const snap = ev.data;
    if (!snap) return;
    const d = snap.data() || {};
    const cid = ev.params.cid;
    if (!/^[A-Za-z0-9]{10,64}$/.test(cid) || !d.testo) {
      await snap.ref.delete().catch(() => {});
      return;
    }
    try {
      await getMessaging().send({
        topic: 'c_' + cid,
        data: {
          tipo: 'sync',
          cid,
          did: String(d.did || ''),
          nome: String(d.nome || 'un altro dispositivo').slice(0, 60),
          testo: String(d.testo).slice(0, 500),
          ts: String(d.ts || Date.now()),
        },
        android: { priority: 'high', ttl: 24 * 3600 * 1000 },
      });
    } finally {
      await snap.ref.delete().catch(() => {});
    }
  },
);
