import { describe, expect, it } from 'vitest';
import { daMillisecondi, dopo, leggi, Orologio, scrivi } from '../src/sync/orologio';

describe('orologio logico ibrido', () => {
  it('scrive e rilegge un istante', () => {
    const s = scrivi({ ms: 1_763_600_000_000, c: 7, nodo: 'ABC123' });
    expect(leggi(s)).toEqual({ ms: 1_763_600_000_000, c: 7, nodo: 'ABC123' });
  });

  it("il confronto tra stringhe rispetta l'ordine nel tempo", () => {
    const a = scrivi({ ms: 1000, c: 5, nodo: 'Z' });
    const b = scrivi({ ms: 1001, c: 0, nodo: 'A' });
    expect(dopo(b, a)).toBe(true);
  });

  it("con l'ora ferma conta in avanti, senza mai tornare indietro", () => {
    let ora = 5000;
    const o = new Orologio('N1', undefined, () => ora);
    const x = o.segna();
    const y = o.segna();
    ora = 4000; // l'ora del telefono torna indietro
    const z = o.segna();
    expect(dopo(y, x)).toBe(true);
    expect(dopo(z, y)).toBe(true);
  });

  it("una modifica fatta dopo averne ricevuta una viene dopo, anche con l'ora sbagliata", () => {
    const avanti = new Orologio('TEL', undefined, () => 10_000_000); // telefono con l'ora avanti
    const indietro = new Orologio('TAB', undefined, () => 1_000); // tablet con l'ora indietro
    const daTelefono = avanti.segna();
    indietro.ricevi(daTelefono);
    const daTablet = indietro.segna();
    expect(dopo(daTablet, daTelefono)).toBe(true);
  });

  it('gli istanti delle versioni vecchie (millisecondi) si confrontano con quelli nuovi', () => {
    expect(dopo(daMillisecondi(2000, 'v1'), scrivi({ ms: 1999, c: 9, nodo: 'X' }))).toBe(true);
  });
});
