import { render } from 'lit-html';
import { casuale } from '../core/rete';
import { registraErrore } from '../core/errori';
import { Nativo, nativo } from '../nativo/plugin';
import { avviso } from '../ui/avvisi';
import { schermataMuro } from '../viste/muro';
import type { MotivoTentativo, StatoAccesso } from './accesso';
import {
  arrivato,
  decidiMuro,
  esitoTentativo,
  indirizzoConfig,
  obbligoDaDocumento,
  pulitoPerRichiesta,
  type EsitoMuro,
  type EsitoTentativo,
} from './muro-logica';
import {
  accedi,
  accediSoloAccount,
  esci as esciDallaSincronizzazione,
  idDispositivo,
  infoDispositivo,
  modelloLeggibile,
  seguiAccessiGoogle,
  sincronizzazioneAttiva,
  sync,
  type EsitoAccesso,
} from './sincronizzazione';

/**
 * Il muro dell'accesso su approvazione, dalla parte dell'app (docs/progetto-accesso-su-approvazione.md e scelte di
 * Valerio del 21/11):
 * - ogni accesso con Google fatto dalla persona è un tentativo: la funzione tentativoDiAccesso crea la richiesta
 *   dell'account nuovo, oppure avvisa Valerio che uno già deciso è rientrato (approvato o rifiutato in automatico);
 * - muro acceso: chi non è approvato vede solo la schermata per accedere, quella di attesa o il no, e uscendo
 *   dall'account si torna lì; muro spento: tutti dentro, tranne gli account rifiutati o a cui Valerio ha tolto
 *   l'accesso.
 * È una cortesia: il muro vero sono le regole di Firestore. Senza account e con il muro spento qui non succede
 * niente (e Firebase non si carica nemmeno).
 */

const LS = 'eurodex.muro';
const LS_DID = 'eurodex.muro.did';
/** l'ultimo token registrato (uid|did|token): niente scritture a ogni avvio */
const LS_TOKEN = 'eurodex.muro.token';
/** account già fatti vedere a Valerio al primo avvio con questa versione (chi c'era già prima) */
const LS_PRIMO = 'eurodex.muro.primo';
/** l'ultimo account entrato su questo telefono (lo scrive accesso.ts: ricordaStato) */
const LS_ACCOUNT = 'eurodex.accesso';
const UN_MINUTO = 60 * 1000;

function leggi(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function scrivi(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // memoria non disponibile: alla prossima apertura si rifà
  }
}

let obbligo = leggi(LS) === '1';
let esito: EsitoMuro = 'aperto';
let utente: { uid: string; email: string; nome: string } | null = null;
let statoAccesso: StatoAccesso = 'nessuno';
let seguito: { uid: string; smetti: () => void } | null = null;
let tokenRegistrato = '';
/** account con un tentativo appena partito: la schermata aspetta la risposta invece di chiedere */
const inviati = new Set<string>();
/** «Chiedi di nuovo»: quando, per non farlo premere di continuo (Valerio riceve al massimo una notifica al minuto) */
let ancoraAlle = 0;

const accesso = () => import('./accesso');
const firebase = () => import('./firebase');

/** Il muro è sullo schermo (il tasto indietro di Android allora chiude l'app invece di andare dietro). */
export const muroAperto = (): boolean => esito !== 'aperto';
/** L'interruttore come lo conosce l'app adesso (per la sezione di Valerio). */
export const muroAcceso = (): boolean => obbligo;

function ricordaObbligo(v: boolean): void {
  obbligo = v;
  scrivi(LS, v ? '1' : '0');
}

/** L'interruttore letto dal server, senza accesso e senza caricare Firebase. Senza rete resta quello di prima. */
async function leggiObbligo(attesaMs: number): Promise<boolean> {
  const ferma = new AbortController();
  const timer = setTimeout(() => ferma.abort(), attesaMs);
  try {
    const r = await fetch(indirizzoConfig(location.search, nativo()), { cache: 'no-store', signal: ferma.signal });
    if (r.status === 404) ricordaObbligo(false);
    else if (r.ok) ricordaObbligo(obbligoDaDocumento(await r.json()));
  } catch {
    // senza rete o lento: vale l'ultimo valore conosciuto
  } finally {
    clearTimeout(timer);
  }
  return obbligo;
}

