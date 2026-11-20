/**
 * Orologio logico ibrido (HLC, Kulkarni et al. 2014): dice quale tra due modifiche è venuta dopo anche se i
 * dispositivi hanno l'ora sbagliata o sono stati offline. Ogni istante è [millisecondi, contatore, dispositivo]:
 * segue l'ora vera quando può, e quando l'ora di un dispositivo è indietro conta in avanti senza mai tornare
 * indietro. Scritto come testo ordinabile, così due istanti si confrontano con un semplice confronto tra stringhe.
 */

export interface Istante {
  ms: number;
  c: number;
  nodo: string;
}

const LUNGHEZZA_MS = 9; // in base 36 bastano fino all'anno 5188
const LUNGHEZZA_C = 4;

export function scrivi(i: Istante): string {
  return `${i.ms.toString(36).padStart(LUNGHEZZA_MS, '0')}-${i.c.toString(36).padStart(LUNGHEZZA_C, '0')}-${i.nodo}`;
}

export function leggi(s: string): Istante | null {
  const m = /^([0-9a-z]{9})-([0-9a-z]{4})-([A-Za-z0-9_]+)$/.exec(s);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return { ms: parseInt(m[1], 36), c: parseInt(m[2], 36), nodo: m[3] };
}

/** Istante "da ora vera" senza contatore (per le modifiche arrivate dalle versioni vecchie, che usavano i ms). */
export const daMillisecondi = (ms: number, nodo: string): string => scrivi({ ms, c: 0, nodo });

/** Il più avanti dei due (a parità vince il dispositivo con il nome più alto: tutti arrivano allo stesso risultato). */
export const dopo = (a: string, b: string): boolean => a > b;

export class Orologio {
  private ultimo: { ms: number; c: number };

  constructor(
    private readonly nodo: string,
    stato?: { ms: number; c: number },
    private readonly adesso: () => number = Date.now,
  ) {
    this.ultimo = stato ?? { ms: 0, c: 0 };
  }

  get stato(): { ms: number; c: number } {
    return { ...this.ultimo };
  }

  /** Istante di una modifica fatta qui. */
  segna(): string {
    const pt = this.adesso();
    if (pt > this.ultimo.ms) this.ultimo = { ms: pt, c: 0 };
    else this.ultimo = { ms: this.ultimo.ms, c: this.ultimo.c + 1 };
    return scrivi({ ...this.ultimo, nodo: this.nodo });
  }

  /** Arrivata una modifica da un altro dispositivo: l'orologio la "vede" e non andrà mai prima di lei. */
  ricevi(s: string): void {
    const r = leggi(s);
    if (!r) return;
    const pt = this.adesso();
    const ms = Math.max(this.ultimo.ms, r.ms, pt);
    let c: number;
    if (ms === this.ultimo.ms && ms === r.ms) c = Math.max(this.ultimo.c, r.c) + 1;
    else if (ms === this.ultimo.ms) c = this.ultimo.c + 1;
    else if (ms === r.ms) c = r.c + 1;
    else c = 0;
    this.ultimo = { ms, c };
  }
}
