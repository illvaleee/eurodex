import { describe, expect, it } from 'vitest';
import { elencoBreve, euro, percentuale, plurale } from '../src/core/formato';

describe('numeri e testi in italiano', () => {
  it('prezzi', () => {
    expect(euro(2.5)).toBe('2,50 €');
    expect(euro(12345)).toBe('12.345 €'); // in italiano le migliaia si separano da 5 cifre in su
    expect(euro(null)).toBe('');
  });
  it('plurali', () => {
    expect(plurale(1, 'moneta', 'monete')).toBe('1 moneta');
    expect(plurale(3, 'moneta', 'monete')).toBe('3 monete');
  });
  it('elenchi brevi', () => {
    expect(elencoBreve(['a', 'b', 'c', 'd'], x => x)).toBe("a, b, c e un'altra");
    expect(elencoBreve(['a', 'b', 'c', 'd', 'e', 'f'], x => x)).toBe('a, b, c e altre 3');
  });
});

describe('percentuale mostrata', () => {
  it('0% solo senza niente, 100% solo con tutto, in mezzo tra 1 e 99', () => {
    expect(percentuale(0, 0)).toBe(0);
    expect(percentuale(0, 150)).toBe(0);
    expect(percentuale(1, 150)).toBe(1);
    expect(percentuale(1, 800)).toBe(1);
    expect(percentuale(400, 800)).toBe(50);
    expect(percentuale(799, 800)).toBe(99);
    expect(percentuale(800, 800)).toBe(100);
  });
});