function mostra(nuovo: EsitoMuro): void {
  esito = nuovo;
  let el = document.getElementById('muro');
  if (nuovo === 'aperto') {
    el?.remove();
    document.body.classList.remove('con-muro');
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'muro';
    el.className = 'muro';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'murotit');
    document.body.appendChild(el);
  }
  document.body.classList.add('con-muro');
  render(schermataMuro(nuovo, utente?.email ?? '', Date.now() - ancoraAlle < UN_MINUTO), el);
}

/**
 * Il muro si è appena tolto (approvato, oppure Valerio l'ha spento): parte, o riparte, la sincronizzazione con
 * l'account con cui si è entrati, senza chiedere niente. Una volta sola anche se il muro si toglie da due parti
 * insieme (notifica, ritorno nell'app, risposta del server).
 */
let riprendendo = false;

async function riprendi(benvenuto: boolean): Promise<void> {
  if (!utente || riprendendo) return;
  riprendendo = true;
  try {
    if (benvenuto) avviso('Accesso approvato ✓ Benvenuto in Eurodex', 5000);
    if (!sincronizzazioneAttiva() || sync?.scaduto || sync?.uid !== utente.uid) {
      const r = await accedi(true);
      if (!r.ok) registraErrore('sincronizzazione dopo il muro', r.dettaglio ?? r.motivo);
    }
    await registraToken();
  } finally {
    riprendendo = false;
  }
}

function smettiDiSeguire(): void {
  seguito?.smetti();
  seguito = null;
}

/** Per le prove nel browser: le notizie arrivate della propria richiesta e le rivalutazioni del muro in corso. Si tocca
 * quando la schermata è ferma (dopo una modifica fatta dal server la pagina la riceve e ridisegna). */
let notizie = 0;
let valutazioni = 0;
export const muroPerLeProve = { notizie: (): number => notizie, inCorso: (): number => valutazioni };

function segui(uid: string): void {
  if (seguito?.uid === uid) return;
  smettiDiSeguire();
  const questo: { uid: string; smetti: () => void } = { uid, smetti: () => undefined };
  seguito = questo;
  void accesso().then(a => {
    if (seguito !== questo) return;
    questo.smetti = a.seguiAccesso(
      uid,
      (s, dalServer) => {
        notizie++;
        statoAccesso = s;
        a.ricordaStato(uid, s);
        // chi usava già Eurodex prima di questa versione: al primo avvio Valerio lo vede (in attesa nell'elenco)
        if (s === 'nessuno' && dalServer && !inviati.has(uid) && !giaVisto(uid)) void primoAvvio(uid);
        void valuta().catch((e: unknown) => registraErrore('controllo del muro', e));
      },
      // ascolto fermato (account uscito, rete persa a lungo): al prossimo controllo si riparte
      () => {
        if (seguito === questo) seguito = null;
      },
    );
  });
}

const giaVisto = (uid: string): boolean => (leggi(LS_PRIMO) ?? '').split(',').includes(uid);

async function primoAvvio(uid: string): Promise<void> {
  if (arrivato(await tentativo(uid, 'primo')))
    scrivi(LS_PRIMO, [...(leggi(LS_PRIMO) ?? '').split(',').filter(Boolean), uid].join(','));
}

/** Un tentativo di accesso di questo account: lo legge la funzione, che decide e avvisa Valerio. */
/** Quando questa app ha scritto l'ultimo tentativo di ogni account (per capire un rifiuto «troppo presto»). */
const scrittoAlle = new Map<string, number>();

