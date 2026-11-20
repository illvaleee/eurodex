import { API_DOWNLOAD, RAW_DOWNLOAD } from './costanti';

/**
 * Legge un file piccolo pubblicato sulla pagina di download, sempre nella versione più recente.
 * La copia "raw" passa da una cache che per qualche minuto dopo una pubblicazione dà ancora la versione vecchia:
 * si prova prima l'API di GitHub (sempre aggiornata) e la copia raw resta come riserva.
 */
export async function leggiFresco<T>(nome: string, segnale?: AbortSignal): Promise<T> {
  try {
    const r = await fetch(`${API_DOWNLOAD}${nome}?ref=main&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github.raw' },
      signal: segnale ?? null,
    });
    if (r.ok) return (await r.json()) as T;
  } catch (e) {
    if (segnale?.aborted) throw e;
  }
  const r = await fetch(`${RAW_DOWNLOAD}${nome}?t=${Date.now()}`, { cache: 'no-store', signal: segnale ?? null });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Dove finisce il primo oggetto (o elenco) JSON completo di un testo, saltando le parentesi dentro le stringhe;
 * -1 se non ce n'è uno intero.
 */
export function fineDelPrimoJson(testo: string): number {
  let i = 0;
  while (i < testo.length && /\s|\uFEFF/.test(testo.charAt(i))) i++;
  if (testo.charAt(i) !== '{' && testo.charAt(i) !== '[') return -1;
  let profondita = 0;
  let inStringa = false;
  let escape = false;
  for (; i < testo.length; i++) {
    const c = testo.charAt(i);
    if (inStringa) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStringa = false;
    } else if (c === '"') inStringa = true;
    else if (c === '{' || c === '[') profondita++;
    else if (c === '}' || c === ']') {
      profondita--;
      if (profondita === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * JSON che potrebbe avere della spazzatura in fondo: un file salvato a metà, o riscritto senza essere accorciato
 * (in fondo resta la coda del file di prima, con le sue graffe). Si tiene il primo oggetto JSON intero.
 */
export function leggiJsonTollerante(testo: string): unknown {
  try {
    return JSON.parse(testo);
  } catch (e) {
    const fine = fineDelPrimoJson(testo);
    if (fine > 0) return JSON.parse(testo.slice(0, fine).replace(/^\uFEFF/, ''));
    throw e;
  }
}

export function casuale(n: number, alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return [...a].map(x => alfabeto[x % alfabeto.length] ?? '').join('');
}
