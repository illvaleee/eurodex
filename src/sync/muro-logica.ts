import type { StatoAccesso } from './accesso';

/**
 * Il muro dell'accesso su approvazione, solo le decisioni (senza Firebase, così si provano da sole). Il muro vero
 * sono le regole di Firestore: qui si decide soltanto cosa mostrare, e un'app modificata non ottiene niente di più.
 */

export type EsitoMuro = 'aperto' | 'accedi' | 'chiedi' | 'attesa' | 'fuori' | 'tolto';

/**
 * Cosa vede chi apre l'app (scelte di Valerio del 21/11):
 * - muro spento: tutti dentro, tranne gli account rifiutati (fuori) o a cui ha tolto l'accesso (tolto);
 * - muro acceso: dentro solo gli approvati e Valerio; gli altri vedono la schermata per accedere, quella di
 *   attesa o il no. `inviato`: il tentativo di questo account è appena partito, quindi la richiesta sta arrivando.
 */
export function decidiMuro(o: {
  obbligo: boolean;
  uid: string | null;
  admin: boolean;
  stato: StatoAccesso;
  inviato?: boolean;
}): EsitoMuro {
  if (o.admin) return 'aperto';
  const no: EsitoMuro | null = o.stato === 'revocato' ? 'tolto' : o.stato === 'rifiutato' ? 'fuori' : null;
  if (!o.obbligo) return o.uid && no ? no : 'aperto';
  if (!o.uid) return 'accedi';
  if (o.stato === 'approvato') return 'aperto';
  if (no) return no;
  if (o.stato === 'in_attesa' || o.inviato) return 'attesa';
  return 'chiedi';
}

/** Il documento config/accesso letto con l'API REST di Firestore: acceso solo con obbligatorio = true. */
export function obbligoDaDocumento(j: unknown): boolean {
  const campi = (j as { fields?: { obbligatorio?: { booleanValue?: unknown } } } | null)?.fields;
  return campi?.obbligatorio?.booleanValue === true;
}

const PROGETTO = 'collezione-euro-24ecd';
const CHIAVE_PUBBLICA = 'AIzaSyDiDVmvLgHGt9vDgGlzx4C6d5Yf06xXX8o'; // la stessa di firebase.ts (è dentro ogni APK)

/**
 * Dove leggere l'interruttore: il server vero, oppure l'emulatore di Firestore nelle prove nel browser
 * (`?emulatori=host:portaAuth:portaDb`, come in firebase.ts; mai nell'app installata).
 */
export function indirizzoConfig(ricerca: string, inApp: boolean): string {
  const percorso = `projects/${PROGETTO}/databases/(default)/documents/config/accesso`;
  const e = inApp ? null : new URLSearchParams(ricerca).get('emulatori');
  if (e) {
    const [host = 'localhost', , portaDb = '8080'] = e.split(':');
    return `http://${host}:${portaDb}/v1/${percorso}`;
  }
  return `https://firestore.googleapis.com/v1/${percorso}?key=${CHIAVE_PUBBLICA}`;
}

/** Il telefono nel tentativo: le regole rifiutano @ e caratteri di controllo o di direzione. */
export const pulitoPerRichiesta = (x: string): string =>
  x
    .replace(/[@\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, 80);

/** Come finisce un tentativo di accesso, dal codice dell'errore di Firestore (nessun errore: scritto). */
export type EsitoTentativo = 'ok' | 'presto' | 'rifiutato' | 'no';

/** Entro quanto dall'ultimo tentativo scritto da questa app un rifiuto delle regole vuol dire «troppo presto». */
export const FINESTRA_PRESTO = 30 * 1000;

/**
 * - `already-exists`: è la stessa scrittura rimandata (l'accesso rifatto subito dopo dalla sincronizzazione), quindi c'è;
 * - `permission-denied` entro `FINESTRA_PRESTO` dall'ultimo tentativo scritto da questa app: le regole ne accettano uno
 *   ogni 20 secondi per account, e quello di prima c'è (Valerio lo vede). Più tardi è un altro rifiuto (per esempio la
 *   sessione non più valida dopo una revoca, o una regola cambiata): non è arrivato niente, e non lo si dice arrivato
 *   (revisione di Claude 3 su #18);
 * - il resto (per esempio senza rete): non scritto.
 */
export function esitoTentativo(codice: unknown, dallUltimoScritto: number): EsitoTentativo {
  if (codice === 'already-exists') return 'ok';
  if (codice === 'permission-denied') return dallUltimoScritto < FINESTRA_PRESTO ? 'presto' : 'rifiutato';
  return 'no';
}

/** Il tentativo è arrivato: scritto adesso, oppure c'è quello di pochi secondi fa. */
export const arrivato = (r: EsitoTentativo): boolean => r === 'ok' || r === 'presto';
