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

test("richiesta di accesso: prima l'email vera, poi nome e telefono, senza caratteri di controllo o di direzione", () => {
  const m = L.messaggioRichiesta('uid1', { nome: 'Mario', email: 'mario@example.com', dispositivo: 'Oppo Find X5' });
  assert.equal(m.notification.title, 'Richiesta di accesso a Eurodex');
  assert.equal(m.notification.body, 'mario@example.com · Mario · Oppo Find X5');
  assert.deepEqual(m.data, {
    tipo: 'accesso',
    uid: 'uid1',
    eurodex_azione: 'accessi',
    titolo: 'Richiesta di accesso a Eurodex',
    testo: 'mario@example.com · Mario · Oppo Find X5',
  });
  const finto = L.messaggioRichiesta('u', { nome: 'Mamma‮ (x)\n', email: 'sconosciuto@example.com' });
  assert.equal(finto.notification.body, 'sconosciuto@example.com · Mamma (x)');
  assert.equal(L.messaggioRichiesta('u', { nome: 'n'.repeat(300), email: '' }).notification.body.length, 80);
  assert.equal(L.messaggioRichiesta('u', null).notification.body, 'Qualcuno');
  // i dati di una notifica sono tutti testo (Cloud Messaging rifiuta il resto)
  for (const v of Object.values(m.data)) assert.equal(typeof v, 'string');
});

test('tentativo di un account nuovo: richiesta in attesa (la notifica la manda avvisaValerio)', () => {
  const e = L.dopoTentativo('u1', null, { nome: 'Lucia', email: 'lucia@example.com', dispositivo: 'Pixel 7' }, 1000);
  assert.equal(e.nuovo, true);
  assert.equal(e.notifica, null);
  assert.deepEqual(e.campi, {
    stato: 'in_attesa',
    nome: 'Lucia',
    email: 'lucia@example.com',
    dispositivo: 'Pixel 7',
    tentativi: 1,
  });
});

test('tentativo di un account già deciso: la decisione resta e Valerio lo sa', () => {
  const ora = 10 * L.UN_MINUTO;
  const chi = { nome: 'Mario', email: 'mario@example.com', dispositivo: 'Oppo' };
  const approvato = L.dopoTentativo('u1', { stato: 'approvato', tentativi: 2 }, chi, ora);
  assert.equal(approvato.nuovo, false);
  assert.equal(approvato.campi.stato, undefined, 'lo stato non si tocca');
  assert.equal(approvato.campi.tentativi, 3);
  assert.equal(approvato.notifica.notification.title, 'Accesso approvato in automatico');
  assert.equal(approvato.notifica.notification.body, 'mario@example.com · Mario · Oppo');
  assert.equal(approvato.notifica.data.eurodex_azione, 'accessi');
  for (const s of ['rifiutato', 'revocato']) {
    const e = L.dopoTentativo('u1', { stato: s }, chi, ora);
    assert.equal(e.campi.stato, undefined);
    assert.equal(e.notifica.notification.title, 'Accesso rifiutato in automatico');
  }
  const ancora = L.dopoTentativo('u1', { stato: 'rifiutato' }, { ...chi, motivo: 'ancora' }, ora);
  assert.equal(ancora.notifica.notification.body, 'mario@example.com · Mario · Oppo · ha chiesto di nuovo');
  const attesa = L.dopoTentativo('u1', { stato: 'in_attesa' }, chi, ora);
  assert.equal(attesa.notifica.notification.title, 'Richiesta di accesso a Eurodex');
  assert.equal(attesa.notifica.notification.body, 'mario@example.com · Mario · Oppo · ancora in attesa');
  // uno stato sconosciuto non diventa mai "approvato"
  const boh = L.dopoTentativo('u1', { stato: 'boh' }, chi, ora);
  assert.equal(boh.notifica.notification.title, 'Richiesta di accesso a Eurodex');
});

test("nome e telefono senza @: in grassetto e in cima resta solo l'email vera", () => {
  const e = L.dopoTentativo(
    'u1',
    null,
    {
      nome: 'Mamma (mamma.valerio@gmail.com)\u202e',
      email: 'sconosciuto@example.com',
      dispositivo: 'Pixel@7',
    },
    0,
  );
  assert.equal(e.campi.nome, 'Mamma (mamma.valeriogmail.com)');
  assert.equal(e.campi.dispositivo, 'Pixel7');
  assert.equal(e.campi.email, 'sconosciuto@example.com');
  assert.equal(L.dopoTentativo('u1', null, { nome: 'n'.repeat(300) }, 0).campi.nome.length, 80);
});

