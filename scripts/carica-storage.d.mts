export interface Voce {
  nome: string;
  sorgente: string;
  tipo: string;
  cache?: string;
  metadati?: Record<string, string>;
}

export interface Piano {
  carica: Voce[];
  cancella: string[];
}

export interface Contesto {
  bucket: string;
  token: string;
  fetch: (url: string, opzioni?: RequestInit) => Promise<Response>;
  aspetta?: (ms: number) => Promise<void>;
  /** l'indirizzo di Cloud Storage; senza, quello vero */
  api?: string;
}

export declare const md5: (dati: Uint8Array) => string;
export declare function indirizzoApi(env: Record<string, string | undefined>): string;
export declare function pianoApk(versione: unknown): Piano;
export declare function pianoVersione(versione: unknown, precedente: unknown, metaPrecedente: unknown): Piano;
export declare function controllaIndice(indice: unknown): void;
export declare function pianoDati(
  indice: unknown,
  precedente: unknown,
  metaPrecedente: unknown,
  adesso?: number,
): Piano & { stessi: boolean; numero: string; indice: Record<string, unknown> | null };
export declare function leggi(
  ctx: Contesto,
  nome: string,
): Promise<{ dati: unknown; metadati: Record<string, string> }>;
export declare function esegui(piano: Piano, ctx: Contesto, sorgente: (nome: string) => Uint8Array): Promise<void>;
export declare function principale(
  argomenti: string[],
  ambiente?: { fetch: Contesto['fetch']; env: Record<string, string | undefined>; aspetta?: Contesto['aspetta'] },
): Promise<void>;
