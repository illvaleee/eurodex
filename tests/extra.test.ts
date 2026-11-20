import { describe, expect, it } from 'vitest';
import { chiaviVarianti, normalita } from '../src/catalogo/extra';
import { pezzi, tipi, tuttiPezzi } from '../src/catalogo/indice';
import type { PezzoGrezzo } from '../src/catalogo/tipi';
import { catalogoVero } from './aiuto';

describe('varianti (scheda Extra)', () => {
  it('riconosce errori di conio, stelle e lettere nella stella', () => {
    const ps: PezzoGrezzo[] = [
      ['a', 2002, 'A'],
      ['b', 2002, 'errore di conio'],
      ['c', 2003, ''],
      ['d', 2003, 'stelle grandi'],
    ];
    expect([...chiaviVarianti(ps)].sort()).toEqual(['b', 'd']);
  });

  it('in ogni anno resta almeno un pezzo nella serie base (il più normale)', () => {
    const ps: PezzoGrezzo[] = [
      ['x', 2010, 'lettera nella stella'],
      ['y', 2010, 'senza segno'],
    ];
    const v = chiaviVarianti(ps);
    expect(v.has('y')).toBe(false);
    expect(v.has('x')).toBe(true);
    expect(normalita('senza segno')).toBeLessThan(normalita('lettera nella stella'));
  });

  it('i segni di zecca normali (A D F G J) restano nella serie base', () => {
    const ps: PezzoGrezzo[] = ['A', 'D', 'F', 'G', 'J'].map((m, i) => [`k${i}`, 2004, m]);
    expect(chiaviVarianti(ps).size).toBe(0);
  });

  it('sul catalogo vero: le varianti escono dalla serie base ma restano nel catalogo completo', () => {
    catalogoVero({ noProof: false, noExtra: true });
    const varianti = tuttiPezzi.filter(p => p.extra);
    expect(varianti.length).toBeGreaterThan(50);
    expect(pezzi.some(p => p.extra)).toBe(false);
    // la Grecia con la lettera nella stella è una variante
    expect(varianti.some(p => p.t.cc === 'GR' && /nella stella/i.test(p.m))).toBe(true);
    // nessun tipo resta senza pezzi visibili
    expect(tipi.every(t => t.pieces.length > 0)).toBe(true);
    catalogoVero({ noProof: false, noExtra: false });
    expect(pezzi.length).toBe(tuttiPezzi.length);
  });
});
