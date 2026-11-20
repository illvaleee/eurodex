/** Piccoli aiuti per il DOM, con i tipi giusti. */

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- come querySelector<T>: il tipo lo sceglie chi chiama
export function $<T extends Element = HTMLElement>(selettore: string, dentro: ParentNode = document): T | null {
  return dentro.querySelector<T>(selettore);
}

export function $$<T extends Element = HTMLElement>(selettore: string, dentro: ParentNode = document): T[] {
  return [...dentro.querySelectorAll<T>(selettore)];
}

/** Elemento che deve esserci per forza (fa parte dello scheletro della pagina). */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- come querySelector<T>
export function necessario<T extends Element = HTMLElement>(selettore: string): T {
  const el = document.querySelector<T>(selettore);
  if (!el) throw new Error(`Manca ${selettore} nella pagina`);
  return el;
}

export const attesa = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export const fogliAperti = (): boolean => document.body.classList.contains('open-sheet');

/**
 * Mentre un'operazione è in corso (controllo in rete, accesso…) i pulsanti che l'hanno avviata lo mostrano subito:
 * disattivati, "occupati" per TalkBack e, se c'è, con il testo di attesa al posto del loro. Poi tornano come prima.
 */
export async function inCorso<T>(selettore: string, attesa: string | null, lavoro: () => Promise<T>): Promise<T> {
  const pulsanti = $$<HTMLButtonElement>(selettore).map(b => ({ b, testo: b.textContent }));
  for (const { b } of pulsanti) {
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    if (attesa) b.textContent = attesa;
  }
  try {
    return await lavoro();
  } finally {
    for (const { b, testo } of pulsanti) {
      if (!b.isConnected) continue;
      b.disabled = false;
      b.removeAttribute('aria-busy');
      if (attesa) b.textContent = testo;
    }
  }
}
