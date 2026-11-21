import { bandiera, pezzoPerChiave, tipoPerId, nomePaese } from '../catalogo/indice';
import { etichettaConBandiera, nomeTipo } from '../catalogo/proprieta';
import {
  accorciaStorico,
  note,
  possedute,
  preferite,
  quandoSalvato,
  salva,
  sostituisci,
  sostituisciNote,
  storico,
} from '../collezione/stato';
import { avvisa, registraErrore } from '../core/errori';
import { annullabile } from '../ui/avvisi';
import { elencoBreve, numero } from '../core/formato';
import { casuale } from '../core/rete';
import { Nativo, messaggio, nativo, type InfoDispositivo } from '../nativo/plugin';
import { versioneApp } from '../nativo/versione';
import { leggi, Orologio } from './orologio';
import type { Dispositivo } from './motore';
import {
  annullaInvio,
  cambiDaApplicare,
  chiaveValida,
  daRiparare,
  modificheLocali,
  riapplica,
  separa,
  unisci,
  type Cambio,
  type Voce,
  type Voci,
} from './unione';

/**
 * Stessa collezione su più dispositivi: si accede con l'account Google e, dove si accede con lo stesso account, la
 * collezione è la stessa. Ogni modifica (monete, preferite, note) parte subito, anche senza rete (arriva appena c'è);
 * le modifiche degli altri arrivano da sole, e ad app chiusa arriva una notifica. Per ogni voce vince la modifica
 * fatta davvero per ultima (orologio logico ibrido): l'ora sbagliata di un telefono non conta.
 * L'aspetto dell'app (sfondo, colori, vista) resta di ciascun dispositivo.
 */

export interface StatoSync {
  uid: string;
  email: string;
  account: string;
  /** Questo dispositivo. */
  did: string;
  nome: string;
  rinominato: boolean;
  orologio: { ms: number; c: number };
  /** Ultimo stato conosciuto di ogni voce (con l'istante dell'ultima modifica). */
  voci: Voci;
  errore: string;
  /** L'accesso non è più valido: serve rifarlo. */
  scaduto: boolean;
}

const LS = 'eurodex.sync2';
const LS_VECCHIO = 'eurodex.sync';
/** Quello che si sapeva al momento di "Esci": al riaccesso con lo stesso account si riparte da lì. */
const LS_USCITO = 'eurodex.sync2.uscito';

function leggiStato(): StatoSync | null {
  try {
    const s = JSON.parse(localStorage.getItem(LS) ?? 'null') as StatoSync | null;
    // solo voci con la chiave completa ("p:…", "f:…", "n:…"): qualsiasi altra cosa si scarta
    if (s) s.voci = Object.fromEntries(Object.entries(s.voci).filter(([k]) => chiaveValida(k)));
    return s;
  } catch {
    return null;
  }
}

export let sync: StatoSync | null = leggiStato();

function leggiUscito(): StatoSync | null {
  try {
    const s = JSON.parse(localStorage.getItem(LS_USCITO) ?? 'null') as StatoSync | null;
    if (s) s.voci = Object.fromEntries(Object.entries(s.voci).filter(([k]) => chiaveValida(k)));
    return s;
  } catch {
    return null;
  }
}
export const sincronizzazioneAttiva = (): boolean => !!sync?.uid;
export const idDispositivo = (): string | undefined => sync?.did;

/** Collegamento delle versioni fino alla 1.0.78 (accesso fatto a mano): si riprende con l'accesso silenzioso. */
interface SyncVecchio {
  cid?: string;
  email?: string;
  account?: string;
  did?: string;
  nome?: string;
  rinominato?: boolean;
  rt?: string;
}
const vecchio: SyncVecchio | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS_VECCHIO) ?? 'null') as SyncVecchio | null;
  } catch {
    return null;
  }
})();
/** C'era il primissimo collegamento con il codice (1.0.63), poi sostituito dall'account Google. */
export const collegamentoConCodice = !!vecchio && !vecchio.rt && !sync;
/** Dopo l'aggiornamento l'accesso non si è potuto riprendere da solo: va chiesto all'utente (una volta). */
export let accessoDaRifare = false;

