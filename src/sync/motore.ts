import {
  collection,
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Unsubscribe,
  type WriteBatch,
  waitForPendingWrites,
} from 'firebase/firestore';
import { casuale } from '../core/rete';
import { firebase } from './firebase';
import { daMillisecondi, leggi, type Orologio } from './orologio';
import {
  chiaveVoce,
  separa,
  unisci,
  vociDelDocumento,
  vociPerDocumento,
  type Cambio,
  type TipoVoce,
  type Voci,
} from './unione';

/**
 * Lettura e scrittura della collezione condivisa su Firestore (collezioni/{utente}):
 *   voci/{p0…pf, f, n0…n3}  { e: { chiave: { v, t } } }    ← formato attuale (orologio logico per ogni voce)
 *   stato/{possedute,preferiti,note}                       ← formato delle versioni fino alla 1.0.78
 *   dispositivi/{id}, eventi/{id}                          ← elenco dei dispositivi e notifiche agli altri
 * Le versioni vecchie continuano a funzionare finché tutti non si aggiornano: qui si legge e si scrive anche il
 * loro formato.
 */

const NODO_VECCHIO = 'v1';

const radice = (db: Firestore, uid: string) => doc(db, 'collezioni', uid);
const voci = (db: Firestore, uid: string) => collection(db, 'collezioni', uid, 'voci');
const vecchio = (db: Firestore, uid: string, nome: 'possedute' | 'preferiti' | 'note') =>
  doc(db, 'collezioni', uid, 'stato', nome);

/**
 * Voci scritte dalle versioni vecchie (millisecondi con il segno: + aggiunta, − tolta; note con il loro ts).
 * Le copie scritte qui per loro (segnate nel campo "nuova") si saltano: la stessa modifica arriva già, con l'istante
 * preciso e il dispositivo, dal formato attuale.
 */
function vociVecchie(tipo: TipoVoce, dati: DocumentData | undefined): Voci {
  const out: Voci = {};
  const campo = (dati?.[tipo] ?? {}) as Record<string, unknown>;
  const nostre = (dati?.nuova ?? {}) as Record<string, unknown>;
  for (const [k, x] of Object.entries(campo)) {
    if (tipo === 'n') {
      const nota = x as { t?: unknown; ts?: unknown } | null;
      if (nota && typeof nota.ts === 'number' && nostre[k] === nota.ts) continue;
      if (nota && typeof nota.ts === 'number')
        out[chiaveVoce('n', k)] = {
          v: typeof nota.t === 'string' ? nota.t : '',
          t: daMillisecondi(nota.ts, NODO_VECCHIO),
        };
    } else if (typeof x === 'number' && x !== 0 && nostre[k] !== x) {
      out[chiaveVoce(tipo, k)] = { v: x > 0, t: daMillisecondi(Math.abs(x), NODO_VECCHIO) };
    }
  }
  return out;
}

/** Dalle versioni vecchie si accetta solo ciò che è più recente (in millisecondi) di quello che si conosce. */
function soloPiuRecenti(arrivate: Voci, conosciute: Voci): Voci {
  const out: Voci = {};
  for (const [k, v] of Object.entries(arrivate)) {
    const ora = conosciute[k];
    const msArrivata = leggi(v.t)?.ms ?? 0;
    const msOra = ora ? (leggi(ora.t)?.ms ?? 0) : 0;
    if (!ora || msArrivata > msOra) out[k] = v;
  }
  return out;
}

export async function leggiTutto(uid: string): Promise<Voci> {
  const { db } = firebase();
  const tutte: Voci = {};
  for (const d of (await getDocs(voci(db, uid))).docs) Object.assign(tutte, vociDelDocumento(d.id, d.data().e));
  const [p, f, n] = await Promise.all([
    getDoc(vecchio(db, uid, 'possedute')),
    getDoc(vecchio(db, uid, 'preferiti')),
    getDoc(vecchio(db, uid, 'note')),
  ]);
  const vecchie = { ...vociVecchie('p', p.data()), ...vociVecchie('f', f.data()), ...vociVecchie('n', n.data()) };
  unisci(tutte, soloPiuRecenti(vecchie, tutte));
  return tutte;
}

