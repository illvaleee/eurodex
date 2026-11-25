import { describe, expect, it } from 'vitest';
import {
  arrivato,
  decidiMuro,
  esitoTentativo,
  FINESTRA_PRESTO,
  indirizzoConfig,
  obbligoDaDocumento,
  pulitoPerRichiesta,
} from '../src/sync/muro-logica';

describe('muro: cosa vede chi apre l’app', () => {
  const base = { obbligo: true, uid: 'abc', admin: false, stato: 'nessuno' as const };

  it('muro spento: tutti dentro (anche senza accesso), tranne chi Valerio ha rifiutato o tolto', () => {
    for (const stato of ['nessuno', 'in_attesa', 'approvato'] as const)
      expect(decidiMuro({ ...base, obbligo: false, stato })).toBe('aperto');
    expect(decidiMuro({ ...base, obbligo: false, uid: null })).toBe('aperto');
    expect(decidiMuro({ ...base, obbligo: false, stato: 'rifiutato' })).toBe('fuori');
    expect(decidiMuro({ ...base, obbligo: false, stato: 'revocato' })).toBe('tolto');
    // uscito dall'account: con il muro spento si usa l'app senza account, come prima
    expect(decidiMuro({ ...base, obbligo: false, uid: null, stato: 'revocato' })).toBe('aperto');
  });

  it('muro acceso: senza accesso si accede, poi si aspetta, si entra o si resta fuori', () => {
    expect(decidiMuro({ ...base, uid: null })).toBe('accedi');
    expect(decidiMuro({ ...base, uid: null, stato: 'approvato' })).toBe('accedi');
    expect(decidiMuro(base)).toBe('chiedi');
    // il tentativo è partito: la richiesta sta arrivando, si aspetta (niente «Chiedi l'accesso» per un attimo)
    expect(decidiMuro({ ...base, inviato: true })).toBe('attesa');
    expect(decidiMuro({ ...base, stato: 'in_attesa' })).toBe('attesa');
    expect(decidiMuro({ ...base, stato: 'approvato' })).toBe('aperto');
    expect(decidiMuro({ ...base, stato: 'approvato', inviato: true })).toBe('aperto');
    expect(decidiMuro({ ...base, stato: 'rifiutato' })).toBe('fuori');
    expect(decidiMuro({ ...base, stato: 'revocato' })).toBe('tolto');
    // chi è fuori e chiede di nuovo resta fuori finché Valerio non decide
    expect(decidiMuro({ ...base, stato: 'rifiutato', inviato: true })).toBe('fuori');
  });

  it('Valerio entra sempre', () => {
    for (const obbligo of [true, false]) {
      expect(decidiMuro({ ...base, obbligo, admin: true })).toBe('aperto');
      expect(decidiMuro({ ...base, obbligo, admin: true, stato: 'revocato' })).toBe('aperto');
    }
  });
});

describe('muro: l’interruttore letto dal server', () => {
  it('acceso solo con obbligatorio = true', () => {
    expect(obbligoDaDocumento({ fields: { obbligatorio: { booleanValue: true } } })).toBe(true);
    for (const x of [
      { fields: { obbligatorio: { booleanValue: false } } },
      { fields: { obbligatorio: { stringValue: 'true' } } },
      { fields: {} },
      {},
      null,
      'true',
    ])
      expect(obbligoDaDocumento(x)).toBe(false);
  });

  it('server vero nell’app, emulatore solo nelle prove nel browser', () => {
    const vero = indirizzoConfig('?emulatori=localhost:9099:8080', true);
    expect(vero).toMatch(/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/collezione-euro-24ecd\//);
    expect(vero).toContain('/documents/config/accesso?key=');
    expect(indirizzoConfig('', false)).toBe(vero);
    expect(indirizzoConfig('?emulatori=localhost:9099:8080', false)).toBe(
      'http://localhost:8080/v1/projects/collezione-euro-24ecd/databases/(default)/documents/config/accesso',
    );
  });

  it('nell’APK gli emulatori solo con la proprietà di adb, e sempre quelli del telefono simulato', () => {
    const vero = indirizzoConfig('', true);
    // senza la proprietà l'indirizzo della pagina non conta mai
    expect(indirizzoConfig('?emulatori=cattivo.example:1:2', true, false)).toBe(vero);
    expect(indirizzoConfig('?emulatori=cattivo.example:1:2', true, true)).toBe(
      'http://10.0.2.2:8080/v1/projects/collezione-euro-24ecd/databases/(default)/documents/config/accesso',
    );
  });
});

describe('muro: nome e telefono nella richiesta', () => {
  it('niente @ né caratteri di controllo o di direzione (le regole li rifiutano), al massimo 80 caratteri', () => {
    expect(pulitoPerRichiesta(' Mario Rossi ')).toBe('Mario Rossi');
    expect(pulitoPerRichiesta('Mamma (mamma@x.it)')).toBe('Mamma (mammax.it)');
    expect(pulitoPerRichiesta('Mario‮\nRossi')).toBe('MarioRossi');
    expect(pulitoPerRichiesta('x'.repeat(100))).toHaveLength(80);
    expect(pulitoPerRichiesta('Lucìa Pérez 🪙')).toBe('Lucìa Pérez 🪙');
  });
});

describe('muro: come finisce un tentativo di accesso', () => {
  it('rimandato (già scritto) conta come scritto; senza rete non è scritto', () => {
    expect(esitoTentativo('already-exists', Infinity)).toBe('ok');
    expect(esitoTentativo(undefined, 0)).toBe('no');
    expect(esitoTentativo('unavailable', 0)).toBe('no');
    expect(esitoTentativo('deadline-exceeded', 0)).toBe('no');
  });
  it('rifiutato dalle regole: «troppo presto» solo poco dopo un tentativo scritto da questa app', () => {
    expect(esitoTentativo('permission-denied', 3000)).toBe('presto');
    expect(esitoTentativo('permission-denied', FINESTRA_PRESTO - 1)).toBe('presto');
    // più tardi (o mai scritto da qui: sessione non più valida, regola cambiata) non è arrivato niente
    expect(esitoTentativo('permission-denied', FINESTRA_PRESTO)).toBe('rifiutato');
    expect(esitoTentativo('permission-denied', Date.now())).toBe('rifiutato');
  });
  it('arrivato: scritto adesso o pochi secondi fa', () => {
    expect([arrivato('ok'), arrivato('presto'), arrivato('rifiutato'), arrivato('no')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
