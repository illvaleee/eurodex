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

const codice = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;
const senzaAccount = (e: unknown): boolean => codice(e) === 'NESSUN_ACCOUNT';
const altroAccount = (e: unknown): boolean => codice(e) === 'ALTRO_ACCOUNT';

/**
 * Apre la sessione nativa con lo stesso account della parte web (uid ed email). Un altro account lo rifiuta già la
 * parte nativa, prima di aprire la sessione; se comunque arriva un uid diverso, la sessione non si tiene.
 */
export async function apriSessioneNativa(uid: string, email: string): Promise<EsitoSessione> {
  let r: { uidNativo?: string };
  try {
    try {
      // l'account che ha già dato il permesso all'app: con uno solo nessuna scelta, con più account la scelta
      r = await Nativo.accediGoogle({ silenzioso: true, email });
    } catch (e) {
      if (!senzaAccount(e) && !altroAccount(e)) throw e;
      // nessun account che abbia già dato il permesso, o uno diverso da quello della parte web: la finestra di Google
      // con tutti gli account, per scegliere quello giusto (senza, «Continua» ridarebbe sempre lo stesso)
      r = await Nativo.accediGoogle({ silenzioso: false, email });
    }
  } catch (e) {
    if (annullato(e)) return 'annullato';
    if (altroAccount(e)) return 'altroAccount';
    return senzaAccount(e) ? 'nessunAccount' : 'errore';
  }
  if (r.uidNativo === uid) return 'ok';
  if (!r.uidNativo) return 'errore';
  await Nativo.esciNativo().catch(() => undefined);
  return 'altroAccount';
}
