import { Nativo, annullato, nativo } from '../nativo/plugin';

/**
 * La sessione di Firebase della parte nativa (passo 5): serve a scaricare versioni e catalogo da Storage, anche in
 * secondo piano (docs/progetto-accesso-su-approvazione.md, §9.4). Si apre insieme all'accesso con Google. Chi era già
 * entrato prima della 1.0.84 ha solo quella della parte web, e la apre con un tocco: stesso account, e nessun nuovo
 * tentativo di accesso, perché la parte web non rifà l'accesso.
 */

/** Vero se la parte nativa ha la sessione di questo account (una sessione di un altro account si chiude). */
export async function sessioneNativaPronta(uid: string): Promise<boolean> {
  if (!nativo()) return true;
  try {
    return (await Nativo.sessioneNativa({ uid })).uid === uid;
  } catch {
    return false;
  }
}

export type EsitoSessione = 'ok' | 'annullato' | 'altroAccount' | 'nessunAccount' | 'errore';

const senzaAccount = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === 'NESSUN_ACCOUNT';

/** Apre la sessione nativa con lo stesso account della parte web (uid). Se Google ne dà un altro, non si tiene. */
export async function apriSessioneNativa(uid: string): Promise<EsitoSessione> {
  let r: { uidNativo?: string };
  try {
    try {
      // l'account che ha già dato il permesso all'app: con uno solo nessuna scelta, con più account la scelta
      r = await Nativo.accediGoogle({ silenzioso: true });
    } catch (e) {
      if (!senzaAccount(e)) throw e;
      // nessun account che abbia già dato il permesso: la finestra di Google con tutti gli account
      r = await Nativo.accediGoogle({ silenzioso: false });
    }
  } catch (e) {
    if (annullato(e)) return 'annullato';
    return senzaAccount(e) ? 'nessunAccount' : 'errore';
  }
  if (r.uidNativo === uid) return 'ok';
  if (!r.uidNativo) return 'errore';
  await Nativo.esciNativo().catch(() => undefined);
  return 'altroAccount';
}
