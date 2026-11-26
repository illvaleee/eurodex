import { HOST_EMULATORI } from '../core/costanti';
import { Nativo, nativo } from './plugin';

/**
 * Le prove automatiche via adb (§9.7 B): `debug.eurodex.prove`, `debug.eurodex.muro` e `debug.eurodex.emulatori` le
 * può scrivere solo chi ha il telefono collegato con adb. Nel browser non ci sono. Si leggono una volta sola.
 */
export interface ModoProve {
  /** la schermata del muro non si mostra (indirizzi e regole restano quelli veri) */
  prove: boolean;
  /** 'acceso': il muro vale acceso su questo telefono, qualunque cosa dica il server (può solo chiudere) */
  muro: string;
  /** tutto va agli emulatori di Firebase del telefono simulato, mai metà e metà */
  emulatori: boolean;
}

const NESSUNO: ModoProve = { prove: false, muro: '', emulatori: false };
let promessa: Promise<ModoProve> | null = null;
let noto: ModoProve = NESSUNO;

export function modoProve(): Promise<ModoProve> {
  promessa ??= (
    nativo()
      ? Nativo.modoProve()
          .then(m => ({ prove: m.prove, muro: m.muro || '', emulatori: m.emulatori === true }))
          .catch(() => NESSUNO)
      : Promise.resolve(NESSUNO)
  ).then(m => (noto = m));
  return promessa;
}

export { HOST_EMULATORI };

/** Gli emulatori nell'app: main.ts aspetta modoProve() prima di usare Firebase, quindi qui il valore è già noto. */
export const emulatoriNativi = (): boolean => noto.emulatori;
