import { necessario } from '../core/dom';

/** Avviso in basso (toast), con l'eventuale pulsante "Annulla". */

let timer: ReturnType<typeof setTimeout> | undefined;
let annulla: (() => void) | null = null;
/** Da fare solo se non si annulla: si esegue quando "Annulla" non è più raggiungibile (scaduto o sostituito). */
let seNonAnnullato: (() => void) | null = null;

function conferma(): void {
  const f = seNonAnnullato;
  seNonAnnullato = null;
  f?.();
}

function mostra(testo: string, f: (() => void) | null, ms?: number): void {
  conferma(); // un avviso nuovo copre il vecchio: il suo "Annulla" non si può più toccare
  const el = necessario('#toast');
  const msg = necessario('#tmsg');
  el.classList.toggle('act', !!f);
  el.classList.toggle('lungo', !!ms && testo.length > 40);
  // prima si mostra il riquadro, poi si scrive il testo: così TalkBack lo legge (un testo che cambia mentre il
  // riquadro è ancora nascosto non viene annunciato)
  const eraVisibile = el.classList.contains('show');
  el.classList.add('show');
  if (eraVisibile) msg.textContent = testo;
  else {
    msg.textContent = '';
    requestAnimationFrame(() => {
      msg.textContent = testo;
    });
  }
  clearTimeout(timer);
  timer = setTimeout(
    () => {
      el.classList.remove('show', 'act');
      annulla = null;
      conferma();
    },
    ms ?? (f ? 5000 : 3000),
  );
}

export function avviso(testo: string, ms?: number): void {
  annulla = null;
  mostra(testo, null, ms);
}

/** Avviso con "Annulla"; `confermato` si esegue solo se non si annulla (scaduto il tempo o coperto da un altro avviso). */
export function avvisoConAnnulla(testo: string, f: () => void, confermato?: () => void): void {
  mostra(testo, f);
  annulla = f;
  seNonAnnullato = confermato ?? null;
}

let trattenuti = 0;
/** Un'operazione che finirà con "Annulla" è in corso (es. un ripristino lento): gli invii aspettano anche adesso. */
export function trattieniInvii(si: boolean): void {
  trattenuti = Math.max(0, trattenuti + (si ? 1 : -1));
}

/** C'è un avviso con "Annulla" ancora toccabile (la sincronizzazione aspetta: se si annulla, non parte niente). */
export const annullabile = (): boolean => annulla !== null || trattenuti > 0;

/** Tocco su "Annulla" nell'avviso. */
export function eseguiAnnulla(): void {
  const f = annulla;
  annulla = null;
  seNonAnnullato = null;
  necessario('#toast').classList.remove('show');
  f?.();
}
