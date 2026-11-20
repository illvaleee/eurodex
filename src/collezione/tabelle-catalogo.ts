import type { CodiceTaglio, Pezzo } from '../catalogo/tipi';

/**
 * Il catalogo base (monete di circolazione da 1 cent a 2 euro, senza proof, commemorative e varianti) come tabelle
 * "anni × tagli", una per paese e, per la Germania, una per zecca: per ogni casella si sa se la moneta c'è nella
 * collezione, se manca o se non è mai stata coniata. Serve al PDF del catalogo (pdf-catalogo.ts); qui non c'è niente
 * di grafico, così si prova da solo (tests/tabelle-catalogo.test.ts).
 */

/** Colonne nell'ordine del foglio di carta: dalla moneta più grande alla più piccola. */
export const COLONNE: readonly CodiceTaglio[] = ['2e', '1e', '50c', '20c', '10c', '5c', '2c', '1c'];
export const INTESTAZIONI: readonly string[] = [
  '€ 2,00',
  '€ 1,00',
  '€ 0,50',
  '€ 0,20',
  '€ 0,10',
  '€ 0,05',
  '€ 0,02',
  '€ 0,01',
];

/** Zecche tedesche: il segno sulla moneta e la città. */
export const ZECCHE_GERMANIA: readonly (readonly [string, string])[] = [
  ['A', 'Berlino'],
  ['D', 'Monaco di Baviera'],
  ['F', 'Stoccarda'],
  ['G', 'Karlsruhe'],
  ['J', 'Amburgo'],
];

export const PRIMO_ANNO = 1999;

/**
 * - `ha`: ce l'hai (tutte le versioni di quell'anno, se ce n'è più d'una)
 * - `parte`: ne hai solo alcune (più versioni nello stesso anno, per esempio due incisori)
 * - `manca`: esiste ma non ce l'hai
 * - `mai`: in quell'anno non è stata coniata (anno già passato e nessuna moneta nel catalogo)
 * - `futura`: anno in corso o futuro senza monete nel catalogo: potrebbe ancora uscire, si lascia vuota
 */
export type StatoCella = 'ha' | 'parte' | 'manca' | 'mai' | 'futura';

export interface Cella {
  stato: StatoCella;
  hai: number;
  di: number;
}

export interface Tabella {
  cc: string;
  paese: string;
  zecca?: { lettera: string; citta: string };
  anni: number[];
  /** Una riga per anno, una cella per colonna (stesso ordine di COLONNE). */
  righe: Cella[][];
  hai: number;
  totale: number;
}

export interface DatiTabelle {
  pezzi: readonly Pezzo[];
  possedute: ReadonlySet<string>;
  ordinePaesi: readonly string[];
  nomePaese: (cc: string) => string;
  annoCorrente: number;
}

export const nelCatalogoBase = (p: Pezzo): boolean => !p.t.commem && !p.proof && !p.extra;

/** Anni delle tabelle: dal 1999 almeno fino al 2030 (come sul foglio), e sempre qualche anno oltre quello in corso. */
export function anniTabella(annoCorrente: number): number[] {
  const ultimo = Math.max(2030, annoCorrente + 4);
  return Array.from({ length: ultimo - PRIMO_ANNO + 1 }, (_, i) => PRIMO_ANNO + i);
}

function tabella(
  cc: string,
  paese: string,
  pezzi: readonly Pezzo[],
  d: DatiTabelle,
  zecca?: { lettera: string; citta: string },
): Tabella {
  const anni = anniTabella(d.annoCorrente);
  const perCasella = new Map<string, Pezzo[]>();
  for (const p of pezzi) {
    const k = `${String(p.y)}|${p.t.denom}`;
    perCasella.set(k, [...(perCasella.get(k) ?? []), p]);
  }
  const righe = anni.map(y =>
    COLONNE.map((denom): Cella => {
      const qui = perCasella.get(`${String(y)}|${denom}`) ?? [];
      if (!qui.length) return { stato: y < d.annoCorrente ? 'mai' : 'futura', hai: 0, di: 0 };
      const hai = qui.filter(p => d.possedute.has(p.key)).length;
      return { stato: hai === qui.length ? 'ha' : hai ? 'parte' : 'manca', hai, di: qui.length };
    }),
  );
  return {
    cc,
    paese,
    ...(zecca ? { zecca } : {}),
    anni,
    righe,
    hai: pezzi.filter(p => d.possedute.has(p.key)).length,
    totale: pezzi.length,
  };
}

export function tabelleCatalogo(d: DatiTabelle): Tabella[] {
  const base = d.pezzi.filter(nelCatalogoBase);
  const out: Tabella[] = [];
  for (const cc of d.ordinePaesi) {
    const delPaese = base.filter(p => p.t.cc === cc);
    if (!delPaese.length) continue;
    const paese = d.nomePaese(cc);
    if (cc === 'DE') {
      for (const [lettera, citta] of ZECCHE_GERMANIA)
        out.push(
          tabella(
            cc,
            paese,
            delPaese.filter(p => p.m === lettera),
            d,
            { lettera, citta },
          ),
        );
    } else out.push(tabella(cc, paese, delPaese, d));
  }
  return out;
}
