import { describe, expect, it } from 'vitest';
import { fineDelPrimoJson, leggiJsonTollerante } from '../src/core/rete';

const backup = (n: number, nota = 'ok') =>
  JSON.stringify({ possedute: Array.from({ length: n }, (_, i) => `k${i}`), note: { a: nota } });

describe('lettura di un backup rovinato in fondo', () => {
  it('file intero', () => {
    expect((leggiJsonTollerante(backup(2)) as { possedute: string[] }).possedute).toHaveLength(2);
  });

  it('scrittura a metà con zeri in fondo', () => {
    expect((leggiJsonTollerante(backup(2) + '\u0000\u0000\u0000') as { possedute: string[] }).possedute).toHaveLength(
      2,
    );
  });

  it('riscritto senza accorciare: JSON nuovo più corto + coda di quello vecchio', () => {
    const nuovo = backup(2);
    const vecchio = backup(40);
    const file = nuovo + vecchio.slice(nuovo.length);
    expect((leggiJsonTollerante(file) as { possedute: string[] }).possedute).toHaveLength(2);
  });

  it('graffe e virgolette dentro le note non confondono', () => {
    const nuovo = backup(1, 'una } graffa, una { e una "virgoletta" \\ con barra');
    const file = nuovo + '}}}"]garbage{';
    expect((leggiJsonTollerante(file) as { note: { a: string } }).note.a).toBe(
      'una } graffa, una { e una "virgoletta" \\ con barra',
    );
  });

  it("con il segno BOM all'inizio", () => {
    expect((leggiJsonTollerante('﻿' + backup(3) + 'xx') as { possedute: string[] }).possedute).toHaveLength(3);
  });

  it('un file tagliato a metà resta illeggibile (niente dati inventati)', () => {
    expect(() => leggiJsonTollerante(backup(5).slice(0, 20))).toThrow();
    expect(fineDelPrimoJson('niente')).toBe(-1);
  });
});
