/**
 * Finestre sopra la pagina (schede, domande, foto ingrandita): finché sono aperte, tutto il resto diventa
 * irraggiungibile (`inert`): con TalkBack o la tastiera non si finisce sulla pagina sotto, che non si vede.
 * Le finestre si possono aprire una sopra l'altra (una domanda sopra le impostazioni): resta raggiungibile solo
 * quella in cima, in qualsiasi ordine si chiudano. Il messaggio in basso ("Annulla") resta sempre raggiungibile.
 */

const SEMPRE_RAGGIUNGIBILI = new Set(['toast']);
const aperte: Element[] = [];

function aggiorna(): void {
  const cima = aperte.at(-1);
  for (const el of Array.from(document.body.children)) {
    if (el.tagName === 'SCRIPT') continue;
    const libero = !cima || el === cima || el.contains(cima) || SEMPRE_RAGGIUNGIBILI.has(el.id);
    el.toggleAttribute('inert', !libero);
  }
}

export function isola(finestra: Element): void {
  if (!aperte.includes(finestra)) aperte.push(finestra);
  aggiorna();
}

export function libera(finestra: Element): void {
  const i = aperte.indexOf(finestra);
  if (i >= 0) aperte.splice(i, 1);
  aggiorna();
}
