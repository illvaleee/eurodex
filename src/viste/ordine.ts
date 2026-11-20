import { nomePaese, bandiera, ordinePaesi } from '../catalogo/indice';
import { prezzo } from '../catalogo/proprieta';
import type { Pezzo } from '../catalogo/tipi';
import type { Ordinamento } from '../collezione/stato';
import { ORDINE_TAGLI, TAGLIO } from '../core/costanti';

export const ORDINAMENTI: readonly [Ordinamento, string][] = [
  ['paese', 'Paese'],
  ['anno', 'Anno'],
  ['taglio', 'Taglio'],
  ['rari', 'Più rare'],
  ['valore', 'Valore'],
];

const posizioneTaglio = (p: Pezzo) => ORDINE_TAGLI.indexOf(p.t.denom);

export function ordina(ps: readonly Pezzo[], come: Ordinamento): Pezzo[] {
  const indicePaese = Object.fromEntries(ordinePaesi.map((c, i) => [c, i]));
  const base = (a: Pezzo, b: Pezzo) =>
    (indicePaese[a.t.cc] ?? 0) - (indicePaese[b.t.cc] ?? 0) ||
    Number(a.t.commem) - Number(b.t.commem) ||
    posizioneTaglio(a) - posizioneTaglio(b) ||
    a.y - b.y ||
    Number(a.proof) - Number(b.proof) ||
    a.m.localeCompare(b.m);
  const s = [...ps];
  if (come === 'anno') s.sort((a, b) => b.y - a.y || base(a, b));
  else if (come === 'taglio')
    s.sort((a, b) => posizioneTaglio(a) - posizioneTaglio(b) || Number(a.t.commem) - Number(b.t.commem) || base(a, b));
  else if (come === 'rari') s.sort((a, b) => (a.mint ?? 1e12) - (b.mint ?? 1e12) || base(a, b));
  else if (come === 'valore') s.sort((a, b) => (prezzo(b) ?? -1) - (prezzo(a) ?? -1) || base(a, b));
  else s.sort(base);
  return s;
}

/** Gruppo in cui va un pezzo nelle liste raggruppate: [chiave, titolo]. */
export function gruppo(p: Pezzo, come: Ordinamento): [string, string] {
  if (come === 'anno') return [`y${p.y}`, String(p.y)];
  if (come === 'taglio')
    return p.t.commem ? ['dcomm', '2 euro commemorativi'] : [`d${p.t.denom}`, TAGLIO[p.t.denom].label];
  if (come === 'rari' || come === 'valore') return ['all', ''];
  return [`c${p.t.cc}`, `${bandiera(p.t.cc)} ${nomePaese(p.t.cc)}`];
}

export interface Gruppo {
  chiave: string;
  titolo: string;
  n: number;
  tipi: Map<string, Pezzo[]>;
}

/** Raggruppa (nell'ordine in cui arrivano) i pezzi per gruppo e, dentro, per tipo. */
export function raggruppa(ps: readonly Pezzo[], come: Ordinamento): Gruppo[] {
  const gruppi: Gruppo[] = [];
  const perChiave = new Map<string, Gruppo>();
  for (const p of ps) {
    const [chiave, titolo] = gruppo(p, come);
    let g = perChiave.get(chiave);
    if (!g) {
      g = { chiave, titolo, n: 0, tipi: new Map() };
      perChiave.set(chiave, g);
      gruppi.push(g);
    }
    g.n++;
    g.tipi.set(p.t.id, [...(g.tipi.get(p.t.id) ?? []), p]);
  }
  return gruppi;
}
