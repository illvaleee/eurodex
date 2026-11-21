import * as indice from './catalogo/indice';
import { opzioniIndice } from './collezione/ripristino';
import { applicaSfondo, fotoPerBackup, prendi, scegliFoto } from './ui/sfondo';
import * as collezione from './collezione/stato';
import { nativo } from './nativo/plugin';
import * as sync from './sync/sincronizzazione';
import { aggiornaMuro, muroAperto } from './sync/muro';
import { chiudiFoglio } from './ui/foglio';
import { tornaIndietro } from './ui/azioni';
import { avviso } from './ui/avvisi';
import { disegnaTutto, ridisegna, vai } from './ui/navigazione';
import { stato } from './ui/stato-ui';
import { mancantiFiltrate } from './viste/mancanti';
import { apriImpostazioni } from './viste/impostazioni';
import { apriScheda } from './viste/scheda-moneta';
import { propostaSincronizzazione } from './viste/finestre';

declare global {
  interface Window {
    __eurodex?: unknown;
  }
}

/**
 * Per le prove automatiche nel browser (prove/*.py): uno sguardo in sola lettura sullo stato dell'app e qualche
 * comando. Esiste solo nell'anteprima servita da http://localhost, mai nell'app installata.
 */
export function esponiPerLeProve(): void {
  if (nativo() || location.protocol !== 'http:' || location.hostname !== 'localhost') return;
  window.__eurodex = {
    get tipi() {
      return indice.tipi;
    },
    get pezzi() {
      return indice.pezzi;
    },
    get tuttiPezzi() {
      return indice.tuttiPezzi;
    },
    get pezzoPerChiave() {
      return indice.pezzoPerChiave;
    },
    get tipoPerId() {
      return indice.tipoPerId;
    },
    possedute: collezione.possedute,
    preferite: collezione.preferite,
    note: collezione.note,
    storico: collezione.storico,
    prefs: collezione.prefs,
    meta: collezione.meta,
    stato,
    get sync() {
      return sync.sync;
    },
    reteSync: sync.reteSyncProva,
    // il muro dell'accesso su approvazione: rilettura dell'interruttore (come al ritorno nell'app) e stato
    muro: { aggiorna: aggiornaMuro, aperto: muroAperto },
    salva: collezione.salva,
    sostituisci: collezione.sostituisci,
    tornaIndietro,
    disegnaTutto,
    avviso,
    serializza: collezione.serializza,
    ridisegna,
    vai,
    apriScheda,
    apriImpostazioni,
    propostaSincronizzazione,
    chiudiFoglio,
    mancantiFiltrate,
    applicaSfondo,
    fotoPerBackup,
    prendi,
    scegliFoto,
    ricostruisciIndice: () => {
      if (indice.catalogo) indice.costruisciIndice(indice.catalogo, opzioniIndice());
    },
  };
}