let orologio: Orologio | null = null;

function salvaStato(): void {
  try {
    if (sync) {
      if (orologio) sync.orologio = orologio.stato;
      localStorage.setItem(LS, JSON.stringify(sync));
    } else localStorage.removeItem(LS);
  } catch {
    // spazio pieno: si riprova alla prossima modifica
  }
}

const motore = () => import('./motore');

/** L'accesso non vale più (o il server non lo accetta): serve rifarlo. Dal codice dell'errore, il testo come riserva. */
function erroreDiAccesso(e: unknown): boolean {
  const codice = (e as { code?: unknown } | null)?.code;
  if (codice === 'permission-denied' || codice === 'unauthenticated') return true;
  return /permission|unauthenticated/i.test(messaggio(e));
}
const firebase = () => import('./firebase');

// ───────── dispositivo ─────────

export async function infoDispositivo(): Promise<InfoDispositivo> {
  if (nativo())
    try {
      return await Nativo.infoDispositivo();
    } catch {
      // si usa il nome generico
    }
  return { marca: '', modello: /iPad|Tablet/i.test(navigator.userAgent) ? 'Tablet' : 'Telefono' };
}

export function modelloLeggibile(i: InfoDispositivo): string {
  const m = i.modello.trim();
  const b = i.marca.trim();
  const x = m.toLowerCase().startsWith(b.toLowerCase()) ? m : `${b} ${m}`;
  return x.trim().replace(/^\w/, c => c.toUpperCase()) || 'Dispositivo';
}

export const nomeDispositivo = (i: InfoDispositivo): string => i.nome?.trim() || modelloLeggibile(i);

async function iscriviNotifiche(): Promise<void> {
  if (!nativo()) return;
  try {
    await Nativo.impostaSync(sync ? { cid: sync.uid, did: sync.did, nome: sync.nome } : { cid: '' });
  } catch (e) {
    avvisa('iscrizione alle notifiche di sincronizzazione', e);
  }
}

export async function registraQuestoDispositivo(): Promise<void> {
  if (!sync) return;
  const i = await infoDispositivo();
  // se non l'ha rinominato a mano, il nome segue quello delle impostazioni di Android
  if (!sync.rinominato && i.nome && sync.nome !== i.nome) {
    sync.nome = i.nome;
    salvaStato();
    void iscriviNotifiche();
  }
  const m = await motore();
  await m.registraDispositivo(sync.uid, sync.did, {
    nome: sync.nome,
    modello: modelloLeggibile(i),
    tablet: !!i.tablet,
    ultimo: Date.now(),
    versione: versioneApp?.version ?? '',
  });
}

// ───────── modifiche che arrivano dagli altri ─────────

let nomiDispositivi: Record<string, string> = {};

/** "1.0.79" → 79 (0 se manca o non si legge). */
const numeroVersione = (v: string | undefined): number => Number(/^1\.0\.(\d+)$/.exec(v ?? '')?.[1] ?? 0);

/** Dall'elenco dei dispositivi: nomi per lo storico, e se serve ancora il formato delle versioni vecchie. */
async function usaElenco(l: readonly Dispositivo[]): Promise<void> {
  nomiDispositivi = Object.fromEntries(l.map(d => [d.id, d.nome ?? d.modello ?? '']));
  const tuttiNuovi = l.length > 0 && l.every(d => numeroVersione(d.versione) >= 79);
  (await motore()).formatoVecchio(!tuttiNuovi);
}

async function aggiornaNomiDispositivi(): Promise<void> {
  if (!sync) return;
  try {
    await usaElenco(await (await motore()).dispositivi(sync.uid));
  } catch {
    // senza rete restano i nomi di prima
  }
}

