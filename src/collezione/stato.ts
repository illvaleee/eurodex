import { fogliAperti } from '../core/dom';

/**
 * La collezione dell'utente e le sue impostazioni: tutto quello che sceglie o scrive.
 * Si salva nel telefono (localStorage) a ogni modifica; chi deve reagire (backup nei file, sincronizzazione,
 * pagina da ridisegnare) si iscrive con `quandoSalvato`.
 */

export type ModoCatalogo = 'paesi' | 'anni' | 'tagli' | 'comm';
export type Ordinamento = 'paese' | 'anno' | 'taglio' | 'rari' | 'valore';
export type ModoMie = 'taglio' | 'paese' | 'anno';
export type FiltroExtra = 'tutte' | 'mie' | 'mancano';
export type Sfondo = 'predefinito' | 'colore' | 'foto';
export type FrequenzaDrive = 'sempre' | 'giorno' | 'settimana' | 'mese';

export interface Preferenze {
  onlyMissing: boolean;
  album: boolean;
  sortMiss: Ordinamento;
  sortSearch: Ordinamento;
  catMode: ModoCatalogo;
  paesiMap: boolean;
  avvisi: boolean;
  noProof?: boolean;
  /** Varianti solo nella scheda Extra (acceso se non c'è). */
  noExtra?: boolean;
  mineMode?: ModoMie;
  extraFiltro?: FiltroExtra;
  /** Sfondo scelto; le versioni vecchie potevano salvare qui anche il nome di un colore fisso ("cielo", "oro"…). */
  sfondo?: string;
  sfondoVis?: number;
  colore?: string;
  fotoMedia?: string;
  fotoId?: string;
  driveFreq?: FrequenzaDrive;
}

export const PREFERENZE_INIZIALI: Readonly<Preferenze> = {
  onlyMissing: false,
  album: false,
  sortMiss: 'paese',
  sortSearch: 'anno',
  catMode: 'paesi',
  paesiMap: false,
  avvisi: true,
};

export interface FirmaCatalogo {
  v: number;
  ids: string[];
  foto: string[];
  pezzi: number;
}

export interface Meta {
  saved: number;
  lastExport: number;
  drive: { nome: string; dove: string } | null;
  driveAt: number;
  driveErr: string;
  driveSporco?: boolean;
  updChecked: number;
  created: number;
  datiVista?: number;
  datiChecked?: number;
  firma?: FirmaCatalogo;
  novitaVista?: number;
  benvenuto?: number;
  chiestoAvvisi?: number;
  propostaSync?: number;
}

/** Una voce dello storico: [secondi, aggiunta o tolta, chiave del pezzo, "d" = solo data | "@dispositivo"]. */
export type VoceStorico = [number, '+' | '-', string, string?];

export const LIMITE_STORICO = 25_000;
const STORICO_DA_TENERE = 20_000;

export const possedute = new Set<string>();
export const preferite = new Set<string>();
export const note: Record<string, string> = {};
export const storico: VoceStorico[] = [];
export const prefs: Preferenze = { ...PREFERENZE_INIZIALI };
export const meta: Meta = {
  saved: 0,
  lastExport: 0,
  drive: null,
  driveAt: 0,
  driveErr: '',
  updChecked: 0,
  created: Date.now(),
};

// ───────── sostituzioni intere (ripristino, importazione, sincronizzazione) ─────────

export function sostituisci<T>(insieme: Set<T>, valori: Iterable<T>): void {
  insieme.clear();
  for (const v of valori) insieme.add(v);
}

export function sostituisciNote(nuove: Record<string, string>): void {
  for (const k of Object.keys(note)) Reflect.deleteProperty(note, k);
  Object.assign(note, nuove);
}

export function sostituisciStorico(voci: readonly VoceStorico[]): void {
  storico.splice(0, storico.length, ...voci);
}

export function sostituisciPreferenze(nuove: Partial<Preferenze>): void {
  for (const k of Object.keys(prefs)) Reflect.deleteProperty(prefs, k);
  Object.assign(prefs, PREFERENZE_INIZIALI, nuove);
}

export function accorciaStorico(): void {
  if (storico.length > LIMITE_STORICO) storico.splice(0, storico.length - STORICO_DA_TENERE);
}

export function registraModifica(op: '+' | '-', chiavi: Iterable<string>): void {
  const ts = Math.floor(Date.now() / 1000);
  for (const k of chiavi) storico.push([ts, op, k]);
  accorciaStorico();
}

// ───────── formato dei backup ─────────

export interface Backup {
  app?: string;
  versione?: number;
  data?: string;
  salvato?: number;
  possedute: string[];
  preferiti?: string[];
  note?: Record<string, string>;
  storico?: VoceStorico[];
  preferenze?: Partial<Preferenze>;
  sfondoFoto?: string;
  meta?: Partial<Meta>;
}

