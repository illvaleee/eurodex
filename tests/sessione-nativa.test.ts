import { beforeEach, describe, expect, it, vi } from 'vitest';

// la parte nativa finta: ogni prova dice cosa risponde Google, una chiamata alla volta
const risposte: (object | Error)[] = [];
const chiamate: unknown[] = [];
const uscite = vi.fn(() => Promise.resolve());

const errore = (code: string, message = code): Error => Object.assign(new Error(message), { code });

vi.mock('../src/nativo/plugin', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/nativo/plugin')>()),
  nativo: () => true,
  Nativo: {
    accediGoogle: (o: unknown) => {
      chiamate.push(o);
      const r = risposte.shift();
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    esciNativo: () => uscite(),
  },
}));

const { apriSessioneNativa } = await import('../src/sync/sessione-nativa');

describe('«Un ultimo passo»: la sessione nativa con lo stesso account della parte web', () => {
  beforeEach(() => {
    risposte.length = 0;
    chiamate.length = 0;
    uscite.mockClear();
  });

  it("con l'account già autorizzato basta il tentativo in silenzio, che porta l'email attesa", async () => {
    risposte.push({ uidNativo: 'u1' });
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('ok');
    expect(chiamate).toEqual([{ silenzioso: true, email: 'a@example.com' }]);
    expect(uscite).not.toHaveBeenCalled();
  });

  it('senza account autorizzati si apre la finestra di Google', async () => {
    risposte.push(errore('NESSUN_ACCOUNT'), { uidNativo: 'u1' });
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('ok');
    expect(chiamate).toEqual([
      { silenzioso: true, email: 'a@example.com' },
      { silenzioso: false, email: 'a@example.com' },
    ]);
  });

  it('se in silenzio arriva un altro account si sceglie nella finestra, e quello sbagliato non entra mai', async () => {
    risposte.push(errore('ALTRO_ACCOUNT'), errore('ALTRO_ACCOUNT'));
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('altroAccount');
    expect(chiamate).toHaveLength(2);
    // la parte nativa ha rifiutato prima di accedere: non c'è nessuna sessione da chiudere
    expect(uscite).not.toHaveBeenCalled();

    risposte.push(errore('ALTRO_ACCOUNT'), { uidNativo: 'u1' });
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('ok');
  });

  it('un uid diverso, se arriva lo stesso, non si tiene (secondo lucchetto)', async () => {
    risposte.push({ uidNativo: 'u2' });
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('altroAccount');
    expect(uscite).toHaveBeenCalledTimes(1);
  });

  it('annullato, nessun account e sessione non aperta', async () => {
    risposte.push(errore('ANNULLATO', 'annullato'));
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('annullato');
    risposte.push(errore('NESSUN_ACCOUNT'), errore('NESSUN_ACCOUNT'));
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('nessunAccount');
    risposte.push({ uidNativo: '' });
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('errore');
    risposte.push(errore('RETE', 'Network error'));
    expect(await apriSessioneNativa('u1', 'a@example.com')).toBe('errore');
  });
});