type QuandoArrivano = (cambi: Cambio[]) => void;
let quandoArrivano: QuandoArrivano = () => undefined;
/** Chi deve ridisegnare la pagina quando arrivano modifiche dagli altri dispositivi. */
export function alRicevere(f: QuandoArrivano): void {
  quandoArrivano = f;
}

// voci rimaste più vecchie sul server: si riscrivono tutte insieme poco dopo (vedi daRiparare)
let riparazioni: Voci = {};
let timerRiparazioni: ReturnType<typeof setTimeout> | undefined;

function riparaPresto(): void {
  clearTimeout(timerRiparazioni);
  timerRiparazioni = setTimeout(() => void ripara(), 1500);
}

async function ripara(): Promise<void> {
  const s = sync;
  const daScrivere = riparazioni;
  riparazioni = {};
  if (!s || s.scaduto) return;
  // solo quelle ancora uguali a quelle conosciute (se nel frattempo sono cambiate, ci pensa l'invio normale)
  const ancora = Object.fromEntries(Object.entries(daScrivere).filter(([k, v]) => s.voci[k] === v));
  if (!Object.keys(ancora).length) return;
  try {
    await (await motore()).ripara(s.uid, ancora);
  } catch (e) {
    avvisa('riparazione delle voci sul server', e);
    if (erroreDiAccesso(e)) {
      s.scaduto = true;
      if (s === sync) salvaStato();
    }
  }
}

/**
 * Voci arrivate dal server. `tieniTocchi`: le voci toccate qui e non ancora inviate restano come le ha messe l'utente
 * (vale per quello che arriva mentre si usa l'app; al primo accesso l'unione la decide accedi()).
 */
function applica(arrivate: Voci, nelloStorico = true, tieniTocchi = true): void {
  if (!sync || !orologio) return;
  for (const v of Object.values(arrivate)) orologio.ricevi(v.t);
  const vecchie = daRiparare(sync.voci, arrivate);
  if (Object.keys(vecchie).length) {
    Object.assign(riparazioni, vecchie);
    riparaPresto();
  }
  // le voci toccate qui e non ancora inviate restano come le ha messe l'utente (partono subito dopo e vincono)
  const pendenti = tieniTocchi ? modificheLocali({ possedute, preferite, note }, sync.voci) : new Map<string, never>();
  const cambi = cambiDaApplicare(unisci(sync.voci, arrivate), pendenti);
  salvaStato();
  if (!cambi.length) return;
  let nuoviNomi = false;
  for (const c of cambi) {
    const [tipo, k] = separa(c.chiave);
    if (tipo === 'p') {
      if (c.dopo.v === true) possedute.add(k);
      else possedute.delete(k);
      const ist = leggi(c.dopo.t);
      const da = ist ? nomiDispositivi[ist.nodo] : undefined;
      if (ist && !da && ist.nodo !== 'v1') nuoviNomi = true;
      if (nelloStorico)
        storico.push([
          // la data mostrata non va oltre adesso (un telefono con la data avanti trascina gli orologi, non lo storico)
          Math.floor(Math.min(ist?.ms ?? Date.now(), Date.now()) / 1000),
          c.dopo.v === true ? '+' : '-',
          k,
          `@${da || 'altro dispositivo'}`,
        ]);
    } else if (tipo === 'f') {
      if (c.dopo.v === true) preferite.add(k);
      else preferite.delete(k);
    } else if (typeof c.dopo.v === 'string' && c.dopo.v) note[k] = c.dopo.v;
    else Reflect.deleteProperty(note, k);
  }
  accorciaStorico();
  salva();
  quandoArrivano(cambi);
  if (nuoviNomi) void aggiornaNomiDispositivi();
}

// ───────── modifiche fatte qui ─────────