test('tentativi di fila: al massimo una notifica al minuto per account', () => {
  const chi = { email: 'mario@example.com' };
  const t0 = 100 * L.UN_MINUTO;
  const appena = L.dopoTentativo('u1', { stato: 'approvato', avvisato: t0 - 30 * 1000 }, chi, t0);
  assert.equal(appena.notifica, null);
  assert.equal(appena.campi.tentativi, 2, 'il tentativo si conta lo stesso');
  // Timestamp di Firestore (toMillis), Date e numeri valgono uguale
  const ts = { toMillis: () => t0 - 1000 };
  assert.equal(L.dopoTentativo('u1', { stato: 'approvato', avvisato: ts }, chi, t0).notifica, null);
  assert.equal(L.dopoTentativo('u1', { stato: 'approvato', avvisato: new Date(t0 - 1000) }, chi, t0).notifica, null);
  assert.ok(L.dopoTentativo('u1', { stato: 'approvato', avvisato: t0 - L.UN_MINUTO }, chi, t0).notifica);
  assert.ok(L.dopoTentativo('u1', { stato: 'approvato' }, chi, t0).notifica);
});

test("notifiche per chi è approvato e per chi perde l'accesso", () => {
  assert.deepEqual(L.messaggioApprovato().data, { tipo: 'approvato', eurodex_azione: 'accesso' });
  const t = L.messaggioTolto();
  assert.equal(t.notification.body, 'Valerio ha tolto il tuo accesso a Eurodex');
  assert.deepEqual(t.data, { tipo: 'tolto', eurodex_azione: 'accesso' });
});

test('cambio di stato: cosa fare', () => {
  assert.deepEqual(L.azioniCambioStato({ stato: 'approvato' }, { stato: 'revocato' }), [
    'avvisa_tolto',
    'chiudi_sessioni',
  ]);
  assert.deepEqual(L.azioniCambioStato({ stato: 'in_attesa' }, { stato: 'rifiutato' }), ['chiudi_sessioni']);
  assert.deepEqual(L.azioniCambioStato({ stato: 'in_attesa' }, { stato: 'approvato' }), ['avvisa_approvato']);
  assert.deepEqual(L.azioniCambioStato({ stato: 'rifiutato' }, { stato: 'approvato' }), ['avvisa_approvato']);
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

test('lo stesso amministratore nei quattro posti: regole di Firestore e di Storage, funzioni e app', () => {
  const regole = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const m = regole.match(/request\.auth\.uid == '([^']+)'/);
  assert.ok(m, "nelle regole manca l'UID dell'amministratore");
  const storage = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8');
  const s = storage.match(/request\.auth\.uid == '([^']+)'/g);
  assert.equal(s && s.length, 1, "in storage.rules l'UID dell'amministratore deve comparire una volta");
  assert.equal(s[0].match(/'([^']+)'/)[1], m[1]);
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const e = env.match(/^ADMIN_UID=(.*)$/m);
  assert.ok(e, 'in firebase/functions/.env manca ADMIN_UID');
  assert.equal(e[1].trim(), m[1]);
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'sync', 'accesso.ts'), 'utf8');
  const a = app.match(/UID_AMMINISTRATORE = '([^']+)'/);
  assert.ok(a, 'in src/sync/accesso.ts manca UID_AMMINISTRATORE');
  assert.equal(a[1], m[1]);
});

test("invii indipendenti: se l'argomento dà errore il token parte lo stesso, e viceversa", async () => {
  const partiti = [];
  const invio = (nome, esito) => async () => {
    partiti.push(nome);
    if (esito instanceof Error) throw esito;
    return esito;
  };
  assert.deepEqual(await L.inviiIndipendenti([invio('argomento', 'a'), invio('token', 2)]), ['a', 2]);
  assert.deepEqual(partiti, ['argomento', 'token']);

  const giu = new Error('argomento giù');
  partiti.length = 0;
  await assert.rejects(L.inviiIndipendenti([invio('argomento', giu), invio('token', 1)]), e => e === giu);
  assert.deepEqual(partiti, ['argomento', 'token']);
  partiti.length = 0;
  await assert.rejects(L.inviiIndipendenti([invio('argomento', 'a'), invio('token', giu)]), e => e === giu);
  assert.deepEqual(partiti, ['argomento', 'token']);

  // un errore subito, prima ancora della promessa (per esempio da getMessaging()): l'altro invio parte lo stesso
  partiti.length = 0;
  const subito = () => {
    partiti.push('argomento');
    throw new Error('subito');
  };
  await assert.rejects(L.inviiIndipendenti([subito, invio('token', 1)]), /subito/);
  assert.deepEqual(partiti, ['argomento', 'token']);

  // tutti e due giù: nell'errore ci sono tutti e due
  await assert.rejects(
    L.inviiIndipendenti([invio('argomento', new Error('uno')), invio('token', new Error('due'))]),
    e => e instanceof AggregateError && e.errors.map(x => x.message).join() === 'uno,due',
  );
});

