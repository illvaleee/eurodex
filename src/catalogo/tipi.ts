/** Formato dei dati del catalogo (data/catalog.json, prodotto da scripts/fetch-catalog.mjs) e modello in memoria. */

export type CodiceTaglio = '1c' | '2c' | '5c' | '10c' | '20c' | '50c' | '1e' | '2e';
export type Metallo = 'cu' | 'au' | 'bi1' | 'bi2';
export type Faccia = 'nat' | 'common';

/** Pezzo come sta nel file: [chiave, anno, segno, proof, tiratura, data di prima comparsa]. */
export type PezzoGrezzo = [string, number, string?, (0 | 1 | boolean)?, (number | null)?, string?];

export interface TipoGrezzo {
  id: number;
  cc: string;
  d: string;
  c?: 0 | 1 | boolean;
  t: string;
  ti?: string;
  s?: string;
  fn?: boolean;
  fc?: string;
  y: [number, number];
  img?: [string | null, string | null] | null;
  pf?: boolean;
  di?: number;
  ev?: string;
  ed?: string;
  n?: string;
  p: PezzoGrezzo[];
}

export interface PaeseGrezzo {
  cc: string;
  name: string;
  flag: string;
}

export interface CatalogoGrezzo {
  v: number;
  generated: string;
  source?: string;
  countries: PaeseGrezzo[];
  types: TipoGrezzo[];
  alias?: Record<string, string>;
  /** Descrizioni ufficiali della BCE (i tipi le indicano con `di`). */
  ds?: string[];
  /** Anni dei commemorativi con una pagina BCE in italiano o in inglese. */
  ecbPagine?: { it: number[]; en: number[] };
}

export interface Tipo {
  id: string;
  nid: number;
  cc: string;
  denom: CodiceTaglio;
  commem: boolean;
  title: string;
  design: string;
  fn: boolean;
  fc: string;
  from: number;
  to: number;
  img: [string | null, string | null] | null;
  pf: boolean;
  di: number | undefined;
  ev: string;
  ed: string;
  n: string;
  pieces: Pezzo[];
  extras: Pezzo[];
}

export interface Pezzo {
  key: string;
  t: Tipo;
  y: number;
  m: string;
  proof: boolean;
  mint: number | null;
  n: string;
  extra: boolean;
}

export interface Taglio {
  k: CodiceTaglio;
  label: string;
  short: string;
  num: string;
  unit: 'CENT' | 'EURO';
  metal: Metallo;
}

export type Conservazione = 'g' | 'vg' | 'f' | 'vf' | 'xf' | 'au' | 'unc';

export interface InfoPezzo {
  /** Prezzi stimati per conservazione. */
  pr?: Partial<Record<Conservazione, number>>;
  /** Data della stima. */
  pa?: string;
  /** Note sulla coniazione e sulla variante. */
  c?: string;
  v?: string;
}

export interface Lato {
  d?: string;
  l?: string;
  lt?: string;
  a?: string;
}

/** Scheda completa di una moneta (data/details.json): si carica solo quando serve. */
export interface Scheda {
  pi?: Record<string, InfoPezzo>;
  se?: string;
  ct?: string;
  tg?: string[];
  ob?: Lato;
  rv?: Lato;
  ed?: Lato;
  me?: string;
  w?: number;
  dia?: number;
  th?: number;
  sh?: string;
  tec?: string;
  or?: string;
  ru?: string;
  mi?: string[];
  ie?: string;
  dm?: string;
  rf?: string;
  co?: string;
  rl?: number[];
}

export interface Schede {
  types: Record<string, Scheda>;
  grades?: Conservazione[];
}