/** Testo della notifica per gli altri dispositivi ("Aggiunta: 🇮🇹 2€ 2015…"). */
function riassunto(m: ReadonlyMap<string, boolean | string>): string {
  const aggiunte: string[] = [];
  const tolte: string[] = [];
  const favPiu: string[] = [];
  const favMeno: string[] = [];
  const noteCambiate: string[] = [];
  for (const [chiave, v] of m) {
    const [tipo, k] = separa(chiave);
    if (tipo === 'p') (v === true ? aggiunte : tolte).push(k);
    else if (tipo === 'f') (v === true ? favPiu : favMeno).push(k);
    else noteCambiate.push(k);
  }
  const pezzo = (k: string) => {
    const p = pezzoPerChiave[k];
    return p ? etichettaConBandiera(p) : k;
  };
  const moneta = (id: string) => {
    const t = tipoPerId[id];
    return t ? `${bandiera(t.cc)} ${t.commem ? nomeTipo(t) : `${nomeTipo(t)} ${nomePaese(t.cc)}`}` : id;
  };
  const parti: string[] = [];
  if (tolte.length > 20 && !possedute.size) parti.push(`Collezione azzerata (${numero(tolte.length)} monete)`);
  else {
    if (aggiunte.length)
      parti.push(
        aggiunte.length === 1
          ? `Aggiunta: ${pezzo(aggiunte[0] ?? '')}`
          : `Aggiunte ${numero(aggiunte.length)} monete: ${elencoBreve(aggiunte, pezzo)}`,
      );
    if (tolte.length)
      parti.push(
        tolte.length === 1
          ? `Tolta: ${pezzo(tolte[0] ?? '')}`
          : `Tolte ${numero(tolte.length)} monete: ${elencoBreve(tolte, pezzo)}`,
      );
  }
  if (favPiu.length) parti.push(`Nelle preferite: ${elencoBreve(favPiu, moneta)}`);
  if (favMeno.length) parti.push(`Tolta dalle preferite: ${elencoBreve(favMeno, moneta)}`);
  if (noteCambiate.length)
    parti.push(
      noteCambiate.length === 1
        ? `Nota modificata: ${moneta(noteCambiate[0] ?? '')}`
        : `Nota modificata su ${noteCambiate.length} monete`,
    );
  return parti.join(' · ');
}

let timer: ReturnType<typeof setTimeout> | undefined;

// ───────── avvisi agli altri dispositivi: al massimo uno al minuto, con il riassunto di tutto ─────────

const PAUSA_ANNUNCI = 60_000;
let ultimoAnnuncio = 0;
const daAnnunciare = new Map<string, boolean | string>();
let timerAnnuncio: ReturnType<typeof setTimeout> | undefined;

/** Testo dell'avviso per questo invio ('' = per ora niente: si accumula e parte più tardi, tutto insieme). */
function testoDaAnnunciare(modifiche: ReadonlyMap<string, boolean | string>): string {
  if (!daAnnunciare.size && Date.now() - ultimoAnnuncio >= PAUSA_ANNUNCI) {
    ultimoAnnuncio = Date.now();
    return riassunto(modifiche);
  }
  for (const [k, v] of modifiche) daAnnunciare.set(k, v);
  clearTimeout(timerAnnuncio);
  timerAnnuncio = setTimeout(() => void annunciaOra(), Math.max(0, ultimoAnnuncio + PAUSA_ANNUNCI - Date.now()));
  return '';
}

/** Manda adesso l'avviso accumulato (anche quando l'app va in secondo piano, così non si perde). */
export async function annunciaOra(): Promise<void> {
  clearTimeout(timerAnnuncio);
  const s = sync;
  if (!daAnnunciare.size || !s || s.scaduto) return;
  const testo = riassunto(daAnnunciare);
  daAnnunciare.clear();
  ultimoAnnuncio = Date.now();
  if (!testo) return;
  try {
    await (await motore()).annuncia(s.uid, s.did, s.nome, testo);
  } catch (e) {
    avvisa('avviso agli altri dispositivi', e);
  }
}

/**
 * Manda le modifiche fatte qui e restituisce la conferma del server (null se non c'era niente da mandare). Senza
 * rete la conferma arriva quando torna la connessione: Firestore tiene le modifiche anche se si chiude l'app.
 */