async function tentativo(uid: string, motivo: MotivoTentativo): Promise<EsitoTentativo> {
  inviati.add(uid);
  try {
    const a = await accesso();
    await a.registraTentativo(uid, pulitoPerRichiesta(modelloLeggibile(await infoDispositivo())), motivo);
    scrittoAlle.set(uid, Date.now());
    return 'ok';
  } catch (e) {
    // già scritto (la scrittura rimandata), oppure troppo presto dopo quello di pochi secondi fa, che c'è: non sono
    // errori. Gli altri rifiuti e la rete sì
    const r = esitoTentativo((e as { code?: unknown } | null)?.code, Date.now() - (scrittoAlle.get(uid) ?? 0));
    if (r === 'ok') scrittoAlle.set(uid, Date.now());
    if (!arrivato(r)) {
      inviati.delete(uid);
      registraErrore('tentativo di accesso', e);
    }
    return r;
  }
}

/** L'account con cui si è entrati l'ultima volta su questo telefono, senza caricare Firebase. */
function accountQui(): boolean {
  try {
    return !!(JSON.parse(leggi(LS_ACCOUNT) ?? 'null') as { uid?: unknown } | null)?.uid;
  } catch {
    return false;
  }
}

/** Cambia schermata. Il «prima» si legge qui, subito prima di cambiare: se due controlli finiscono insieme, solo
 * uno vede il cambio (e la sincronizzazione riparte una volta sola). */
function cambia(nuovo: EsitoMuro, approvato: boolean): EsitoMuro {
  const prima = esito;
  mostra(nuovo);
  // il benvenuto solo per un'approvazione vera (non per chi è già approvato e ha appena rifatto l'accesso)
  if (prima !== 'aperto' && nuovo === 'aperto') void riprendi(approvato && prima !== 'accedi');
  return nuovo;
}

/** Decide di nuovo cosa mostrare, con quello che si sa adesso (interruttore, account, stato della richiesta). */
async function valuta(): Promise<EsitoMuro> {
  valutazioni++;
  try {
    return await valutaOra();
  } finally {
    valutazioni--;
  }
}

async function valutaOra(): Promise<EsitoMuro> {
  if (!obbligo && !utente && !sincronizzazioneAttiva() && !accountQui()) {
    smettiDiSeguire();
    return cambia('aperto', false);
  }
  const [f, a] = await Promise.all([firebase(), accesso()]);
  const u = await f.utenteSalvato();
  utente = u ? { uid: u.uid, email: u.email ?? '', nome: u.displayName ?? '' } : null;
  const admin = !!utente && a.eAmministratore(utente.uid);
  if (utente && !admin) {
    if (seguito?.uid !== utente.uid) statoAccesso = a.ultimoStato(utente.uid);
    segui(utente.uid);
  } else {
    smettiDiSeguire();
    statoAccesso = 'nessuno';
  }
  if (utente) void registraToken();
  const inviato = !!utente && inviati.has(utente.uid);
  return cambia(
    decidiMuro({ obbligo, uid: utente?.uid ?? null, admin, stato: statoAccesso, inviato }),
    statoAccesso === 'approvato',
  );
}

/**
 * All'avvio, prima di tutte le altre finestre: vero se il muro resta sullo schermo (allora non si mostrano
 * aggiornamenti, benvenuto e proposte). Aspetta il server al massimo un paio di secondi.
 */
export async function controllaMuro(): Promise<boolean> {
  await leggiObbligo(2500);
  try {
    return (await valuta()) !== 'aperto';
  } catch (e) {
    registraErrore('controllo del muro', e);
    return false;
  }
}

/** Al ritorno nell'app e dopo una notifica: l'interruttore o lo stato dell'account potrebbero essere cambiati. */
export async function aggiornaMuro(): Promise<void> {
  await leggiObbligo(8000);
  await valuta().catch((e: unknown) => registraErrore('controllo del muro', e));
}

/** Valerio ha appena cambiato l'interruttore da questo telefono. */
export function muroCambiato(v: boolean): void {
  ricordaObbligo(v);
  void valuta().catch((e: unknown) => registraErrore('controllo del muro', e));
}

/** Il codice di questo telefono per gli avvisi dell'accesso: quello della sincronizzazione, se c'è. */
function didAccesso(): string {
  const d = idDispositivo();
  if (d) return d;
  let x = leggi(LS_DID);
  if (!x) {
    x = casuale(12);
    scrivi(LS_DID, x);
  }
  return x;
}