test('avvisi del passo 5: solo version.json e indice.json fanno partire un avviso', () => {
  assert.equal(L.tipoNovita('rilasci/version.json'), 'versione');
  assert.equal(L.tipoNovita('dati/indice.json'), 'dati');
  for (const altro of [
    'rilasci/Eurodex-1.0.84.apk',
    'dati/catalog-123.json',
    'dati/img/a.webp',
    'version.json',
    'dati/indice.json.tmp',
    'rilasci/x/version.json',
    '',
    undefined,
  ]) {
    assert.equal(L.tipoNovita(altro), null, String(altro));
  }
});

test('avvisi del passo 5: gli stessi campi di invia-avviso.py, e niente avviso da un file sbagliato', () => {
  assert.deepEqual(L.datiNovita('versione', { code: 84, version: '1.0.84', note: 'Novità', apk: 'x.apk' }), {
    code: '84',
    version: '1.0.84',
    note: 'Novità',
  });
  assert.deepEqual(L.datiNovita('versione', { code: '85', version: '1.0.85' }), {
    code: '85',
    version: '1.0.85',
    note: '',
  });
  assert.deepEqual(L.datiNovita('dati', { rev: 202611301234, schema: 2, note: '3 monete nuove', file: {} }), {
    tipo: 'dati',
    rev: '202611301234',
    schema: '2',
    note: '3 monete nuove',
  });
  assert.equal(L.datiNovita('dati', { rev: 5 }).schema, '1');
  // testo da fuori: niente caratteri di controllo o di direzione, e lunghezza limitata
  assert.equal(L.datiNovita('dati', { rev: 5, note: 'a‮b\u0000c' + 'x'.repeat(900) }).note.length, 500);
  assert.ok(!/[‮\u0000]/.test(L.datiNovita('dati', { rev: 5, note: 'a‮b\u0000c' }).note));
  for (const [tipo, v] of [
    ['versione', { version: '1.0.84' }],
    ['versione', { code: 0, version: '1.0.84' }],
    ['versione', { code: 84 }],
    ['versione', { code: 84.5, version: '1.0.84' }],
    ['dati', { rev: 'ieri' }],
    ['dati', { rev: -1 }],
    ['dati', null],
    ['altro', { rev: 5 }],
  ]) {
    assert.equal(L.datiNovita(tipo, v), null, JSON.stringify([tipo, v]));
  }
});

test('avvisi del passo 5: ricevono gli stessi account che possono usare Eurodex', () => {
  const accessi = [
    { uid: 'approvato1', stato: 'approvato' },
    { uid: 'attesa1', stato: 'in_attesa' },
    { uid: 'rifiutato1', stato: 'rifiutato' },
    { uid: 'tolto1', stato: 'revocato' },
    { uid: 'senzastato' },
    null,
    { stato: 'approvato' },
  ];
  // muro acceso: Valerio e gli approvati
  assert.deepEqual(L.destinatariNovita(accessi, true, 'valerio').sort(), ['approvato1', 'valerio']);
  // muro spento: tutti tranne gli esclusi
  assert.deepEqual(L.destinatariNovita(accessi, false, 'valerio').sort(), [
    'approvato1',
    'attesa1',
    'senzastato',
    'valerio',
  ]);
  // senza amministratore in .env non si inventa niente, e Valerio non compare due volte
  assert.deepEqual(L.destinatariNovita(accessi, true, null), ['approvato1']);
  assert.deepEqual(L.destinatariNovita([{ uid: 'valerio', stato: 'approvato' }], true, 'valerio'), ['valerio']);
  assert.deepEqual(L.destinatariNovita(undefined, true, null), []);
});

test('avvisi del passo 5: la funzione sta nella regione del bucket e scarica solo i due file', () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(index, /exports\.avvisaNovita = onObjectFinalized\(\s*\{ bucket: BUCKET, region: REGIONE_BUCKET/);
  assert.match(index, /const REGIONE_BUCKET = 'us-central1';/);
  const google = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'native', 'google-services.json'), 'utf8'),
  );
  const bucket = index.match(/const BUCKET = '([^']+)'/);
  assert.equal(bucket && bucket[1], google.project_info.storage_bucket);
  // il file si scarica solo dopo aver visto che è uno dei due che fanno partire un avviso
  const corpo = index.slice(index.indexOf('exports.avvisaNovita'));
  assert.ok(corpo.indexOf('L.tipoNovita(') < corpo.indexOf('.download()'));
});
