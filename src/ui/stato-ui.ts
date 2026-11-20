/** Stato dell'interfaccia (dove si è, filtri, schede aperte): non si salva, riparte a ogni apertura. */

export type Scheda = 'coll' | 'mine' | 'cat' | 'miss' | 'extra' | 'search';

export type Schermata =
  'country' | 'year' | 'denom' | 'commem' | 'cy' | 'news' | 'soon' | 'favs' | 'stats' | 'value' | 'hist';

export interface Livello {
  v: Schermata;
  cc?: string;
  y?: number;
  d?: string;
  /** Posizione nella pagina quando la si è lasciata, per ritrovarla tornando indietro. */
  sy?: number;
}

export interface VersioneDisponibile {
  code: number;
  version: string;
  apk?: string;
  size?: number;
  note?: string;
}

export interface FiltriCerca {
  cc: string;
  denom: string;
  from: number;
  to: number;
  stato: 'all' | 'own' | 'miss';
  tipo: 'all' | 'circ' | 'com';
  q: string;
  limit: number;
}

export interface FiltriMancanti {
  cc: string;
  denom: string;
  tipo: 'all' | 'rare' | 'proof' | 'noproof';
  limit: number;
}

export const stato = {
  tab: 'coll' as Scheda,
  stack: [] as Livello[],
  countryMode: 'taglio' as 'taglio' | 'anno',
  aperte: new Set<string>(),
  update: null as VersioneDisponibile | null,
  ex: { cc: 'all', denom: 'all', from: 0, to: 9999, stato: 'all', tipo: 'all', q: '', limit: 30 } as FiltriCerca,
  miss: { cc: 'all', denom: 'all', tipo: 'all', limit: 40 } as FiltriMancanti,
  qc: { cc: '', y: '', d: '' },
};

export const livelloAttuale = (): Livello | undefined => stato.stack[stato.stack.length - 1];
