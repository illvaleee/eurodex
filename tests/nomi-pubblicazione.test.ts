import { describe, expect, it } from 'vitest';
import { nomiPubblicazione } from '../scripts/nomi-pubblicazione.mjs';
import { nomeFileDatiValido } from '../src/catalogo/nomi-dati';

// i nomi pubblicati devono passare il controllo delle app (R20): dalla 1.0.81 il numero ha al massimo 9 cifre
const passa = (n: string) => nomeFileDatiValido(`catalog-${n}.json`) && nomeFileDatiValido(`details-${n}.json`);
const LUNEDI = Date.UTC(2026, 10, 23, 16, 7);

describe('nomi dei file sulla pagina di download', () => {
  it('dati nuovi: i minuti dal 2020, che le app accettano', () => {
    const vecchio = {
      rev: 202611192255,
      file: { catalogo: 'catalog-202611192255.json', schede: 'details-202611192255.json' },
    };
    const { numero, tenere } = nomiPubblicazione('202611231607', vecchio, LUNEDI);
    expect(numero).toBe(String((LUNEDI - Date.UTC(2020, 0, 1)) / 60000));
    expect(passa(numero)).toBe(true);
    // i file dell'indice di prima restano, per chi l'ha appena letto (anche con i nomi vecchi a 12 cifre)
    expect(tenere).toEqual(['catalog-202611192255.json', 'details-202611192255.json']);
    // il rev vero (12 cifre) nel nome non passerebbe: è il guasto del 23/11
    expect(passa('202611231607')).toBe(false);
  });

  it('cresce a ogni pubblicazione e resta di 9 cifre per secoli', () => {
    const a = Number(nomiPubblicazione('1', null, LUNEDI).numero);
    const b = Number(nomiPubblicazione('2', null, LUNEDI + 60000).numero);
    expect(b).toBeGreaterThan(a);
    expect(passa(nomiPubblicazione('3', null, Date.UTC(3800, 0, 1)).numero)).toBe(true);
  });

  it('gli stessi dati già pubblicati: stessi nomi (una seconda pubblicazione non cambia niente)', () => {
    const pubblicato = {
      rev: 202611231607,
      file: { catalogo: 'catalog-3634567.json', schede: 'details-3634567.json' },
    };
    expect(nomiPubblicazione('202611231607', pubblicato, LUNEDI + 3600000).numero).toBe('3634567');
    // dati diversi: numero nuovo
    expect(nomiPubblicazione('202611301607', pubblicato, LUNEDI).numero).not.toBe('3634567');
    // stessi dati ma con i nomi vecchi a 12 cifre (che la 1.0.81 rifiuta): numero nuovo
    const vecchio = {
      rev: 202611231607,
      file: { catalogo: 'catalog-202611231607.json', schede: 'details-202611231607.json' },
    };
    expect(passa(nomiPubblicazione('202611231607', vecchio, LUNEDI).numero)).toBe(true);
  });

  it("dall'indice pubblicato si tengono solo nomi previsti", () => {
    const strano = { rev: 1, file: { catalogo: '../../etc/x.json', schede: 'details-1.json/../../x' } };
    expect(nomiPubblicazione('2', strano, LUNEDI).tenere).toEqual([]);
    for (const x of [null, 'testo', 42, { file: 'x' }, { file: { catalogo: 7 } }]) {
      const r = nomiPubblicazione('2', x, LUNEDI);
      expect(passa(r.numero)).toBe(true);
      expect(r.tenere).toEqual([]);
    }
  });
});