const attivo = (): { s: StatoSync; o: Orologio } | null =>
  sync && orologio && !sync.scaduto ? { s: sync, o: orologio } : null;

async function invia(): Promise<{ conferma: Promise<void> } | null> {
  if (!attivo()) return null;
  const m = await motore();
  // le modifiche si calcolano dopo l'ultima attesa: due invii ravvicinati non mandano due volte le stesse
  const a = attivo();
  if (!a) return null;
  const { s, o } = a;
  const modifiche = modificheLocali({ possedute, preferite, note }, s.voci);
  if (!modifiche.size) return null;
  const { voci, fatto } = m.invia(
    { uid: s.uid, did: s.did, nome: s.nome, modifiche, testo: testoDaAnnunciare(modifiche) },
    o,
  );
  const prima: Record<string, Voce | undefined> = {};
  for (const k of Object.keys(voci)) prima[k] = s.voci[k];
  // le voci contano come inviate subito: senza rete Firestore le tiene e le manda appena può
  Object.assign(s.voci, voci);
  salvaStato();
  // (dentro un oggetto: restituita direttamente, la funzione aspetterebbe la conferma del server)
  const conferma = fatto.then(
    () => {
      if (s.errore) {
        s.errore = '';
        salvaStato();
      }
    },
    (e: unknown) => {
      avvisa('invio delle modifiche', e);
      // rifiutato dal server: quelle modifiche risultano di nuovo da inviare (ripartono al prossimo invio o accesso)
      annullaInvio(s.voci, voci, prima);
      s.errore = messaggio(e);
      if (erroreDiAccesso(e)) s.scaduto = true;
      if (s === sync) salvaStato();
      throw e;
    },
  );
  return { conferma };
}

export async function inviaModifiche(): Promise<void> {
  const r = await invia();
  r?.conferma.catch(() => undefined);
}

export type EsitoSincronizzazione = 'inviate' | 'allineato' | 'senzaRete' | 'errore' | 'scaduto';

/**
 * "Sincronizza ora": manda le modifiche e aspetta che sul server sia arrivato TUTTO, comprese le modifiche partite
 * prima e rimaste in coda senza rete. "Allineato" solo se non c'era niente in sospeso.
 */
export async function sincronizzaOra(attesaMs = 8000): Promise<EsitoSincronizzazione> {
  if (!sync) return 'allineato';
  if (sync.scaduto) return 'scaduto';
  const r = await invia();
  const m = await motore();
  const tutto = Promise.all([r?.conferma, m.scrittureArrivate()]);
  let attesa: ReturnType<typeof setTimeout> | undefined;
  const esito = await Promise.race<EsitoSincronizzazione>([
    tutto.then(
      () => (r ? 'inviate' : 'allineato'),
      () => (sync?.scaduto ? 'scaduto' : 'errore'),
    ),
    new Promise(ok => (attesa = setTimeout(() => ok('senzaRete'), attesaMs))),
  ]);
  clearTimeout(attesa);
  return esito;
}

/** Ci sono modifiche fatte qui non ancora arrivate al server? (risponde entro pochi decimi di secondo) */
export async function modificheInAttesa(): Promise<boolean> {
  if (!sync) return false;
  const m = await motore();
  let attesa: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    m.scrittureArrivate().then(
      () => false,
      () => false,
    ),
    new Promise<boolean>(ok => (attesa = setTimeout(() => ok(true), 400))),
  ]);
  clearTimeout(attesa);
  return r;
}

/** Quando non c'è più niente in coda (per aggiornare la scheda dell'account appena le modifiche arrivano). */
export async function quandoTuttoArrivato(): Promise<void> {
  if (!sync) return;
  await (await motore()).scrittureArrivate();
}

function inviaPresto(): void {
  if (!sync) return;
  clearTimeout(timer);
  // finché si può ancora toccare "Annulla" non si manda niente: se si annulla, agli altri dispositivi non arriva
  // nessuna modifica, nessuna notifica e nessuna riga nello storico
  timer = setTimeout(() => {
    if (annullabile()) inviaPresto();
    else void inviaModifiche();
  }, 1200);
}

