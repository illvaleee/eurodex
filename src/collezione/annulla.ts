import type { VoceStorico } from './stato';

/**
 * "Annulla" di un'operazione su tutta la collezione (azzera, ripristino, importazione). Non rimette una fotografia di
 * prima: rimette com'era solo quello che l'operazione ha cambiato, e solo dove vale ancora quello che ci ha messo.
 * Così una moneta arrivata da un altro dispositivo mentre "Annulla" era toccabile resta (e non viene tolta a tutti).
 */

export interface FotoCollezione {
  possedute: readonly string[];
  preferite: readonly string[];
  note: Readonly<Record<string, string>>;
  storico: readonly VoceStorico[];
}

export interface CollezioneViva {
  possedute: Set<string>;
  preferite: Set<string>;
  note: Record<string, string>;
  storico: VoceStorico[];
}

/** Fotografia (le righe dello storico sono le stesse, non copie: servono a riconoscerle). */
export function fotografa(c: Readonly<CollezioneViva>): FotoCollezione {
  return { possedute: [...c.possedute], preferite: [...c.preferite], note: { ...c.note }, storico: [...c.storico] };
}

function annullaInsieme(adesso: Set<string>, prima: readonly string[], dopo: readonly string[]): void {
  const p = new Set(prima);
  const d = new Set(dopo);
  for (const k of new Set([...p, ...d])) {
    const eraPrima = p.has(k);
    const eraDopo = d.has(k);
    if (eraPrima === eraDopo) continue; // l'operazione non l'ha toccata
    if (adesso.has(k) !== eraDopo) continue; // cambiata di nuovo dopo l'operazione: resta com'è adesso
    if (eraPrima) adesso.add(k);
    else adesso.delete(k);
  }
}

export function annullaOperazione(prima: FotoCollezione, dopo: FotoCollezione, adesso: CollezioneViva): void {
  annullaInsieme(adesso.possedute, prima.possedute, dopo.possedute);
  annullaInsieme(adesso.preferite, prima.preferite, dopo.preferite);
  for (const k of new Set([...Object.keys(prima.note), ...Object.keys(dopo.note)])) {
    const p = prima.note[k] ?? '';
    const d = dopo.note[k] ?? '';
    if (p === d || (adesso.note[k] ?? '') !== d) continue;
    if (p) adesso.note[k] = p;
    else Reflect.deleteProperty(adesso.note, k);
  }
  // storico: quello di prima per intero (anche le righe che l'operazione ha fatto accorciare), più le righe arrivate
  // dopo l'operazione da altri dispositivi; via quelle aggiunte dall'operazione
  const inPrima = new Set(prima.storico);
  const inDopo = new Set(dopo.storico);
  const arrivate = adesso.storico.filter(r => !inPrima.has(r) && !inDopo.has(r));
  adesso.storico.splice(0, adesso.storico.length, ...prima.storico, ...arrivate);
}
