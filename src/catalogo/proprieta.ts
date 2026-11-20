import { GIORNI_NOVITA, TAGLIO, TIRATURA_RARA } from '../core/costanti';
import { giorniDa } from '../core/formato';
import { schede } from './dati';
import { bandiera } from './indice';
import type { Pezzo, Scheda, Tipo } from './tipi';

export const raro = (p: Pezzo): boolean => !p.proof && p.mint != null && p.mint > 0 && p.mint <= TIRATURA_RARA;
export const pezzoNuovo = (p: Pezzo): boolean => !!p.n && giorniDa(p.n) <= GIORNI_NOVITA;
export const tipoNuovo = (t: Tipo): boolean => !!t.n && giorniDa(t.n) <= GIORNI_NOVITA;

/** Moneta recente di cui la BCE non ha ancora pubblicato la foto ufficiale (al suo posto il disegno o la foto di Numista). */
export const inArrivo = (t: Tipo): boolean => (t.pf || t.fn) && t.from >= new Date().getFullYear() - (t.commem ? 2 : 1);
/** La BCE non pubblica la foto di questa versione della moneta. */
export const senzaFoto = (t: Tipo): boolean => t.pf && !inArrivo(t);

export const anni = (t: Tipo): string => (t.from === t.to ? `${t.from}` : `${t.from}–${t.to}`);
export const titoloTipo = (t: Tipo): string => (t.commem ? '2 euro commemorativo' : TAGLIO[t.denom].label);
export const nomeTipo = (t: Tipo): string => (t.commem ? t.design || t.title : TAGLIO[t.denom].label);
export const sottotitoloTipo = (t: Tipo): string => [t.commem ? '' : t.design, anni(t)].filter(Boolean).join(' · ');
export const etichettaPezzo = (p: Pezzo): string =>
  `${p.t.commem ? '2€ comm.' : TAGLIO[p.t.denom].short} ${p.y}${p.m ? ` ${p.m}` : ''}${p.proof ? ' proof' : ''}`;
export const etichettaConBandiera = (p: Pezzo): string =>
  `${bandiera(p.t.cc)} ${etichettaPezzo(p)}${p.t.commem && p.t.design ? ` (${p.t.design})` : ''}`;

export const schedaDi = (t: Tipo): Scheda | null => schede?.types[t.nid] ?? null;

/** Valore stimato in fior di conio (o nella conservazione migliore disponibile). */
export function prezzo(p: Pezzo): number | null {
  const pr = schedaDi(p.t)?.pi?.[p.key]?.pr;
  return pr ? (pr.unc ?? pr.au ?? pr.xf ?? null) : null;
}

export const VALORE_NOMINALE: Record<string, number> = {
  '1c': 0.01,
  '2c': 0.02,
  '5c': 0.05,
  '10c': 0.1,
  '20c': 0.2,
  '50c': 0.5,
  '1e': 1,
  '2e': 2,
};