// ───────── accesso, avvio, uscita ─────────

let smettiDiAscoltare: (() => void) | null = null;

// l'ascolto si ferma dopo un errore (per esempio la quota del giorno superata): riparte da solo, con attese crescenti
const ATTESE_ASCOLTO = [5_000, 15_000, 60_000, 300_000];
let tentativiAscolto = 0;
let timerAscolto: ReturnType<typeof setTimeout> | undefined;
/** Ricezione delle modifiche degli altri ferma (errore che non è di accesso): si riprova da soli. */
export let ricezioneFerma = false;

async function ascolta(): Promise<void> {
  smettiDiAscoltare?.();
  clearTimeout(timerAscolto);
  timerAscolto = undefined;
  if (!sync) return;
  const m = await motore();
  smettiDiAscoltare = m.ascolta(
    sync.uid,
    () => sync?.voci ?? {},
    v => {
      tentativiAscolto = 0;
      ricezioneFerma = false;
      applica(v);
    },
    e => {
      avvisa('ascolto delle modifiche', e);
      if (!sync) return;
      if (erroreDiAccesso(e)) {
        sync.errore = messaggio(e);
        sync.scaduto = true;
        salvaStato();
        return;
      }
      ricezioneFerma = true;
      // i 4 ascolti (voci e formato vecchio) si fermano spesso insieme: un solo riavvio, con tutti chiusi
      if (timerAscolto) return;
      smettiDiAscoltare?.();
      smettiDiAscoltare = null;
      const attesa = ATTESE_ASCOLTO[Math.min(tentativiAscolto, ATTESE_ASCOLTO.length - 1)] ?? 300_000;
      tentativiAscolto++;
      timerAscolto = setTimeout(() => {
        timerAscolto = undefined;
        void ascolta();
      }, attesa);
    },
  );
}

export type EsitoAccesso =
  { ok: true } | { ok: false; motivo: 'annullato' | 'nessunAccount' | 'nonDisponibile' | 'rete'; dettaglio?: string };

/** Solo per le prove automatiche nel browser: un gettone finto per l'emulatore di Firebase. */
declare global {
  interface Window {
    __eurodexProva?: { idToken?: string };
  }
}

async function credenzialeGoogle(silenzioso: boolean): Promise<string> {
  if (nativo()) return (await Nativo.accediGoogle({ silenzioso })).idToken;
  const prova = window.__eurodexProva?.idToken;
  if (prova) return prova;
  throw new Error('nonDisponibile');
}

/** Perché non si è avuto il gettone di Google: annullato, nessun account sul telefono o accesso non disponibile. */
function esitoCredenziale(e: unknown): EsitoAccesso {
  const m = messaggio(e);
  if (/annullato/i.test(m)) return { ok: false, motivo: 'annullato' };
  if (/nessun account|NoCredential/i.test(m)) return { ok: false, motivo: 'nessunAccount' };
  return { ok: false, motivo: 'nonDisponibile', dettaglio: m };
}

/**
 * Solo l'accesso all'account Google, senza sincronizzare niente: serve con il muro acceso per chiedere l'accesso a
 * Eurodex (la sincronizzazione parte dopo, quando Valerio approva).
 */
export async function accediSoloAccount(): Promise<EsitoAccesso> {
  let idToken: string;
  try {
    idToken = await credenzialeGoogle(false);
  } catch (e) {
    return esitoCredenziale(e);
  }
  try {
    await (await firebase()).accediConToken(idToken);
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: 'rete', dettaglio: messaggio(e) };
  }
}

/**
 * Accesso con Google: da quel momento la collezione è quella dell'account, unita a quella di questo dispositivo
 * (niente va perso: quello che c'è solo qui si aggiunge all'account).
 */