/** I backup delle primissime versioni erano solo l'elenco delle monete. */
export type BackupQualsiasi = Backup | string[];

const LS = 'collezioneEuro.v3';
const LS_VECCHIO = 'collezioneEuro.v2';

/** Tutto quello che l'utente ha scelto o scritto; `fotoSfondo` solo nei file di backup (non nel telefono). */
export function serializza(fotoSfondo?: string | null): string {
  const b: Backup = {
    app: 'collezione-euro',
    versione: 3,
    data: new Date().toISOString().slice(0, 10),
    salvato: meta.saved,
    possedute: [...possedute],
    preferiti: [...preferite],
    note,
    storico: storico.slice(-STORICO_DA_TENERE),
    preferenze: prefs,
    ...(fotoSfondo && prefs.sfondo === 'foto' ? { sfondoFoto: fotoSfondo } : {}),
  };
  return JSON.stringify(b);
}

export function elencoPossedute(b: unknown): string[] | null {
  if (Array.isArray(b)) return b.map(String);
  if (b && typeof b === 'object' && Array.isArray((b as Backup).possedute)) return (b as Backup).possedute.map(String);
  return null;
}

/**
 * Mette al posto della collezione attuale quella di un backup. Con `conAspetto` anche le impostazioni del
 * dispositivo (sfondo, colori, vista, ordinamenti) si sostituiscono tutte; restano di questo telefono il permesso
 * delle notifiche e la frequenza del file di Drive collegato qui.
 */
export function applica(b: BackupQualsiasi, conAspetto = true): void {
  const elenco = elencoPossedute(b);
  if (!elenco) throw new Error('formato');
  sostituisci(possedute, elenco);
  if (Array.isArray(b)) return;
  if (Array.isArray(b.preferiti)) sostituisci(preferite, b.preferiti.map(String));
  if (b.note && typeof b.note === 'object') sostituisciNote(b.note);
  if (Array.isArray(b.storico)) sostituisciStorico(b.storico);
  if (conAspetto) applicaAspetto(b);
}

/** Solo l'aspetto di un backup (sfondo, colori, vista, ordinamenti); restano di questo telefono avvisi e Drive. */
export function applicaAspetto(b: Backup): void {
  if (!b.preferenze || typeof b.preferenze !== 'object') return;
  const { avvisi, driveFreq } = prefs;
  sostituisciPreferenze(b.preferenze);
  prefs.avvisi = avvisi;
  if (driveFreq) prefs.driveFreq = driveFreq;
  else delete prefs.driveFreq;
}

/** La collezione viva (per l'"Annulla" che rimette solo quello che un'operazione ha cambiato). */
export const collezioneViva = () => ({ possedute, preferite, note, storico });

export function carica(): boolean {
  try {
    const r = localStorage.getItem(LS);
    if (r) {
      const b = JSON.parse(r) as Backup;
      applica(b);
      Object.assign(meta, b.meta ?? {});
      meta.saved = b.salvato ?? meta.saved;
      return true;
    }
    const vecchio = localStorage.getItem(LS_VECCHIO);
    if (vecchio) {
      sostituisci(possedute, JSON.parse(vecchio) as string[]);
      return true;
    }
  } catch {
    // dati illeggibili: si parte da una collezione vuota (i backup nei file restano)
  }
  return false;
}

/** Riscrive solo le informazioni di servizio (es. dopo un salvataggio su Drive), senza contare come modifica. */
export function salvaMeta(): void {
  try {
    const r = localStorage.getItem(LS);
    if (!r) return;
    const b = JSON.parse(r) as Backup;
    b.meta = meta;
    localStorage.setItem(LS, JSON.stringify(b));
  } catch {
    // spazio pieno o dati illeggibili: ci si riprova alla prossima modifica
  }
}

type Ascoltatore = () => void;
const ascoltatori: Ascoltatore[] = [];
export function quandoSalvato(f: Ascoltatore): void {
  ascoltatori.push(f);
}

/** La pagina sotto una scheda aperta va ridisegnata quando la scheda si chiude (stella, moneta segnata, nota…). */
export let vistaSporca = false;
export function vistaPulita(): void {
  vistaSporca = false;
}

export function salva(): void {
  meta.saved = Date.now();
  meta.driveSporco = true;
  if (fogliAperti()) vistaSporca = true;
  try {
    const b = JSON.parse(serializza()) as Backup;
    b.meta = meta;
    localStorage.setItem(LS, JSON.stringify(b));
  } catch {
    // spazio pieno: restano i backup nei file
  }
  for (const f of ascoltatori) f();
}
