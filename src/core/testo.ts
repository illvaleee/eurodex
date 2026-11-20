const SPECIALI: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Per i file HTML costruiti a mano (lista da stampare): i caratteri speciali diventano testo. */
export function neutralizza(testo: string): string {
  return testo.replace(/[&<>"']/g, c => SPECIALI[c] ?? c);
}