export async function accedi(silenzioso = false): Promise<EsitoAccesso> {
  let idToken: string;
  try {
    idToken = await credenzialeGoogle(silenzioso);
  } catch (e) {
    return esitoCredenziale(e);
  }
  try {
    const user = await (await firebase()).accediConToken(idToken);
    const m = await motore();
    // stesso account di adesso, oppure lo stesso da cui si era usciti con "Esci" su questo dispositivo
    const uscito = sync ? null : leggiUscito();
    const stesso = sync?.uid === user.uid ? sync : uscito?.uid === user.uid ? uscito : null;
    const prima = sync;
    // stesso account (accesso scaduto e rifatto): le modifiche fatte qui e mai arrivate all'account valgono più di
    // quelle dell'account; tutto il resto lo decide l'account (anche le monete tolte da un altro dispositivo)
    const pendenti = stesso ? modificheLocali({ possedute, preferite, note }, stesso.voci) : null;
    const i = await infoDispositivo();
    const did = stesso?.did ?? (vecchio?.cid === user.uid ? vecchio.did : undefined) ?? casuale(12);
    sync = {
      uid: user.uid,
      email: user.email ?? '',
      account: user.displayName ?? '',
      did,
      nome: stesso?.nome ?? (vecchio?.cid === user.uid ? vecchio.nome : undefined) ?? nomeDispositivo(i),
      rinominato: stesso?.rinominato ?? (vecchio?.cid === user.uid ? !!vecchio.rinominato : false),
      orologio: stesso?.orologio ?? { ms: 0, c: 0 },
      // stesso account: si parte da quello che si conosceva (il server vince solo dove è più recente, il resto si
      // ripara); primo accesso o un altro account: da zero
      voci: stesso ? { ...stesso.voci } : {},
      errore: '',
      scaduto: false,
    };
    orologio = new Orologio(sync.did, sync.orologio);
    const copia = { possedute: [...possedute], preferite: [...preferite], note: { ...note } };
    try {
      await m.preparaRadice(user.uid);
      const remote = await m.leggiTutto(user.uid);
      // unione: prima quello che c'è già sull'account, poi quello che c'era solo qui (che quindi si aggiunge)
      for (const v of Object.values(remote)) orologio.ricevi(v.t);
      // primo accesso su questo dispositivo (o un altro account): quello che c'è solo qui si aggiunge all'account
      const soloQui = new Set([...possedute].filter(k => remote[`p:${k}`]?.v !== true));
      const prefSoloQui = new Set([...preferite].filter(k => remote[`f:${k}`]?.v !== true));
      const noteQui = Object.fromEntries(Object.entries(note).filter(([k]) => !remote[`n:${k}`]?.v));
      // al primo accesso non si riempie lo storico con tutta la collezione dell'account, e l'account decide le voci
      // (le modifiche di qui si rimettono sopra subito dopo: pendenti con lo stesso account, unione con uno nuovo)
      applica(remote, false, false);
      if (pendenti) riapplica({ possedute, preferite, note }, pendenti);
      else {
        for (const k of soloQui) possedute.add(k);
        for (const k of prefSoloQui) preferite.add(k);
        Object.assign(note, noteQui);
      }
      salva();
      await inviaModifiche();
      // senza aspettare la conferma del server (con la rete appena caduta l'accesso resterebbe appeso)
      void registraQuestoDispositivo().catch(() => undefined);
    } catch (e) {
      sync = prima;
      orologio = prima ? new Orologio(prima.did, prima.orologio) : null;
      // la collezione torna com'era prima dell'unione: niente monete di un altro account dentro questa
      sostituisci(possedute, copia.possedute);
      sostituisci(preferite, copia.preferite);
      sostituisciNote(copia.note);
      salva();
      salvaStato();
      registraErrore('accesso con Google', e);
      return { ok: false, motivo: 'rete', dettaglio: messaggio(e) };
    }
    localStorage.removeItem(LS_VECCHIO);
    localStorage.removeItem(LS_USCITO);
    salvaStato();
    await iscriviNotifiche();
    await ascolta();
    void aggiornaNomiDispositivi();
    return { ok: true };
  } catch (e) {
    registraErrore('accesso con Google', e);
    return { ok: false, motivo: 'rete', dettaglio: messaggio(e) };
  }
}