/**
 * Il token di questo telefono per le notifiche dirette, sotto l'account con cui si è entrati: a Valerio arrivano
 * richieste e tentativi, agli altri l'approvazione o l'accesso tolto (e gli avvisi della sincronizzazione).
 */
async function registraToken(): Promise<void> {
  if (!nativo() || !utente) return;
  const uid = utente.uid;
  try {
    const { token } = await Nativo.tokenNotifiche();
    if (!token) return;
    const did = didAccesso();
    const chiave = `${uid}|${did}|${token}`;
    if (chiave === tokenRegistrato || chiave === leggi(LS_TOKEN)) {
      tokenRegistrato = chiave;
      return;
    }
    const nome = pulitoPerRichiesta(sync?.nome || modelloLeggibile(await infoDispositivo()));
    if (await (await accesso()).registraDispositivo(uid, did, token, nome)) {
      tokenRegistrato = chiave;
      scrivi(LS_TOKEN, chiave);
    }
  } catch (e) {
    // senza servizi Google o senza rete: niente notifiche dirette, il resto funziona
    registraErrore('registrazione per le notifiche dirette', e);
  }
}

/** Uscendo dall'account (serve ancora l'accesso): questo telefono non riceve più gli avvisi di quell'account. */
async function togliToken(uid: string): Promise<void> {
  const registrato = leggi(LS_TOKEN)?.split('|') ?? [];
  const did = registrato[0] === uid && registrato[1] ? registrato[1] : didAccesso();
  scrivi(LS_TOKEN, null);
  tokenRegistrato = '';
  try {
    await (await accesso()).togliDispositivo(uid, did);
  } catch {
    // senza rete: il telefono resta registrato, e gli avvisi che arrivano trovano il muro
  }
}

/** Uscito dall'account: con il muro acceso si torna subito alla schermata di accesso. */
async function dopoUscita(): Promise<void> {
  smettiDiSeguire();
  utente = null;
  statoAccesso = 'nessuno';
  (await accesso()).dimenticaStato();
  await valuta().catch((e: unknown) => registraErrore('controllo del muro', e));
}

/** Ogni accesso con Google fatto dalla persona (dal muro, dalle impostazioni, dopo una reinstallazione). */
async function dopoAccessoGoogle(uid: string): Promise<void> {
  const a = await accesso();
  if (a.eAmministratore(uid)) return;
  await tentativo(uid, 'accesso');
  // dal muro decide muroAccedi, dopo aver letto lo stato vero (niente «Richiesta inviata» per un attimo a chi è già
  // approvato); dalle impostazioni si controlla subito (un account escluso vede il no anche col muro spento)
  if (esito === 'accedi') return;
  // col muro spento la sincronizzazione di un account escluso non parte, e dopo un'uscita non resta niente di
  // salvato: senza questo il controllo non saprebbe dell'accesso e lascerebbe l'app aperta (lo rilegge da Firebase)
  utente ??= { uid, email: '', nome: '' };
  await valuta().catch((e: unknown) => registraErrore('controllo del muro', e));
}

/** Il tentativo dell'ultimo accesso, finché non è scritto (il muro lo aspetta prima di far ripartire la
 * sincronizzazione, che rifà l'accesso: così la scrittura non riparte due volte). */
let tentativoInCorso: Promise<void> = Promise.resolve();

seguiAccessiGoogle({
  accesso: uid => {
    tentativoInCorso = dopoAccessoGoogle(uid).catch((e: unknown) => registraErrore('tentativo di accesso', e));
  },
  primaDiUscire: uid => togliToken(uid),
  uscito: () => void dopoUscita(),
});

/** Dopo la sincronizzazione all'avvio, e quando Valerio apre la sua sezione: il telefono riceve gli avvisi. */
export async function preparaNotifiche(): Promise<void> {
  if (!sync) return;
  utente ??= { uid: sync.uid, email: sync.email, nome: sync.account };
  await registraToken();
}

