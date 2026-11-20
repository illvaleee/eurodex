import { dati, datiGiaScaricati, scaricaDatiNuovi } from '../catalogo/dati';
import { costruisciIndice } from '../catalogo/indice';
import type { CatalogoGrezzo } from '../catalogo/tipi';
import { spostaChiaviCambiate } from '../collezione/migrazione';
import { opzioniIndice } from '../collezione/ripristino';
import { meta, salva } from '../collezione/stato';
import { Nativo, nativo } from '../nativo/plugin';
import { catalogoAggiornato, firmaCatalogo } from '../viste/finestre';
import { avviso } from './avvisi';
import { ridisegna, verificaSchermata } from './navigazione';

/** Catalogo arrivato senza installare una versione nuova: si usa subito e si dice cosa c'è di nuovo. */

function usa(cat: CatalogoGrezzo, nota: string): void {
  const prima = firmaCatalogo();
  costruisciIndice(cat, opzioniIndice());
  spostaChiaviCambiate();
  verificaSchermata();
  ridisegna();
  confermaAlTelefono();
  catalogoAggiornato(prima, nota);
  meta.datiVista = dati.rev;
  salva();
}

/** Il telefono smette di avvisare di questi dati (la notifica "catalogo aggiornato" è già arrivata). */
export function confermaAlTelefono(): void {
  if (nativo()) Nativo.datiApplicati({ rev: dati.rev }).catch(() => undefined);
}

/** Controlla se sono stati pubblicati dati nuovi e, se sì, li scarica e li usa. Vero se è arrivato qualcosa. */
export async function aggiornaDatiOra(manuale: boolean): Promise<boolean> {
  const esito = await scaricaDatiNuovi();
  if (esito.tipo === 'nuovi') {
    usa(esito.catalogo, esito.indice.note ?? '');
    return true;
  }
  if (esito.tipo === 'foto') ridisegna();
  if (esito.tipo === 'serveAppNuova' && manuale) avviso("Per i dati nuovi serve la versione nuova dell'app");
  return false;
}

/** Dati già scaricati dal telefono ad app chiusa (dopo la notifica): si usano. Vero se c'erano. */
export async function usaDatiGiaScaricati(): Promise<boolean> {
  const cat = await datiGiaScaricati();
  if (!cat) return false;
  usa(cat, dati.note);
  return true;
}
