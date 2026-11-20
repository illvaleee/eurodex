import type { CodiceTaglio, Taglio } from '../catalogo/tipi';

export const TAGLI: readonly Taglio[] = [
  { k: '1c', label: '1 cent', short: '1c', num: '1', unit: 'CENT', metal: 'cu' },
  { k: '2c', label: '2 cent', short: '2c', num: '2', unit: 'CENT', metal: 'cu' },
  { k: '5c', label: '5 cent', short: '5c', num: '5', unit: 'CENT', metal: 'cu' },
  { k: '10c', label: '10 cent', short: '10c', num: '10', unit: 'CENT', metal: 'au' },
  { k: '20c', label: '20 cent', short: '20c', num: '20', unit: 'CENT', metal: 'au' },
  { k: '50c', label: '50 cent', short: '50c', num: '50', unit: 'CENT', metal: 'au' },
  { k: '1e', label: '1 euro', short: '1€', num: '1', unit: 'EURO', metal: 'bi1' },
  { k: '2e', label: '2 euro', short: '2€', num: '2', unit: 'EURO', metal: 'bi2' },
];

export const TAGLIO = Object.fromEntries(TAGLI.map(d => [d.k, d])) as Record<CodiceTaglio, Taglio>;
export const ORDINE_TAGLI: readonly CodiceTaglio[] = TAGLI.map(d => d.k);
export const isTaglio = (d: string): d is CodiceTaglio => d in TAGLIO;

/** Stato di conservazione: sigla e nome per esteso, come si usano in Italia. */
export const CONSERVAZIONE: Record<string, string> = {
  g: 'D',
  vg: 'B',
  f: 'MB',
  vf: 'BB',
  xf: 'SPL',
  au: 'qFDC',
  unc: 'FDC',
};
export const CONSERVAZIONE_ESTESA: Record<string, string> = {
  g: 'Discreto',
  vg: 'Bello',
  f: 'Molto bello',
  vf: 'Bellissimo',
  xf: 'Splendido',
  au: 'Quasi fior di conio',
  unc: 'Fior di conio',
};

/** Tiratura fino a cui una moneta (non proof) si considera rara. */
export const TIRATURA_RARA = 100_000;
/** Per quanti giorni una moneta appena entrata in catalogo resta "nuova". */
export const GIORNI_NOVITA = 120;

const REPO_DOWNLOAD = 'illvaleee/collezione-euro-download';
/** Copia "raw" dei file pubblicati: veloce ma, per qualche minuto dopo una pubblicazione, a volte vecchia. */
export const RAW_DOWNLOAD = `https://raw.githubusercontent.com/${REPO_DOWNLOAD}/main/`;
/** API di GitHub: sempre aggiornata, si usa per i file piccoli che dicono "c'è qualcosa di nuovo". */
export const API_DOWNLOAD = `https://api.github.com/repos/${REPO_DOWNLOAD}/contents/`;

export const PACCHETTO_ANDROID = 'it.collezione.euro';
