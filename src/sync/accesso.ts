import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { firebase } from './firebase';

/**
 * Accesso solo su approvazione (docs/progetto-accesso-su-approvazione.md): la richiesta di chi entra, lo stato
 * deciso da Valerio, la sua sezione per decidere, i dispositivi per le notifiche. Qui c'è solo il collegamento ai
 * dati: il muro vero sono le regole di Firestore (firebase/firestore.rules), che dall'app non si possono aggirare.
 */

export type StatoAccesso = 'nessuno' | 'in_attesa' | 'approvato' | 'rifiutato' | 'revocato';
export type Decisione = Exclude<StatoAccesso, 'nessuno'>;
const STATI: readonly Decisione[] = ['in_attesa', 'approvato', 'rifiutato', 'revocato'];

/** L'amministratore, lo stesso UID delle regole: qui serve solo a mostrargli la sua sezione, non autorizza niente. */
export const UID_AMMINISTRATORE = 'UID_DI_VALERIO';
export const eAmministratore = (uid: string | null | undefined): boolean => !!uid && uid === UID_AMMINISTRATORE;

export interface Richiesta {
  uid: string;
  stato: StatoAccesso;
  nome: string;
  email: string;
  dispositivo: string;
  richiesta: Date | null;
  decisione: Date | null;
  nota: string;
}

export const statoValido = (s: unknown): StatoAccesso =>
  STATI.includes(s as Decisione) ? (s as Decisione) : 'nessuno';

const testo = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '');
/** Le date di Firestore (Timestamp) diventano Date; qualunque altra cosa, niente. */
function data(x: unknown): Date | null {
  const t = x as { toDate?: () => unknown } | null | undefined;
  const d = t && typeof t.toDate === 'function' ? t.toDate() : null;
  return d instanceof Date ? d : null;
}

/** Una richiesta letta dal database, con ogni campo controllato (quello che arriva non è detto che sia giusto). */
export function richiestaDa(uid: string, d: Record<string, unknown>): Richiesta {
  return {
    uid,
    stato: statoValido(d.stato),
    nome: testo(d.nome, 80),
    email: testo(d.email, 120),
    dispositivo: testo(d.dispositivo, 80),
    richiesta: data(d.richiesta),
    decisione: data(d.decisione),
    nota: testo(d.nota, 200),
  };
}

export async function leggiAccesso(uid: string): Promise<StatoAccesso> {
  const s = await getDoc(doc(firebase().db, 'accessi', uid));
  return s.exists() ? statoValido(s.data().stato) : 'nessuno';
}

/** Lo stato che cambia mentre l'app è aperta (Valerio approva: la schermata di attesa si apre da sola). */
export function seguiAccesso(uid: string, quandoCambia: (s: StatoAccesso) => void): Unsubscribe {
  return onSnapshot(
    doc(firebase().db, 'accessi', uid),
    s => quandoCambia(s.exists() ? statoValido(s.data().stato) : 'nessuno'),
    () => quandoCambia('nessuno'),
  );
}

/** La richiesta di accesso: una sola per account, sempre "in attesa" (le regole rifiutano tutto il resto). */
export async function chiediAccesso(uid: string, nome: string, email: string, dispositivo: string): Promise<void> {
  await setDoc(doc(firebase().db, 'accessi', uid), {
    stato: 'in_attesa',
    nome: nome.slice(0, 80),
    email,
    dispositivo: dispositivo.slice(0, 80),
    richiesta: serverTimestamp(),
  });
}

/** Tutte le richieste, le più recenti prima (le regole le fanno leggere solo a Valerio). */
export async function richieste(): Promise<Richiesta[]> {
  const s = await getDocs(query(collection(firebase().db, 'accessi'), orderBy('richiesta', 'desc')));
  return s.docs.map(d => richiestaDa(d.id, d.data()));
}

/** La decisione di Valerio: accetta, rifiuta, toglie l'accesso o ci ripensa (con una sua nota, se vuole). */
export async function decidi(uid: string, stato: Decisione, nota?: string): Promise<void> {
  const campi: Record<string, unknown> = { stato, decisione: serverTimestamp() };
  if (nota !== undefined) campi.nota = nota.slice(0, 200);
  await updateDoc(doc(firebase().db, 'accessi', uid), campi);
}

/** Il token delle notifiche di questo dispositivo, per ricevere avvisi e aggiornamenti solo se approvato. */
export async function registraDispositivo(uid: string, did: string, token: string, nome: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(did) || token.length < 20 || token.length > 4096) return false;
  await setDoc(doc(firebase().db, 'accessi', uid, 'dispositivi', did), {
    token,
    nome: nome.slice(0, 80),
    aggiornato: serverTimestamp(),
  });
  return true;
}

// L'ultimo stato conosciuto, per aprire l'app anche senza rete: è solo comodità, perché la parte online la
// decide comunque il server.
const CHIAVE = 'eurodex.accesso';

export function ultimoStato(uid: string): StatoAccesso {
  try {
    const j = JSON.parse(localStorage.getItem(CHIAVE) ?? 'null') as { uid?: unknown; stato?: unknown } | null;
    return j?.uid === uid ? statoValido(j.stato) : 'nessuno';
  } catch {
    return 'nessuno';
  }
}

export function ricordaStato(uid: string, stato: StatoAccesso): void {
  try {
    localStorage.setItem(CHIAVE, JSON.stringify({ uid, stato }));
  } catch {
    // memoria del browser non disponibile: alla prossima apertura si chiede di nuovo al server
  }
}