export async function preparaRadice(uid: string): Promise<void> {
  const { db } = firebase();
  const r = await getDoc(radice(db, uid));
  if (!r.exists()) await setDoc(radice(db, uid), { creata: Date.now(), schema: 2 });
  else if (r.data().schema !== 2) await setDoc(radice(db, uid), { schema: 2 }, { merge: true });
}

export interface Invio {
  uid: string;
  did: string;
  nome: string;
  modifiche: Map<string, boolean | string>;
  testo: string;
}

/**
 * Il formato delle versioni fino alla 1.0.78 si scrive finché c'è almeno un dispositivo che non ha aggiornato (o non
 * si sa ancora): ha un tetto (20.000 campi per documento) e serve solo a loro.
 */
let conFormatoVecchio = true;
export function formatoVecchio(si: boolean): void {
  conFormatoVecchio = si;
}

/** Mette nella scrittura le voci, nel formato attuale e (per le versioni vecchie) in quello di prima. */
function scriviVoci(batch: WriteBatch, db: Firestore, uid: string, daScrivere: Voci): void {
  const vecchieP: Record<string, number> = {};
  const vecchieF: Record<string, number> = {};
  const vecchieN: Record<string, { t: string; ts: number }> = {};
  for (const [chiave, { v, t }] of Object.entries(daScrivere)) {
    const [tipo, k] = separa(chiave);
    const ms = leggi(t)?.ms ?? Date.now();
    if (tipo === 'p') vecchieP[k] = v ? ms : -ms;
    else if (tipo === 'f') vecchieF[k] = v ? ms : -ms;
    else vecchieN[k] = { t: typeof v === 'string' ? v : '', ts: ms };
  }
  for (const [nomeDoc, e] of vociPerDocumento(daScrivere))
    batch.set(doc(voci(db, uid), nomeDoc), { e }, { merge: true });
  if (!conFormatoVecchio) return;
  // per le versioni vecchie: stesso valore, più il segno "nuova" che dice alle versioni nuove di non rileggerla
  const nostre = <T>(m: Record<string, T>, valore: (x: T) => number) =>
    Object.fromEntries(Object.entries(m).map(([k, x]) => [k, valore(x)]));
  if (Object.keys(vecchieP).length)
    batch.set(vecchio(db, uid, 'possedute'), { p: vecchieP, nuova: vecchieP }, { merge: true });
  if (Object.keys(vecchieF).length)
    batch.set(vecchio(db, uid, 'preferiti'), { f: vecchieF, nuova: vecchieF }, { merge: true });
  if (Object.keys(vecchieN).length)
    batch.set(vecchio(db, uid, 'note'), { n: vecchieN, nuova: nostre(vecchieN, x => x.ts) }, { merge: true });
}

/** Manda le modifiche (in un'unica scrittura) e restituisce le voci con i loro istanti. */
export function invia(inv: Invio, orologio: Orologio): { voci: Voci; fatto: Promise<void> } {
  const { db } = firebase();
  const batch = writeBatch(db);
  const nuove: Voci = {};
  for (const [chiave, v] of inv.modifiche) nuove[chiave] = { v, t: orologio.segna() };
  scriviVoci(batch, db, inv.uid, nuove);
  const ora = Date.now();
  // il "postino" (Cloud Function) avvisa gli altri dispositivi con una notifica, anche ad app chiusa
  if (inv.testo)
    batch.set(doc(db, 'collezioni', inv.uid, 'eventi', casuale(16, 'abcdefghijklmnopqrstuvwxyz0123456789')), {
      did: inv.did,
      nome: inv.nome,
      ts: ora,
      testo: inv.testo.slice(0, 480),
    });
  batch.set(doc(db, 'collezioni', inv.uid, 'dispositivi', inv.did), { ultimo: ora }, { merge: true });
  return { voci: nuove, fatto: batch.commit() };
}

