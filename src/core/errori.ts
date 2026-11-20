import { Nativo, messaggio, nativo } from '../nativo/plugin';

/**
 * Errori non previsti: finiscono nel registro di Android (logcat, etichetta "Eurodex"), dove li vedono le prove
 * automatiche e, se serve, chi indaga su un problema. L'app intanto continua a funzionare.
 */
export function registraErrore(dove: string, e: unknown): void {
  const testo = `${dove}: ${messaggio(e)}${e instanceof Error && e.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : ''}`;
  console.error(testo);
  if (nativo()) Nativo.registra({ livello: 'errore', testo }).catch(() => undefined);
}

export function avvisa(dove: string, e: unknown): void {
  const testo = `${dove}: ${messaggio(e)}`;
  console.warn(testo);
  if (nativo()) Nativo.registra({ livello: 'avviso', testo }).catch(() => undefined);
}

export function installaGestoreErrori(): void {
  window.addEventListener('error', e => {
    registraErrore('errore', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', e => {
    registraErrore('promessa rifiutata', e.reason);
  });
}

/** Esegue un'operazione che può fallire senza conseguenze (es. un salvataggio di cortesia): l'errore si registra. */
export async function senzaBloccare(dove: string, f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
  } catch (e) {
    avvisa(dove, e);
  }
}
