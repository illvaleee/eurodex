import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithCredential,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { Nativo, nativo } from '../nativo/plugin';
import { HOST_EMULATORI, emulatoriNativi } from '../nativo/prove';

/**
 * Collegamento a Firebase con le librerie ufficiali: accesso con l'account Google (Firebase Authentication) e
 * collezione condivisa (Cloud Firestore, che funziona anche offline e manda le modifiche appena c'è rete).
 * Questo modulo si carica solo quando serve, così l'avvio dell'app resta veloce.
 */

const CONFIG = {
  apiKey: 'AIzaSyDiDVmvLgHGt9vDgGlzx4C6d5Yf06xXX8o', // chiave pubblica dell'app (è anche dentro l'APK)
  authDomain: 'collezione-euro-24ecd.firebaseapp.com',
  projectId: 'collezione-euro-24ecd',
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

/**
 * Nelle prove automatiche ci si collega agli emulatori di Firebase: nel browser con `?emulatori=`, nell'APK solo con
 * `debug.eurodex.emulatori=1` (da adb), e allora anche la parte nativa va lì (Archivio.java): mai metà e metà.
 */
function emulatori(): { auth: string; firestore: [string, number] } | null {
  if (nativo())
    return emulatoriNativi() ? { auth: `http://${HOST_EMULATORI}:9099`, firestore: [HOST_EMULATORI, 8080] } : null;
  const e = new URLSearchParams(location.search).get('emulatori');
  if (!e) return null;
  const [host = 'localhost', portaAuth = '9099', portaDb = '8080'] = e.split(':');
  return { auth: `http://${host}:${portaAuth}`, firestore: [host, Number(portaDb)] };
}

export function firebase(): { auth: Auth; db: Firestore } {
  if (!app || !auth || !db) {
    app = initializeApp(CONFIG);
    // niente finestre di accesso del browser: l'accesso lo fa Android, qui arriva solo la credenziale
    auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }) });
    const e = emulatori();
    if (e) {
      connectAuthEmulator(auth, e.auth, { disableWarnings: true });
      connectFirestoreEmulator(db, ...e.firestore);
    }
  }
  return { auth, db };
}

/** L'utente che aveva già fatto l'accesso (la sessione si ricorda da sola tra un'apertura e l'altra). */
export async function utenteSalvato(): Promise<User | null> {
  const { auth: a } = firebase();
  await a.authStateReady();
  return a.currentUser;
}

export async function accediConToken(idToken: string): Promise<User> {
  const { auth: a } = firebase();
  const r = await signInWithCredential(a, GoogleAuthProvider.credential(idToken));
  return r.user;
}

/** Si esce da tutte e due le sessioni: quella della parte web e quella nativa, che scarica versioni e catalogo. */
export async function esci(): Promise<void> {
  if (auth) await signOut(auth);
  if (nativo()) await Nativo.esciNativo().catch(() => undefined);
}