/** Solo l'avviso agli altri dispositivi (il "postino" manda la notifica), senza voci: i dati sono già partiti. */
export function annuncia(uid: string, did: string, nome: string, testo: string): Promise<void> {
  const { db } = firebase();
  const batch = writeBatch(db);
  const ora = Date.now();
  batch.set(doc(db, 'collezioni', uid, 'eventi', casuale(16, 'abcdefghijklmnopqrstuvwxyz0123456789')), {
    did,
    nome,
    ts: ora,
    testo: testo.slice(0, 480),
  });
  batch.set(doc(db, 'collezioni', uid, 'dispositivi', did), { ultimo: ora }, { merge: true });
  return batch.commit();
}

/**
 * Riscrive identiche (stesso valore e stesso istante) le voci che sul server sono rimaste più vecchie di quelle che si
 * conoscono: nessuna notifica agli altri, perché non è una modifica nuova.
 */
export function ripara(uid: string, daScrivere: Voci): Promise<void> {
  const { db } = firebase();
  const batch = writeBatch(db);
  scriviVoci(batch, db, uid, daScrivere);
  return batch.commit();
}

/** Finisce quando tutte le scritture fatte qui (anche quelle in coda senza rete, anche di prima) sono sul server. */
export function scrittureArrivate(): Promise<void> {
  return waitForPendingWrites(firebase().db);
}

/** Solo per le prove nel browser: stacca e riattacca la rete di Firestore (come un telefono senza campo). */
export async function reteProva(attiva: boolean): Promise<void> {
  const { db } = firebase();
  await (attiva ? enableNetwork(db) : disableNetwork(db));
}

/** Ascolta le modifiche fatte sugli altri dispositivi (anche quelle arrivate mentre l'app era chiusa). */
export function ascolta(
  uid: string,
  conosciute: () => Voci,
  arrivate: (v: Voci) => void,
  errore: (e: unknown) => void,
): Unsubscribe {
  const { db } = firebase();
  const stop = [
    onSnapshot(
      voci(db, uid),
      s => {
        const tutte: Voci = {};
        for (const c of s.docChanges())
          if (c.type !== 'removed') Object.assign(tutte, vociDelDocumento(c.doc.id, c.doc.data().e));
        if (Object.keys(tutte).length) arrivate(tutte);
      },
      errore,
    ),
    ...(['possedute', 'preferiti', 'note'] as const).map(nome =>
      onSnapshot(
        vecchio(db, uid, nome),
        s => {
          const tipo: TipoVoce = nome === 'possedute' ? 'p' : nome === 'preferiti' ? 'f' : 'n';
          const nuove = soloPiuRecenti(vociVecchie(tipo, s.data()), conosciute());
          if (Object.keys(nuove).length) arrivate(nuove);
        },
        errore,
      ),
    ),
  ];
  return () => {
    for (const s of stop) s();
  };
}

export interface Dispositivo {
  id: string;
  nome?: string;
  modello?: string;
  tablet?: boolean;
  ultimo?: number;
  versione?: string;
}

export async function registraDispositivo(uid: string, did: string, d: Omit<Dispositivo, 'id'>): Promise<void> {
  const { db } = firebase();
  await setDoc(doc(db, 'collezioni', uid, 'dispositivi', did), d, { merge: true });
}

export async function dispositivi(uid: string): Promise<Dispositivo[]> {
  const { db } = firebase();
  const s = await getDocs(collection(db, 'collezioni', uid, 'dispositivi'));
  return s.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<Dispositivo, 'id'>) }))
    .sort((a, b) => (b.ultimo ?? 0) - (a.ultimo ?? 0));
}

/** Elenco dei dispositivi sempre aggiornato (nomi cambiati, dispositivi aggiunti o tolti arrivano da soli). */
export function ascoltaDispositivi(
  uid: string,
  elenco: (l: Dispositivo[]) => void,
  errore: (e: unknown) => void,
): Unsubscribe {
  const { db } = firebase();
  return onSnapshot(
    collection(db, 'collezioni', uid, 'dispositivi'),
    s => {
      elenco(
        s.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<Dispositivo, 'id'>) }))
          .sort((a, b) => (b.ultimo ?? 0) - (a.ultimo ?? 0)),
      );
    },
    errore,
  );
}

export async function togliDispositivo(uid: string, did: string): Promise<void> {
  const { db } = firebase();
  await deleteDoc(doc(db, 'collezioni', uid, 'dispositivi', did));
}

export type { Cambio };