/** «Chiedi l'accesso» dalle impostazioni (se la richiesta automatica non era partita, per esempio senza rete). */
export async function chiediDalleImpostazioni(): Promise<boolean> {
  if (!sync) return false;
  utente ??= { uid: sync.uid, email: sync.email, nome: sync.account };
  const ok = arrivato(await tentativo(sync.uid, 'accesso'));
  if (ok) void registraToken();
  return ok;
}

// ───────── i pulsanti della schermata ─────────

/** Il server accetta un tentativo ogni 20 secondi per account: quello di poco fa Valerio l'ha già (l'accesso stesso
 * è una richiesta), quindi lo si dice così e non come un errore di rete. */
const GIA_INVIATA = 'Richiesta già inviata ✓ Valerio la vede';

/** Non arrivata: senza rete, oppure rifiutata dal server per un altro motivo (non si parla di rete). */
const nonInviata = (r: EsitoTentativo): string =>
  r === 'rifiutato'
    ? 'Richiesta non inviata: riprova tra qualche secondo'
    : 'Richiesta non inviata: sei connesso a internet?';

function spiega(r: EsitoAccesso): void {
  // negato: lo dice la schermata stessa
  if (r.ok || r.motivo === 'annullato' || r.motivo === 'negato') return;
  if (r.motivo === 'nessunAccount')
    avviso("Su questo dispositivo non c'è un account Google: aggiungilo nelle Impostazioni di Android");
  else if (r.motivo === 'nonDisponibile')
    avviso(
      r.dettaglio === 'nonDisponibile'
        ? "L'accesso con Google si fa nell'app installata sul telefono"
        : `Accesso non riuscito: ${r.dettaglio ?? ''}`,
    );
  else avviso('Accesso non riuscito: sei connesso a internet?');
}

export async function muroAccedi(): Promise<void> {
  // il tentativo parte da solo (seguiAccessiGoogle)
  const r = await accediSoloAccount();
  spiega(r);
  if (!r.ok) return;
  await Promise.race([tentativoInCorso, new Promise(ok => setTimeout(ok, 5000))]);
  // prima di cambiare schermata, lo stato vero dal server: chi è già approvato entra subito, chi è già stato
  // rifiutato vede subito il no (senza passare da «Richiesta inviata»)
  try {
    const [f, a] = await Promise.all([firebase(), accesso()]);
    const u = await f.utenteSalvato();
    if (u && !a.eAmministratore(u.uid)) {
      statoAccesso = await a.leggiAccesso(u.uid);
      a.ricordaStato(u.uid, statoAccesso);
    }
  } catch {
    // senza rete: si decide con quello che si sa, e lo stato arriva appena torna la rete
  }
  await valuta();
}

/** La schermata «Chiedi l'accesso» (la richiesta automatica non era partita, per esempio senza rete). */
export async function muroChiedi(): Promise<void> {
  if (!utente) return;
  const r = await tentativo(utente.uid, 'accesso');
  if (!arrivato(r)) {
    avviso(nonInviata(r));
    return;
  }
  await valuta();
  avviso(r === 'ok' ? 'Richiesta inviata ✓ Valerio la riceve subito' : GIA_INVIATA, 5000);
}

/** «Chiedi di nuovo» per chi è stato rifiutato o non ha più l'accesso: Valerio lo vede e può cambiare idea. */
export async function muroAncora(): Promise<void> {
  if (!utente || Date.now() - ancoraAlle < UN_MINUTO) return;
  const r = await tentativo(utente.uid, 'ancora');
  if (!arrivato(r)) {
    avviso(nonInviata(r));
    return;
  }
  ancoraAlle = Date.now();
  mostra(esito);
  // dopo un minuto si può chiedere ancora
  setTimeout(() => {
    if (esito !== 'aperto') mostra(esito);
  }, UN_MINUTO + 100);
  avviso(r === 'ok' ? 'Richiesta inviata di nuovo ✓ Valerio la vede' : GIA_INVIATA, 5000);
}

/** «Usa un altro account»: si esce da questo e si torna alla schermata di accesso. */
export async function muroEsci(): Promise<void> {
  if (utente) await togliToken(utente.uid);
  if (sincronizzazioneAttiva()) await esciDallaSincronizzazione();
  await (await firebase()).esci();
  await dopoUscita();
}
