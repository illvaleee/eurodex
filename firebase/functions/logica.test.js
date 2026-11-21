// Prove della logica delle funzioni: node --test firebase/functions (nessun emulatore, nessuna rete).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./logica');

test('notifica di sincronizzazione: stessi campi di sempre, testi accorciati', () => {
  const d = L.datiSync('abcdefghij12', { did: 7, nome: 'x'.repeat(100), testo: 'y'.repeat(900), ts: 5 });
  assert.deepEqual(Object.keys(d).sort(), ['cid', 'did', 'nome', 'testo', 'tipo', 'ts']);
  assert.equal(d.tipo, 'sync');
  assert.equal(d.did, '7');
  assert.equal(d.nome.length, 60);
  assert.equal(d.testo.length, 500);
  assert.equal(L.datiSync('abcdefghij12', { testo: 'ciao' }).nome, 'un altro dispositivo');
});

test('token: solo quelli validi, senza doppioni', () => {
  const buono = 'f'.repeat(40);
  const t = L.tokenDi([
    { token: buono },
    { token: buono },
    { token: 'corto' },
    { token: 5 },
    {},
    null,
    { token: 'a'.repeat(5000) },
  ]);
  assert.deepEqual(t, [buono]);
});

test('richiesta di accesso: notifica con nome ed email, testi limitati', () => {
  const m = L.messaggioRichiesta('uid1', { nome: 'Mario', email: 'mario@example.com' });
  assert.equal(m.notification.body, 'Mario (mario@example.com)');
  assert.deepEqual(m.data, { tipo: 'accesso', uid: 'uid1' });
  assert.equal(L.messaggioRichiesta('u', { nome: 'n'.repeat(300) }).notification.body.length, 80);
  assert.equal(L.messaggioRichiesta('u', null).notification.body, 'Qualcuno');
});

test('cambio di stato: cosa fare', () => {
  assert.deepEqual(L.azioniCambioStato({ stato: 'approvato' }, { stato: 'revocato' }), [
    'chiudi_sessioni',
    'togli_dispositivi',
  ]);
  assert.deepEqual(L.azioniCambioStato({ stato: 'in_attesa' }, { stato: 'rifiutato' }), [
    'chiudi_sessioni',
    'togli_dispositivi',
  ]);
  assert.deepEqual(L.azioniCambioStato({ stato: 'in_attesa' }, { stato: 'approvato' }), ['avvisa_approvato']);
  assert.deepEqual(L.azioniCambioStato({ stato: 'approvato' }, { stato: 'approvato', nota: 'x' }), []);
  assert.deepEqual(L.azioniCambioStato({ stato: 'approvato' }, { stato: 'boh' }), []);
  assert.deepEqual(L.azioniCambioStato(undefined, { stato: 'approvato' }), ['avvisa_approvato']);
});

test('token da togliere: solo quelli che Cloud Messaging dice non registrati', () => {
  const tokens = ['a', 'b', 'c', 'd'];
  const risposte = [
    { success: true },
    { success: false, error: { code: 'messaging/registration-token-not-registered' } },
    { success: false, error: { code: 'messaging/internal-error' } },
    { success: false, error: { code: 'messaging/invalid-registration-token' } },
  ];
  assert.deepEqual(L.tokenDaTogliere(tokens, risposte), ['b', 'd']);
});

test('amministratore: solo un UID valido', () => {
  assert.equal(L.amministratore({ ADMIN_UID: 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4' }), 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4');
  assert.equal(L.amministratore({ ADMIN_UID: 'UID_DI_VALERIO' }), null);
  assert.equal(L.amministratore({ ADMIN_UID: "x' || true" }), null);
  assert.equal(L.amministratore({}), null);
});

test('lo stesso amministratore nelle regole di Firestore e nelle funzioni', () => {
  const regole = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const m = regole.match(/request\.auth\.uid == '([^']+)'/);
  assert.ok(m, "nelle regole manca l'UID dell'amministratore");
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const e = env.match(/^ADMIN_UID=(.*)$/m);
  assert.ok(e, 'in firebase/functions/.env manca ADMIN_UID');
  assert.equal(e[1].trim(), m[1]);
});
