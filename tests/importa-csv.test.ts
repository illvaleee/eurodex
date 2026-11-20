import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tuttiPezzi, tuttiTipi } from '../src/catalogo/indice';
import type { Pezzo } from '../src/catalogo/tipi';
import { abbina, leggiCsv, somiglianza } from '../src/collezione/importa-csv';
import { catalogoVero } from './aiuto';

describe('importazione dalla vecchia app (CSV)', () => {
  it('legge le colonne anche con il carattere iniziale di Excel', () => {
    const r = leggiCsv('﻿Paese;Anno;Valore;Segno;Titolo;Data aggiunta\nit;2002;1;R;-;2025-07-19\n');
    expect(r).toEqual([
      { cc: 'IT', y: 2002, v: 1, mint: 'R', title: '', date: '2025-07-19', raw: 'it;2002;1;R;-;2025-07-19' },
    ]);
  });

  it('rifiuta un file che non ha le colonne giuste', () => {
    expect(leggiCsv('nome,cognome\nmario,rossi')).toBeNull();
  });

  it('riconosce i temi anche scritti in modo diverso', () => {
    expect(somiglianza('30o anniversario della bandiera dell’UE', '30th anniversary of the EU flag')).toBeGreaterThan(
      0.2,
    );
  });

  it('sul file vero della vecchia app riconosce quasi tutte le monete', () => {
    catalogoVero();
    const righe = leggiCsv(readFileSync('prove/dati/esportazione-vecchia-app.csv', 'utf8'));
    expect(righe).not.toBeNull();
    if (!righe) return;
    const perTipo = new Map<string, Pezzo[]>();
    for (const p of tuttiPezzi) perTipo.set(p.t.id, [...(perTipo.get(p.t.id) ?? []), p]);
    const esito = abbina(
      righe,
      tuttiTipi.map(t => ({ ...t, pieces: perTipo.get(t.id) ?? [] })),
    );
    const riconosciute = righe.length - esito.nonTrovate.length;
    expect(riconosciute / righe.length).toBeGreaterThan(0.97);
    // Italia 1 cent 2002 senza segno: la moneta normale con la R, non l'errore di conio senza R
    const it2002 = righe.find(r => r.cc === 'IT' && r.y === 2002 && r.v === 1);
    if (it2002?.piece) expect(it2002.piece.m).not.toMatch(/senza/i);
  });
});
