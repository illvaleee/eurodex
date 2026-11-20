import { readFileSync } from 'node:fs';
import { costruisciIndice } from '../src/catalogo/indice';
import type { CatalogoGrezzo } from '../src/catalogo/tipi';

/** Il catalogo vero (www/data/catalog.json), indicizzato come nell'app. */
export function catalogoVero(opzioni = { noProof: false, noExtra: true }): CatalogoGrezzo {
  const cat = JSON.parse(readFileSync('www/data/catalog.json', 'utf8')) as CatalogoGrezzo;
  costruisciIndice(cat, opzioni);
  return cat;
}

/** Il valore, o un errore chiaro se manca (al posto di `!`, che nasconderebbe il problema). */
export function presente<T>(x: T | null | undefined, cosa = 'valore'): T {
  if (x == null) throw new Error(`manca: ${cosa}`);
  return x;
}
