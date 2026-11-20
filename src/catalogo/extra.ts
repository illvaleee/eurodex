import type { PezzoGrezzo } from './tipi';

/**
 * Varianti "extra" (scheda Extra): errori di conio, lettera nella stella, stelle grandi/piccole, foglia piccola,
 * nuovo/vecchio lato comune, firme, bordi, segni e marchi diversi… I segni di zecca normali (A D F G J, R, M, FI…)
 * restano nella serie base. In ogni anno di una moneta resta sempre almeno un pezzo nella serie base: se sono tutti
 * varianti, si tiene il più "normale".
 */
export const VARIANTE =
  /stell[ae] (grandi|piccole)|lato comune|foglia piccola|più piccolo|KMB|errore|nella stella|in stella|firma (grande|media|piccola|dell)|bordo diverso|proof inverso|ape a (sinistra|destra)|\bmark\b|senza marchio|marchio di Parigi|senza F\b|segno|corno da caccia|variant|tipo [AB] \+ tipo|matte|mat inside|\(\d\)/i;

/** Quanto un pezzo è "normale" (più basso = più adatto a restare nella serie base). */
export function normalita(segno: string): number {
  if (/nella stella|in stella|errore/i.test(segno)) return 9;
  if (/senza/i.test(segno)) return 0;
  if (segno.includes('(1)')) return 1;
  return 5;
}

/** Chiavi dei pezzi di un tipo che sono varianti (vanno nella scheda Extra e non contano nella serie base). */
export function chiaviVarianti(pezzi: readonly PezzoGrezzo[]): Set<string> {
  const varianti = new Set<string>();
  const perAnno = new Map<string, { key: string; m: string }[]>();
  for (const [key, anno, segno, proof] of pezzi) {
    const gruppo = `${anno}|${proof ? 1 : 0}`;
    const elenco = perAnno.get(gruppo) ?? [];
    elenco.push({ key, m: segno ?? '' });
    perAnno.set(gruppo, elenco);
  }
  for (const elenco of perAnno.values()) {
    const extra = elenco.filter(p => p.m && VARIANTE.test(p.m));
    if (!extra.length) continue;
    if (extra.length === elenco.length) {
      const base = [...extra].sort((a, b) => normalita(a.m) - normalita(b.m))[0];
      if (base) extra.splice(extra.indexOf(base), 1);
    }
    for (const p of extra) varianti.add(p.key);
  }
  return varianti;
}
