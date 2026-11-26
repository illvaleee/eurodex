import { Nativo, messaggio } from '../nativo/plugin';

/**
 * Versioni e catalogo dal server di Eurodex (Cloud Storage di Firebase), con la sessione della parte nativa: li danno
 * le regole di Storage solo agli account che possono usare Eurodex (docs/progetto-accesso-su-approvazione.md, §4.6 e
 * §9.4). Fino alla 1.0.83 arrivavano dalla pagina di download pubblica.
 */

/** Perché non si è letto: nessuna sessione nativa, permesso negato dalle regole, file assente, oppure la rete. */
export type MotivoArchivio = 'senzaSessione' | 'negato' | 'assente' | 'rete';

export class ErroreArchivio extends Error {
  constructor(
    readonly motivo: MotivoArchivio,
    testo: string,
  ) {
    super(testo);
    this.name = 'ErroreArchivio';
  }
}

/** Il codice che manda la parte nativa (Archivio.codice) diventa un motivo. */
export function motivoArchivio(e: unknown): MotivoArchivio {
  const codice = (e as { code?: unknown } | null)?.code;
  if (codice === 'SENZA_SESSIONE') return 'senzaSessione';
  if (codice === 'NEGATO') return 'negato';
  if (codice === 'ASSENTE') return 'assente';
  return 'rete';
}

const errore = (e: unknown): ErroreArchivio => new ErroreArchivio(motivoArchivio(e), messaggio(e));

/** version.json o l'indice del catalogo. Con `segnale` si smette di aspettare (la risposta poi si ignora). */
export async function leggiIndice<T>(
  percorso: 'rilasci/version.json' | 'dati/indice.json',
  segnale?: AbortSignal,
): Promise<T> {
  const lettura = Nativo.leggiArchivio({ percorso }).then(
    r => JSON.parse(r.testo) as T,
    (e: unknown) => {
      throw errore(e);
    },
  );
  if (!segnale) return lettura;
  return Promise.race([
    lettura,
    new Promise<never>((_, ko) => {
      const smetti = (): void => {
        ko(new ErroreArchivio('rete', 'troppo lento'));
      };
      if (segnale.aborted) smetti();
      else segnale.addEventListener('abort', smetti, { once: true });
    }),
  ]);
}

/** Un file del catalogo (`dati/…` su Storage) direttamente nei file dell'app (`file`, dentro dati/). */
export async function scaricaInFile(percorso: string, file: string): Promise<void> {
  try {
    await Nativo.scaricaArchivio({ percorso, file });
  } catch (e) {
    throw errore(e);
  }
}

/** Il nome dell'APK scritto in version.json, controllato prima di usarlo come percorso (null se non va bene). */
export const nomeApk = (v: { apk?: unknown } | null | undefined): string | null =>
  typeof v?.apk === 'string' && /^[A-Za-z0-9._-]{1,80}\.apk$/.test(v.apk) ? v.apk : null;
