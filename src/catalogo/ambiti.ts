import { possedute, preferite, prefs } from '../collezione/stato';
import { pezzi, quandoCambiaIndice, tipoPerId } from './indice';
import { inArrivo } from './proprieta';
import type { Pezzo, Tipo } from './tipi';

/**
 * Gruppi di pezzi indicati con una stringa ("cc:IT", "year:2005", "type:123"…): servono ai contatori della pagina
 * (data-scope) e alla pressione lunga (segna tutto un gruppo). I risultati si tengono finché non cambia il catalogo.
 */
export function pezziDi(ambito: string): readonly Pezzo[] {
  const i = ambito.indexOf(':');
  const tipo = i < 0 ? ambito : ambito.slice(0, i);
  const v = i < 0 ? '' : ambito.slice(i + 1);
  const [a = '', b = ''] = v.split('/');
  switch (tipo) {
    case 'all':
      return pezzi;
    case 'cc':
      return pezzi.filter(p => p.t.cc === v);
    case 'type':
      return tipoPerId[v]?.pieces ?? [];
    case 'denom':
      return pezzi.filter(p => p.t.denom === v && !p.t.commem);
    case 'commem':
      return pezzi.filter(p => p.t.commem);
    case 'circ':
      return pezzi.filter(p => !p.t.commem);
    case 'cyear':
      return pezzi.filter(p => p.t.cc === a && !p.t.commem && p.y === +b);
    case 'ccy':
      return pezzi.filter(p => p.t.cc === a && p.y === +b);
    case 'year':
      return pezzi.filter(p => p.y === +v);
    case 'cyc':
      return pezzi.filter(p => p.t.commem && p.y === +a);
    case 'ccd':
      return pezzi.filter(p => p.t.cc === a && p.t.denom === b && !p.t.commem);
    case 'soon':
      return pezzi.filter(p => inArrivo(p.t));
    case 'fav':
      return pezzi.filter(p => preferite.has(p.t.id));
    default:
      return [];
  }
}

const memoria = new Map<string, readonly Pezzo[]>();
quandoCambiaIndice(() => {
  memoria.clear();
});

export function elenco(ambito: string): readonly Pezzo[] {
  let l = memoria.get(ambito);
  if (!l) {
    l = pezziDi(ambito);
    memoria.set(ambito, l);
  }
  return l;
}

/** [quanti ne hai, quanti sono]. */
export function avanzamento(lista: readonly Pezzo[]): [number, number] {
  let o = 0;
  for (const p of lista) if (possedute.has(p.key)) o++;
  return [o, lista.length];
}

export const tipoCompleto = (t: Tipo): boolean => t.pieces.every(p => possedute.has(p.key));
/** Con "Solo mancanti" i tipi che hai tutti spariscono. */
export const tipoDaMostrare = (t: Tipo): boolean => !prefs.onlyMissing || !tipoCompleto(t);
export const pezziDaMostrare = (ps: readonly Pezzo[]): readonly Pezzo[] =>
  prefs.onlyMissing ? ps.filter(p => !possedute.has(p.key)) : ps;
