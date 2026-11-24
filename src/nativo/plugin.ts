import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Il plugin Android dell'app (native/NativoPlugin.java): ogni metodo qui corrisponde a un @PluginMethod. */
export interface NativoPlugin {
  infoDispositivo(): Promise<InfoDispositivo>;
  accediGoogle(o?: { silenzioso?: boolean }): Promise<{ idToken: string; email?: string; nome?: string }>;
  impostaSync(o: { cid: string; did?: string; nome?: string }): Promise<void>;
  scrivi(o: { testo: string }): Promise<void>;
  /** Con "aperto" il file appena scelto per un ripristino, altrimenti il file del backup collegato. */
  leggi(o?: { aperto?: boolean }): Promise<{ testo: string }>;
  statoFile(): Promise<{ collegato: boolean; nome?: string; dove?: string }>;
  scegliFile(o: { nome: string }): Promise<{ nome?: string; dove?: string }>;
  /** Sceglie un file da cui ripristinare (non cambia il file del backup). */
  apriFile(): Promise<{ nome?: string; dove?: string }>;
  /** Ripristino confermato: il file aperto diventa il file del backup. */
  collegaAperto(): Promise<{ nome?: string; dove?: string }>;
  /** Il file aperto per un ripristino non si collega: si toglie il suo permesso. */
  rilasciaAperto(): Promise<void>;
  scollega(): Promise<void>;
  pianificaControlli(o: { attivi: boolean }): Promise<void>;
  iscriviAvvisi(o: { attivi: boolean }): Promise<{ ok: boolean; errore?: string }>;
  permessoNotifiche(): Promise<void>;
  statoNotifiche(): Promise<{ attive: boolean }>;
  datiApplicati(o: { rev: number }): Promise<void>;
  puoInstallare(): Promise<{ permesso: boolean }>;
  permessoInstallazione(): Promise<void>;
  scaricaEInstalla(o: { url: string; size: number }): Promise<void>;
  azioneIniziale(): Promise<{ azione?: string }>;
  barre(o: { colore: string; iconeChiare: boolean }): Promise<void>;
  registra(o: { livello: 'errore' | 'avviso'; testo: string }): Promise<void>;
  /** Il token di questo telefono per le notifiche dirette (accesso su approvazione). */
  tokenNotifiche(): Promise<{ token?: string }>;
  addListener(evento: 'download', f: (e: { percento: number }) => void): Promise<PluginListenerHandle>;
  addListener(evento: 'azione', f: (e: { azione?: string }) => void): Promise<PluginListenerHandle>;
  addListener(
    evento: 'accesso',
    f: (e: { tipo?: string; titolo?: string; testo?: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    evento: 'sincronizza',
    f: (e: { did?: string; nome?: string; testo?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export interface InfoDispositivo {
  marca: string;
  modello: string;
  nome?: string;
  tablet?: boolean;
}

export const Nativo = registerPlugin<NativoPlugin>('Nativo');

/** Vero nell'app installata (Android), falso nell'anteprima nel browser e nelle prove. */
export const nativo = (): boolean => Capacitor.isNativePlatform();

/** Messaggio leggibile da un errore qualsiasi. */
export function messaggio(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** L'utente ha chiuso la finestra di sistema senza scegliere: non è un errore da mostrare. */
export const annullato = (e: unknown): boolean => /annullato|cancel/i.test(messaggio(e));