/** Esce dall'account su questo dispositivo: la collezione resta qui, ma non si sincronizza più. */
export async function esci(): Promise<void> {
  if (!sync) return;
  const s = sync;
  smettiDiAscoltare?.();
  smettiDiAscoltare = null;
  try {
    await (await motore()).togliDispositivo(s.uid, s.did);
  } catch {
    // senza rete il dispositivo resta nell'elenco finché non si riaccede
  }
  await (await firebase()).esci();
  // si tiene da parte quello che si sapeva: rientrando con lo stesso account, le monete tolte nel frattempo da un
  // altro dispositivo restano tolte (invece di ricomparire come aggiunte di questo)
  try {
    if (orologio) s.orologio = orologio.stato;
    localStorage.setItem(LS_USCITO, JSON.stringify({ ...s, errore: '', scaduto: false }));
  } catch {
    // spazio pieno: al riaccesso si fa l'unione come al primo accesso
  }
  sync = null;
  orologio = null;
  daAnnunciare.clear();
  clearTimeout(timerAnnuncio);
  clearTimeout(timerAscolto);
  timerAscolto = undefined;
  salvaStato();
  await iscriviNotifiche();
}

export async function rinomina(nome: string): Promise<void> {
  if (!sync) return;
  sync.nome = nome.trim().slice(0, 40);
  sync.rinominato = true;
  salvaStato();
  try {
    await registraQuestoDispositivo();
  } catch {
    // il nome nuovo arriva agli altri alla prossima sincronizzazione
  }
  await iscriviNotifiche();
}

/** Segue l'elenco dei dispositivi finché serve (restituisce la funzione per smettere). */
export async function seguiDispositivi(
  elenco: (l: Dispositivo[]) => void,
  errore: (e: unknown) => void,
): Promise<() => void> {
  if (!sync) return () => undefined;
  const uid = sync.uid;
  return (await motore()).ascoltaDispositivi(
    uid,
    l => {
      void usaElenco(l);
      elenco(l);
    },
    errore,
  );
}

/** All'avvio: si riprende la sessione salvata (o quella delle versioni vecchie, senza chiedere niente). */
export async function avviaSincronizzazione(): Promise<void> {
  quandoSalvato(inviaPresto);
  if (!sync && vecchio?.rt && vecchio.cid) {
    // aggiornamento da una versione vecchia: l'accesso si riprende da solo con l'account già autorizzato
    const r = await accedi(true);
    if (!r.ok) {
      accessoDaRifare = true;
      avvisa("ripresa dell'accesso dopo l'aggiornamento", r.dettaglio ?? r.motivo);
    }
    return;
  }
  if (!sync) {
    if (collegamentoConCodice) await iscriviNotifiche(); // via l'iscrizione alle notifiche del vecchio codice
    return;
  }
  orologio = new Orologio(sync.did, sync.orologio);
  try {
    const user = await (await firebase()).utenteSalvato();
    if (user?.uid !== sync.uid) {
      const r = await accedi(true);
      if (!r.ok) {
        sync.scaduto = true;
        salvaStato();
      }
      return;
    }
  } catch (e) {
    avvisa('ripresa della sessione', e);
  }
  await iscriviNotifiche();
  await ascolta();
  void aggiornaNomiDispositivi();
  void inviaModifiche();
  void registraQuestoDispositivo().catch(() => undefined);
}

/** Solo per le prove nel browser: telefono senza campo (false) e di nuovo in rete (true). */
export async function reteSyncProva(attiva: boolean): Promise<void> {
  await (await motore()).reteProva(attiva);
}

export function stessoDispositivo(did: string | undefined): boolean {
  return !!did && did === sync?.did;
}
