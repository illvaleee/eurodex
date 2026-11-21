import { render } from 'lit-html';
import { casuale } from '../core/rete';
import { registraErrore } from '../core/errori';
import { Nativo, nativo } from '../nativo/plugin';
import { avviso } from '../ui/avvisi';
import { schermataMuro } from '../viste/muro';
import type { StatoAccesso } from './accesso';
import { decidiMuro, indirizzoConfig, obbligoDaDocumento, pulitoPerRichiesta, type EsitoMuro } from './muro-logica';
import {
  accedi,
  accediSoloAccount,
  esci as esciDallaSincronizzazione,
  idDispositivo,
  infoDispositivo,
  modelloLeggibile,
  sincronizzazioneAttiva,
  sync,
  type EsitoAccesso,
} from './sincronizzazione';

/**
 * Il muro dell'accesso su approvazione, dalla parte dell'app (docs/progetto-accesso-su-approvazione.md): quando
 * Valerio lo accende, chi non è approvato vede solo la schermata per accedere e chiedere l'accesso. È una cortesia:
 * il muro vero sono le regole di Firestore, che senza approvazione non danno né sincronizzazione né notifiche.
 * Finché il muro è spento, qui non succede niente (e Firebase non si carica nemmeno).
 */

const LS = 'eurodex.muro';
const LS_DID = 'eurodex.muro.did';

function leggiSalvato(): boolean {
  try {
    return localStorage.getItem(LS) === '1';
  } catch {
    return false;
  }
}

let obbligo = leggiSalvato();
let esito: EsitoMuro = 'aperto';
let utente: { uid: string; email: string; nome: string } | null = null;
let statoAccesso: StatoAccesso = 'nessuno';
let seguito: { uid: string; smetti: () => void } | null = null;
let tokenRegistrato = '';

const accesso = () => import('./accesso');
const firebase = () => import('./firebase');

/** Il muro è sullo schermo (il tasto indietro di Android allora chiude l'app invece di andare dietro). */
export const muroAperto = (): boolean => esito !== 'aperto';
/** L'interruttore come lo conosce l'app adesso (per la sezione di Valerio). */
export const muroAcceso = (): boolean => obbligo;

function ricordaObbligo(v: boolean): void {
  obbligo = v;
  try {
    localStorage.setItem(LS, v ? '1' : '0');
  } catch {
    // memoria non disponibile: alla prossima apertura si rilegge dal server
  }
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
  render(schermataMuro(nuovo, utente?.email ?? ''), el);
}

/**
 * Il muro si è appena tolto (approvato, oppure Valerio l'ha spento): parte, o riparte, la sincronizzazione con
 * l'account con cui si è entrati, senza chiedere niente.
 */
async function riprendi(approvato: boolean): Promise<void> {
  if (!utente) return;
  if (approvato) avviso('Accesso approvato ✓ Benvenuto in Eurodex', 5000);
  if (!sincronizzazioneAttiva() || sync?.scaduto || sync?.uid !== utente.uid) {
    const r = await accedi(true);
    if (!r.ok) registraErrore('sincronizzazione dopo il muro', r.dettaglio ?? r.motivo);
  }
}

function segui(uid: string): void {
  if (seguito?.uid === uid) return;
  seguito?.smetti();
  seguito = { uid, smetti: () => undefined };
  const questo = seguito;
  void accesso().then(a => {
    if (seguito !== questo) return;
    questo.smetti = a.seguiAccesso(uid, s => {
      statoAccesso = s;
      a.ricordaStato(uid, s);
      void valuta();
    });
  });
}

