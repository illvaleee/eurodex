/** Numeri, prezzi, date e plurali in italiano. */

export const numero = (n: number): string => n.toLocaleString('it-IT');

export function euro(v: number | null | undefined): string {
  if (v == null) return '';
  const cifre =
    v >= 100
      ? Math.round(v).toLocaleString('it-IT')
      : v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cifre} €`;
}

/** "1 moneta" / "3 monete". */
export const plurale = (n: number, uno: string, tanti: string): string => `${numero(n)} ${n === 1 ? uno : tanti}`;

/**
 * Percentuale da mostrare: "0%" solo se non c'è niente e "100%" solo se c'è tutto (come il grigio e il verde delle
 * sezioni); in mezzo l'arrotondamento resta tra 1 e 99 (799 su 800 non fa "100%", 1 su 800 non fa "0%").
 */
export function percentuale(o: number, t: number): number {
  if (t <= 0 || o <= 0) return 0;
  if (o >= t) return 100;
  return Math.min(99, Math.max(1, Math.round((o / t) * 100)));
}

export const oggiIso = (): string => new Date().toISOString().slice(0, 10);

export function giorniDa(data: string | number | null | undefined): number {
  if (!data) return Infinity;
  return (Date.now() - new Date(data).getTime()) / 864e5;
}

/** "oggi alle 10:42", "ieri alle 18:03", "12 nov alle 9:15". */
export function quando(ms: number | null | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  const oggi = new Date();
  const ieri = new Date(Date.now() - 864e5);
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === oggi.toDateString()) return `oggi alle ${ora}`;
  if (d.toDateString() === ieri.toDateString()) return `ieri alle ${ora}`;
  return `${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${ora}`;
}

/** Elenco breve: "a, b, c e altre 4". */
export function elencoBreve<T>(cose: readonly T[], nome: (x: T) => string, femminile = true): string {
  const primi = cose.slice(0, 3).map(nome).join(', ');
  if (cose.length === 4) return `${primi} e ${femminile ? "un'altra" : 'un altro'}`;
  if (cose.length > 4) return `${primi} e ${femminile ? 'altre' : 'altri'} ${cose.length - 3}`;
  return primi;
}
