import { beforeEach, describe, expect, it } from 'vitest';
import {
  eAmministratore,
  richiestaDa,
  ricordaStato,
  statoValido,
  UID_AMMINISTRATORE,
  ultimoStato,
} from '../src/sync/accesso';

describe('accesso su approvazione: le parti senza rete', () => {
  beforeEach(() => localStorage.clear());

  it('solo gli stati previsti, tutto il resto vale "nessuno"', () => {
    expect(statoValido('approvato')).toBe('approvato');
    expect(statoValido('in_attesa')).toBe('in_attesa');
    expect(statoValido('rifiutato')).toBe('rifiutato');
    expect(statoValido('revocato')).toBe('revocato');
    expect(statoValido('promosso')).toBe('nessuno');
    expect(statoValido(undefined)).toBe('nessuno');
    expect(statoValido(1)).toBe('nessuno');
  });

  it("la sezione dell'amministratore solo per il suo UID", () => {
    expect(eAmministratore(UID_AMMINISTRATORE)).toBe(true);
    expect(eAmministratore('qualcun-altro')).toBe(false);
    expect(eAmministratore(null)).toBe(false);
    expect(eAmministratore('')).toBe(false);
  });

  it('una richiesta letta dal database: campi controllati e accorciati', () => {
    const r = richiestaDa('u1', {
      stato: 'in_attesa',
      nome: 'x'.repeat(200),
      email: 'mario@example.com',
      dispositivo: 5,
      richiesta: { toDate: () => new Date(0) },
      nota: 'n'.repeat(500),
    });
    expect(r).toMatchObject({ uid: 'u1', stato: 'in_attesa', email: 'mario@example.com', dispositivo: '' });
    expect(r.nome).toHaveLength(80);
    expect(r.nota).toHaveLength(200);
    expect(r.richiesta?.getTime()).toBe(0);
    expect(r.decisione).toBeNull();
    expect(richiestaDa('u2', { stato: 'boh' }).stato).toBe('nessuno');
    const finta = richiestaDa('u3', { nome: 'Mamma\u202e\n(x)', dispositivo: 'Pixel\u200b 6', nota: 'a\tb' });
    expect([finta.nome, finta.dispositivo, finta.nota]).toEqual(['Mamma(x)', 'Pixel 6', 'ab']);
  });

  it("l'ultimo stato conosciuto vale solo per lo stesso account", () => {
    expect(ultimoStato('u1')).toBe('nessuno');
    ricordaStato('u1', 'approvato');
    expect(ultimoStato('u1')).toBe('approvato');
    expect(ultimoStato('u2')).toBe('nessuno');
    localStorage.setItem('eurodex.accesso', '{rotto');
    expect(ultimoStato('u1')).toBe('nessuno');
    localStorage.setItem('eurodex.accesso', JSON.stringify({ uid: 'u1', stato: 'promosso' }));
    expect(ultimoStato('u1')).toBe('nessuno');
  });
});
