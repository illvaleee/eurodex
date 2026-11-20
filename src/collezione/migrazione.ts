import { chiaveAttuale, chiaviPezzi } from '../catalogo/indice';
import { possedute, salva, storico } from './stato';

/**
 * Monete segnate con un codice che nel catalogo nuovo è cambiato (pezzi raggruppati diversamente): si spostano sul
 * pezzo giusto. Quelle che non si ritrovano restano salvate così come sono.
 */
export function spostaChiaviCambiate(): void {
  let spostate = 0;
  for (const k of [...possedute]) {
    const nuova = chiaveAttuale(k);
    if (!chiaviPezzi.has(k) && nuova) {
      possedute.delete(k);
      possedute.add(nuova);
      spostate++;
    }
  }
  for (const v of storico) {
    const nuova = chiaveAttuale(v[2]);
    if (!chiaviPezzi.has(v[2]) && nuova) v[2] = nuova;
  }
  if (spostate) salva();
}
