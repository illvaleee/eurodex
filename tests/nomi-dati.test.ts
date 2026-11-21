import { describe, expect, it } from 'vitest';
import { nomeFileDatiValido, nomeFotoValido, revisioneValida } from '../src/catalogo/nomi-dati';

describe("nomi dall'indice dei dati (R20)", () => {
  it('foto: solo img/<esadecimale>.webp', () => {
    expect(nomeFotoValido('img/00518fa9b0c99f.webp')).toBe(true);
    for (const x of [
      'img/../../shared_prefs/x.xml',
      '../x.webp',
      'img/ABC.webp',
      'img/0a.webp\n',
      'img/0a.webpx',
      'img/',
      '',
      5,
      null,
    ])
      expect(nomeFotoValido(x)).toBe(false);
  });

  it('catalogo e schede: solo catalog/details, con o senza numero', () => {
    for (const x of ['catalog.json', 'details.json', 'catalog-12.json', 'details-999999999.json'])
      expect(nomeFileDatiValido(x)).toBe(true);
    for (const x of ['../catalog-1.json', 'catalog-1.json?x', 'details-1234567890.json', 'altro.json', undefined])
      expect(nomeFileDatiValido(x)).toBe(false);
  });

  it('numero dei dati: intero non negativo', () => {
    expect(revisioneValida(0)).toBe(true);
    expect(revisioneValida(57)).toBe(true);
    for (const x of [-1, 1.5, Number.NaN, Infinity, '9', null]) expect(revisioneValida(x)).toBe(false);
  });
});
