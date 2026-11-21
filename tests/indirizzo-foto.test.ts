import { describe, expect, it } from 'vitest';
import { indirizzoFoto } from '../src/catalogo/dati';

describe('indirizzo delle foto del catalogo (R20, revisione di Claude 3)', () => {
  it('i nomi previsti diventano indirizzi locali', () => {
    expect(indirizzoFoto('img/00518fa9b0c99f.webp')).toBe('data/img/00518fa9b0c99f.webp');
  });

  it('indirizzi esterni o nomi strani: niente foto', () => {
    for (const x of [
      'https://esempio.it/x.webp',
      'http://x/y.webp',
      'data:image/png;base64,AAA',
      '../x.webp',
      'img/X.webp',
    ])
      expect(indirizzoFoto(x)).toBe('');
  });
});
