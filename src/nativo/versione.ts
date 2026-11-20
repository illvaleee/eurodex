/** Versione installata (www/version.json, scritto dalla compilazione). Nell'anteprima nel browser non c'è. */
export interface VersioneApp {
  code: number;
  version: string;
}

export let versioneApp: VersioneApp | null = null;

export async function leggiVersioneApp(): Promise<void> {
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (r.ok) versioneApp = (await r.json()) as VersioneApp;
  } catch {
    versioneApp = null;
  }
}
