import {
  addDoc,
  collection,
  deleteDoc,
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
 * Accesso solo su approvazione (docs/progetto-accesso-su-approvazione.md): ogni accesso con Google è un tentativo
 * (la funzione tentativoDiAccesso crea la richiesta dell'account nuovo, o avvisa Valerio che uno già deciso è
 * rientrato), lo stato deciso da Valerio, la sua sezione per decidere, i dispositivi per le notifiche. Qui c'è solo il
 * collegamento ai dati: il muro vero sono le regole di Firestore (firebase/firestore.rules), che dall'app non si
 * possono aggirare.
 */

export type StatoAccesso = 'nessuno' | 'in_attesa' | 'approvato' | 'rifiutato' | 'revocato';
export type Decisione = Exclude<StatoAccesso, 'nessuno'>;
const STATI: readonly Decisione[] = ['in_attesa', 'approvato', 'rifiutato', 'revocato'];

/** L'amministratore, lo stesso UID delle regole: qui serve solo a mostrargli la sua sezione, non autorizza niente. */
export const UID_AMMINISTRATORE = 'AkUbMzxnXwgjinx9fMaWw6NBAlM2';
export const eAmministratore = (uid: string | null | undefined): boolean => !!uid && uid === UID_AMMINISTRATORE;

export interface Richiesta {
  uid: string;
  stato: StatoAccesso;
  nome: string;
  email: string;
  /** il telefono dell'ultimo tentativo */
  dispositivo: string;
  richiesta: Date | null;
  decisione: Date | null;
  nota: string;
  /** l'ultimo accesso con Google (tentativo), e quanti ne ha fatti */
  ultimoTentativo: Date | null;
  tentativi: number;
}

/** Perché parte un tentativo: un accesso con Google, «Chiedi di nuovo», il primo avvio con questa versione. */
export type MotivoTentativo = 'accesso' | 'ancora' | 'primo';

export const statoValido = (s: unknown): StatoAccesso =>
  STATI.includes(s as Decisione) ? (s as Decisione) : 'nessuno';

// testo da fuori senza caratteri di controllo o di direzione (che possono rigirare quello che segue)
const testo = (x: unknown, max: number): string =>
  typeof x === 'string' ? x.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, max) : '';
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
    ultimoTentativo: data(d.ultimoTentativo),
    tentativi: typeof d.tentativi === 'number' && d.tentativi > 0 ? Math.floor(d.tentativi) : 1,
  };
}

export async function leggiAccesso(uid: string): Promise<StatoAccesso> {
  const s = await getDoc(doc(firebase().db, 'accessi', uid));
  return s.exists() ? statoValido(s.data().stato) : 'nessuno';
}

/**
 * Lo stato che cambia mentre l'app è aperta (Valerio approva o toglie l'accesso: la schermata cambia da sola).
 * `dalServer`: falso quando la risposta viene solo dalla memoria del telefono (senza rete).
 */
export function seguiAccesso(
  uid: string,
  quandoCambia: (s: StatoAccesso, dalServer: boolean) => void,
  quandoSiFerma: (e: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(firebase().db, 'accessi', uid),
    s => quandoCambia(s.exists() ? statoValido(s.data().stato) : 'nessuno', !s.metadata.fromCache),
    quandoSiFerma,
  );
}

/**
 * Un tentativo di accesso: lo legge la funzione tentativoDiAccesso, che crea la richiesta dell'account nuovo o avvisa
 * Valerio (approvato o rifiutato in automatico). Nome ed email la funzione li prende dall'account, qui solo il telefono.
 */
export async function registraTentativo(uid: string, dispositivo: string, motivo: MotivoTentativo): Promise<void> {
  await addDoc(collection(firebase().db, 'accessi', uid, 'tentativi'), {
    quando: serverTimestamp(),
    dispositivo: dispositivo.slice(0, 80),
    motivo,
  });
}

/** Tutte le richieste, le più recenti prima (le regole le fanno leggere solo a Valerio). */
export async function richieste(): Promise<Richiesta[]> {
  const s = await getDocs(query(collection(firebase().db, 'accessi'), orderBy('richiesta', 'desc')));
  return s.docs.map(d => richiestaDa(d.id, d.data()));
}

/** Le richieste che cambiano mentre la sezione di Valerio è aperta (una richiesta nuova compare da sola). */
export function seguiRichieste(quandoCambiano: (l: Richiesta[]) => void, errore: (e: unknown) => void): Unsubscribe {
  return onSnapshot(
    query(collection(firebase().db, 'accessi'), orderBy('richiesta', 'desc')),
    s => quandoCambiano(s.docs.map(d => richiestaDa(d.id, d.data()))),
    errore,
  );
}

/** L'interruttore del muro: solo Valerio lo può cambiare (le regole rifiutano tutti gli altri). */
export async function impostaObbligo(obbligatorio: boolean): Promise<void> {
  await setDoc(doc(firebase().db, 'config', 'accesso'), { obbligatorio, cambiato: serverTimestamp() });
}

/** La decisione di Valerio: accetta, rifiuta, toglie l'accesso o ci ripensa (con una sua nota, se vuole). */
export async function decidi(uid: string, stato: Decisione, nota?: string): Promise<void> {
  const campi: Record<string, unknown> = { stato, decisione: serverTimestamp() };
  if (nota !== undefined) campi.nota = nota.slice(0, 200);
  await updateDoc(doc(firebase().db, 'accessi', uid), campi);
}

/** Il token delle notifiche di questo dispositivo: avvisi dell'accesso (approvato, tolto) e della sincronizzazione. */
export async function registraDispositivo(uid: string, did: string, token: string, nome: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(did) || token.length < 20 || token.length > 4096) return false;
  await setDoc(doc(firebase().db, 'accessi', uid, 'dispositivi', did), {
    token,
    nome: nome.slice(0, 80),
    aggiornato: serverTimestamp(),
  });
  return true;
}

/** Uscendo dall'account: questo telefono non riceve più gli avvisi di quell'account. */
export async function togliDispositivo(uid: string, did: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(did)) return;
  await deleteDoc(doc(firebase().db, 'accessi', uid, 'dispositivi', did));
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

/** L'account con cui si è entrati l'ultima volta su questo telefono (senza caricare Firebase), se c'è. */
export function ultimoAccount(): string | null {
  try {
    const j = JSON.parse(localStorage.getItem(CHIAVE) ?? 'null') as { uid?: unknown } | null;
    return typeof j?.uid === 'string' && j.uid ? j.uid : null;
  } catch {
    return null;
  }
}

export function dimenticaStato(): void {
  try {
    localStorage.removeItem(CHIAVE);
  } catch {
    // niente da dimenticare
  }
}

export function ricordaStato(uid: string, stato: StatoAccesso): void {
  try {
    localStorage.setItem(CHIAVE, JSON.stringify({ uid, stato }));
  } catch {
    // memoria del browser non disponibile: alla prossima apertura si chiede di nuovo al server
  }
}
