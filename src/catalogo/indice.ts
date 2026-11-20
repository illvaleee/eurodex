import { TAGLIO, isTaglio } from '../core/costanti';
import { termini } from '../core/traduzioni';
import { chiaviVarianti } from './extra';
import type { CatalogoGrezzo, PaeseGrezzo, Pezzo, Tipo } from './tipi';

/**
 * Il catalogo in memoria, con gli indici per trovare subito tipi e pezzi.
 * Con "Nascondi le monete proof" le proof spariscono da elenchi e conteggi, e con "Varianti solo nella scheda
 * Extra" spariscono le varianti, ma tutto resta nel catalogo completo (tuttiPezzi, pezzoPerChiave): quelle segnate
 * non si perdono e tornano quando si riaccende.
 */

export interface OpzioniIndice {
  noProof: boolean;
  noExtra: boolean;
}

export type Paese = PaeseGrezzo;

export let catalogo: CatalogoGrezzo | null = null;
/** Tipi con almeno un pezzo visibile. */
export let tipi: Tipo[] = [];
export let tipoPerId: Record<string, Tipo> = {};
/** Pezzi visibili (serie base, con o senza proof secondo le impostazioni). */
export let pezzi: Pezzo[] = [];
/** Tutti i tipi e tutti i pezzi, visibili o no. */
export let tuttiTipi: Tipo[] = [];
export let tuttiPezzi: Pezzo[] = [];
export let pezzoPerChiave: Record<string, Pezzo> = {};
export let chiaviPezzi = new Set<string>();
export let paesi: Record<string, Paese> = {};
export let ordinePaesi: string[] = [];
export let anni: number[] = [];

type Ascoltatore = () => void;
const ascoltatori: Ascoltatore[] = [];
/** Chi tiene risultati calcolati sul catalogo (elenchi, testi per la ricerca) li butta quando cambia. */
export function quandoCambiaIndice(f: Ascoltatore): void {
  ascoltatori.push(f);
}

export const visibile = (p: Pezzo, o: OpzioniIndice): boolean => !(o.noProof && p.proof) && !(o.noExtra && p.extra);

export function costruisciIndice(cat: CatalogoGrezzo, o: OpzioniIndice): void {
  catalogo = cat;
  const nuoviTipi: Tipo[] = [];
  const perId: Record<string, Tipo> = {};
  const visibili: Pezzo[] = [];
  const tutti: Pezzo[] = [];
  for (const raw of cat.types) {
    if (!raw.p.length || !isTaglio(raw.d)) continue;
    const t: Tipo = {
      id: String(raw.id),
      nid: raw.id,
      cc: raw.cc,
      denom: raw.d,
      commem: !!raw.c,
      title: raw.t,
      design: termini(raw.ti ?? raw.s),
      fn: !!raw.fn,
      fc: raw.fc ?? '',
      from: raw.y[0],
      to: raw.y[1],
      img: raw.img ?? null,
      pf: !!raw.pf,
      di: raw.di,
      ev: raw.ev ?? '',
      ed: raw.ed ?? '',
      n: raw.n ?? '',
      pieces: [],
      extras: [],
    };
    const varianti = chiaviVarianti(raw.p);
    for (const [key, y, m, proof, mint, n] of raw.p) {
      const p: Pezzo = {
        key,
        t,
        y,
        m: m ?? '',
        proof: !!proof,
        mint: mint ?? null,
        n: n ?? '',
        extra: varianti.has(key),
      };
      tutti.push(p);
      if (p.extra && !(o.noProof && p.proof)) t.extras.push(p);
      if (!visibile(p, o)) continue;
      t.pieces.push(p);
      visibili.push(p);
    }
    nuoviTipi.push(t);
    if (!t.pieces.length) continue;
    const anniTipo = t.pieces.map(p => p.y);
    t.from = Math.min(...anniTipo);
    t.to = Math.max(...anniTipo);
    perId[t.id] = t;
  }
  tuttiTipi = nuoviTipi;
  tipi = nuoviTipi.filter(t => t.pieces.length);
  tipoPerId = perId;
  pezzi = visibili;
  tuttiPezzi = tutti;
  pezzoPerChiave = Object.fromEntries(tutti.map(p => [p.key, p]));
  chiaviPezzi = new Set(tutti.map(p => p.key));
  const usati = new Set(tipi.map(t => t.cc));
  paesi = Object.fromEntries(cat.countries.filter(c => usati.has(c.cc)).map(c => [c.cc, c]));
  ordinePaesi = Object.keys(paesi).sort((a, b) => nomePaese(a).localeCompare(nomePaese(b), 'it'));
  anni = [...new Set(visibili.map(p => p.y))].sort((a, b) => a - b);
  for (const f of ascoltatori) f();
}

export const nomePaese = (cc: string): string => paesi[cc]?.name ?? cc;
export const bandiera = (cc: string): string => paesi[cc]?.flag ?? '';
export const paeseConBandiera = (cc: string): string => `${bandiera(cc)} ${nomePaese(cc)}`;

/** Chiave di un pezzo dopo un cambio di catalogo (pezzi raggruppati diversamente), se è cambiata. */
export function chiaveAttuale(k: string): string | undefined {
  if (chiaviPezzi.has(k)) return k;
  return catalogo?.alias?.[k];
}

export const taglioDi = (t: Tipo) => TAGLIO[t.denom];
