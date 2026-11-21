/**
 * I nomi che arrivano dall'indice dei dati scaricato (pagina di download) diventano percorsi di file nel telefono e
 * indirizzi da scaricare: si accettano solo quelli previsti, prima di usarli (R20, revisione di Claude 2). Così chi
 * riuscisse a modificare la pagina di download non può far scrivere file fuori dalla cartella dei dati.
 * Le stesse regole stanno in native/ScaricaDati.java (FOTO, FILE_DATI) e nel controllo di catalogo.yml.
 */
export const nomeFotoValido = (x: unknown): x is string =>
  typeof x === 'string' && /^img\/[0-9a-f]{1,64}\.webp$/.test(x);

export const nomeFileDatiValido = (x: unknown): x is string =>
  typeof x === 'string' && /^(catalog|details)(-[0-9]{1,9})?\.json$/.test(x);

export const revisioneValida = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