/** Decide di nuovo cosa mostrare, con quello che si sa adesso (interruttore, account, stato della richiesta). */
async function valuta(): Promise<EsitoMuro> {
  const prima = esito;
  if (!obbligo) {
    mostra('aperto');
    if (prima !== 'aperto') void riprendi(false);
    return 'aperto';
  }
  const [f, a] = await Promise.all([firebase(), accesso()]);
  const u = await f.utenteSalvato();
  utente = u ? { uid: u.uid, email: u.email ?? '', nome: u.displayName ?? '' } : null;
  const admin = !!utente && a.eAmministratore(utente.uid);
  if (utente && !admin) {
    if (seguito?.uid !== utente.uid) statoAccesso = a.ultimoStato(utente.uid);
    segui(utente.uid);
  } else {
    seguito?.smetti();
    seguito = null;
    statoAccesso = 'nessuno';
  }
  const nuovo = decidiMuro({ obbligo, uid: utente?.uid ?? null, admin, stato: statoAccesso });
  mostra(nuovo);
  if (prima !== 'aperto' && nuovo === 'aperto') void riprendi(statoAccesso === 'approvato');
  if (nuovo === 'attesa' || admin) void registraToken();
  return nuovo;
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

/** Al ritorno nell'app e dopo una notifica: l'interruttore potrebbe essere cambiato. */
export async function aggiornaMuro(): Promise<void> {
  const prima = obbligo;
  await leggiObbligo(8000);
  if (obbligo !== prima || obbligo) await valuta().catch((e: unknown) => registraErrore('controllo del muro', e));
}

/** Valerio ha appena cambiato l'interruttore da questo telefono. */
export function muroCambiato(v: boolean): void {
  ricordaObbligo(v);
  void valuta().catch((e: unknown) => registraErrore('controllo del muro', e));
}

/**
 * Il telefono di Valerio riceve le richieste nuove, quello di chi aspetta la risposta riceve l'approvazione: il
 * token per le notifiche dirette va scritto sotto il suo account (le regole lo permettono solo a lui).
 */
async function registraToken(): Promise<void> {
  if (!nativo() || !utente) return;
  try {
    const { token } = await Nativo.tokenNotifiche();
    if (!token || token === tokenRegistrato) return;
    const a = await accesso();
    let did = idDispositivo();
    if (!did) {
      did = localStorage.getItem(LS_DID) ?? casuale(12);
      localStorage.setItem(LS_DID, did);
    }
    const nome = sync?.nome || modelloLeggibile(await infoDispositivo());
    if (await a.registraDispositivo(utente.uid, did, token, pulitoPerRichiesta(nome))) tokenRegistrato = token;
  } catch (e) {
    // senza servizi Google o senza rete: niente notifiche dirette, il resto funziona
    registraErrore('registrazione per le notifiche dirette', e);
  }
}

/** Dopo «Chiedi l'accesso» dalle impostazioni: il telefono si registra per l'avviso di approvazione. */
export async function dopoRichiesta(): Promise<void> {
  if (!sync) return;
  utente = { uid: sync.uid, email: sync.email, nome: sync.account };
  await registraToken();
}

/** Per Valerio, a ogni avvio con l'accesso fatto: così le richieste nuove gli arrivano come notifica. */
export async function preparaAmministratore(): Promise<void> {
  if (!sync) return;
  const a = await accesso();
  if (!a.eAmministratore(sync.uid)) return;
  utente = { uid: sync.uid, email: sync.email, nome: sync.account };
  await registraToken();
}

// ───────── i pulsanti della schermata ─────────

function spiega(r: EsitoAccesso): void {
  if (r.ok || r.motivo === 'annullato') return;
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
  const r = await accediSoloAccount();
  spiega(r);
  if (r.ok) await valuta();
}

export async function muroChiedi(): Promise<void> {
  if (!utente) return;
  try {
    const a = await accesso();
    const telefono = modelloLeggibile(await infoDispositivo());
    await a.chiediAccesso(utente.uid, pulitoPerRichiesta(utente.nome), utente.email, pulitoPerRichiesta(telefono));
    statoAccesso = 'in_attesa';
    a.ricordaStato(utente.uid, 'in_attesa');
    await valuta();
    avviso('Richiesta inviata ✓ Valerio la riceve subito', 5000);
  } catch (e) {
    registraErrore("richiesta d'accesso", e);
    avviso('Richiesta non inviata: sei connesso a internet?');
  }
}

export async function muroEsci(): Promise<void> {
  seguito?.smetti();
  seguito = null;
  if (sincronizzazioneAttiva()) await esciDallaSincronizzazione();
  await (await firebase()).esci();
  utente = null;
  statoAccesso = 'nessuno';
  tokenRegistrato = '';
  await valuta();
}
