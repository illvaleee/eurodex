import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { oggiIso } from '../core/formato';
import { leggiJsonTollerante } from '../core/rete';
import { Nativo, messaggio, nativo } from '../nativo/plugin';
import { fotoPerBackup } from '../ui/sfondo';
import { meta, possedute, prefs, quandoSalvato, salvaMeta, serializza, type FrequenzaDrive } from './stato';

/**
 * La collezione resta sul telefono, con tre livelli di backup:
 * 1) file interno incluso nel backup automatico di Android su Google Drive;
 * 2) un file scelto dall'utente (es. su Google Drive) aggiornato dall'app con la frequenza scelta;
 * 3) copie giornaliere degli ultimi 7 giorni sul telefono.
 */

export const FREQUENZE_DRIVE: readonly [FrequenzaDrive, string, number][] = [
  ['sempre', 'A ogni modifica', 0],
  ['giorno', 'Ogni giorno', 864e5],
  ['settimana', 'Ogni settimana', 7 * 864e5],
  ['mese', 'Ogni mese', 30 * 864e5],
];

export function driveDovuto(): boolean {
  const f = FREQUENZE_DRIVE.find(x => x[0] === (prefs.driveFreq ?? 'sempre')) ?? FREQUENZE_DRIVE[0];
  return !meta.driveAt || Date.now() - meta.driveAt >= (f?.[2] ?? 0) - 60_000;
}

const NOME_COPIA = /^\d{4}-\d{2}-\d{2}\.json$/;

export async function copieGiornaliere(): Promise<string[]> {
  try {
    const r = await Filesystem.readdir({ path: 'copie', directory: Directory.Data });
    return r.files
      .map(f => f.name)
      .filter(n => NOME_COPIA.test(n))
      .sort();
  } catch {
    return [];
  }
}

export async function leggiCopia(nome: string): Promise<string> {
  const r = await Filesystem.readFile({ path: `copie/${nome}`, directory: Directory.Data, encoding: Encoding.UTF8 });
  return r.data as string;
}

/** Il salvataggio in corso (null se non ce n'è). */
let corrente: Promise<void> | null = null;
/** Arrivata un'altra richiesta mentre se ne salvava una: appena finito si risalva (con le modifiche nuove). */
let ancora = false;
let forzaAncora = false;
// letto da una funzione: cambia mentre si aspetta la scrittura dei file
const daRifare = (): boolean => ancora;

/** Salva la collezione nei file; la promessa finisce quando anche le modifiche arrivate nel frattempo sono salvate. */
export function backupNativo(forza = false): Promise<void> {
  if (!nativo()) return Promise.resolve();
  if (corrente) {
    ancora = true;
    forzaAncora ||= forza;
    return corrente;
  }
  corrente = (async () => {
    try {
      let f = forza;
      do {
        ancora = false;
        await unBackup(f);
        f = forzaAncora;
        forzaAncora = false;
      } while (daRifare());
    } finally {
      corrente = null;
    }
  })();
  return corrente;
}

async function unBackup(forza: boolean): Promise<void> {
  const salvatoAllaCopia = meta.saved;
  const testo = serializza(fotoPerBackup());
  try {
    // livello 1: file interno (rientra nel backup automatico di Android)
    await Filesystem.writeFile({
      path: 'collezione.json',
      data: testo,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    // livello 3: una copia al giorno, si tengono le ultime 7
    await Filesystem.writeFile({
      path: `copie/${oggiIso()}.json`,
      data: testo,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    const copie = await copieGiornaliere();
    for (const n of copie.slice(0, Math.max(0, copie.length - 7)))
      await Filesystem.deleteFile({ path: `copie/${n}`, directory: Directory.Data });
  } catch {
    // memoria piena: restano le copie di prima e il file su Drive
  }
  // livello 2: file scelto dall'utente (Google Drive), con la frequenza scelta se ci sono modifiche nuove
  if (meta.drive && (forza || ((meta.driveSporco || !meta.driveAt) && driveDovuto()))) {
    try {
      await Nativo.scrivi({ testo });
      meta.driveAt = Date.now();
      meta.driveErr = '';
      // modifiche fatte mentre si scriveva il file: non sono dentro, quindi il file resta da aggiornare
      meta.driveSporco = meta.saved !== salvatoAllaCopia;
    } catch (e) {
      meta.driveErr = messaggio(e).slice(0, 120);
    }
    salvaMeta();
  }
}

/** Collezione vuota all'avvio (app reinstallata): si riprende dal file interno, se Android l'ha rimesso. */
export async function leggiFileInterno(): Promise<unknown> {
  if (!nativo() || possedute.size) return null;
  try {
    const r = await Filesystem.readFile({
      path: 'collezione.json',
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return leggiJsonTollerante(r.data as string);
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** A ogni modifica il backup nei file parte dopo un attimo (le modifiche ravvicinate si salvano insieme). */
export function attivaBackupAutomatico(): void {
  quandoSalvato(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void backupNativo(), 2500);
  });
}

/** L'app va in secondo piano: si salva subito. */
export function backupSubito(): void {
  clearTimeout(timer);
  void backupNativo();
}
