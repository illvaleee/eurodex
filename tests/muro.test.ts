import { describe, expect, it } from 'vitest';
import { decidiMuro, indirizzoConfig, obbligoDaDocumento, pulitoPerRichiesta } from '../src/sync/muro-logica';

describe('muro: cosa vede chi apre l’app', () => {
  const base = { obbligo: true, uid: 'abc', admin: false, stato: 'nessuno' as const };

  it('muro spento: tutto aperto, per chiunque (anche senza accesso)', () => {
    for (const stato of ['nessuno', 'in_attesa', 'approvato', 'rifiutato', 'revocato'] as const)
      expect(decidiMuro({ ...base, obbligo: false, stato })).toBe('aperto');
    expect(decidiMuro({ ...base, obbligo: false, uid: null })).toBe('aperto');
  });

  it('muro acceso: senza accesso si accede, poi si chiede, si aspetta, si entra o si resta fuori', () => {
    expect(decidiMuro({ ...base, uid: null })).toBe('accedi');
    expect(decidiMuro(base)).toBe('chiedi');
    expect(decidiMuro({ ...base, stato: 'in_attesa' })).toBe('attesa');
    expect(decidiMuro({ ...base, stato: 'approvato' })).toBe('aperto');
    expect(decidiMuro({ ...base, stato: 'rifiutato' })).toBe('fuori');
    expect(decidiMuro({ ...base, stato: 'revocato' })).toBe('fuori');
  });

  it('Valerio entra sempre', () => {
    expect(decidiMuro({ ...base, admin: true })).toBe('aperto');
    expect(decidiMuro({ ...base, admin: true, stato: 'revocato' })).toBe('aperto');
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
