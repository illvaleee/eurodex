/**
 * Animazione di apertura: a ogni apertura dell'app (tornando da un'altra app non si vede, perché l'app è rimasta
 * aperta). Si chiude quando sono finiti sia il video sia la preparazione dell'app; toccandola si salta, e non dura
 * mai più di 6 secondi. Con "riduci animazioni" di Android non c'è.
 */

let attiva = false;
let finita = false;
let videoFinito = false;
let appPronta = false;

export function avviaIntro(): void {
  const el = document.getElementById('intro');
  const v = document.getElementById('introv');
  if (!el || !(v instanceof HTMLVideoElement)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.remove();
    return;
  }
  attiva = true;
  const chiudi = () => {
    if (finita) return;
    finita = true;
    el.className = 'out';
    document.dispatchEvent(new Event('introfine'));
    setTimeout(() => {
      v.pause();
      v.removeAttribute('src');
      v.load();
      el.remove();
    }, 500);
  };
  const forse = () => {
    if (videoFinito && appPronta) chiudi();
  };
  const basta = () => {
    videoFinito = true;
    forse();
  };
  v.addEventListener('playing', () => {
    el.className = 'on';
  });
  v.addEventListener('ended', basta);
  v.addEventListener('error', basta);
  el.addEventListener('click', basta);
  setTimeout(basta, 6000);
  v.play().catch(basta);
  introPronta = () => {
    appPronta = true;
    forse();
  };
}

/** L'app è pronta: l'animazione può chiudersi appena finisce il video. */
export let introPronta = (): void => undefined;

/** Esegue `f` dopo l'animazione (o subito se non c'è). */
export function dopoIntro(f: () => void): void {
  if (attiva && !finita) document.addEventListener('introfine', () => setTimeout(f, 400), { once: true });
  else f();
}
