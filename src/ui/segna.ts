import { bandiera, pezzoPerChiave } from '../catalogo/indice';
import { etichettaPezzo } from '../catalogo/proprieta';
import { possedute, prefs, registraModifica, salva } from '../collezione/stato';
import { $$ } from '../core/dom';
import { numero } from '../core/formato';
import { avviso, avvisoConAnnulla } from './avvisi';
import { aggiornaContatori } from './contatori';
import { ridisegna } from './navigazione';

/** Segna o toglie dei pezzi e aggiorna sul posto tutto quello che li mostra. Restituisce quelli cambiati davvero. */
export function impostaPossedute(chiavi: readonly string[], on: boolean): string[] {
  const cambiate = chiavi.filter(k => possedute.has(k) !== on);
  if (!cambiate.length) return [];
  for (const k of cambiate) {
    if (on) possedute.add(k);
    else possedute.delete(k);
  }
  registraModifica(on ? '+' : '-', cambiate);
  salva();
  const insieme = new Set(cambiate);
  for (const k of cambiate)
    for (const el of $$(`[data-key="${CSS.escape(k)}"]`)) {
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.closest('tr')?.classList.toggle('own', on);
    }
  for (const el of $$('[data-qk]')) {
    if (!insieme.has(el.dataset.qk ?? '')) continue;
    el.classList.toggle('yes', on);
    el.classList.toggle('no', !on);
    const b = el.querySelector('b');
    if (b) b.textContent = on ? "Ce l'hai ✓" : 'Ti manca';
  }
  aggiornaContatori();
  return cambiate;
}

/** Tocco su un pezzo: lo segna o lo toglie, con "Annulla". */
export function alterna(chiave: string): void {
  const on = !possedute.has(chiave);
  impostaPossedute([chiave], on);
  if ('vibrate' in navigator) navigator.vibrate(8); // non c'è su tutti i dispositivi (es. iPhone, computer)
  const p = pezzoPerChiave[chiave];
  if (p)
    avvisoConAnnulla(`${on ? 'Aggiunta' : 'Tolta'}: ${bandiera(p.t.cc)} ${etichettaPezzo(p)}`, () => {
      impostaPossedute([chiave], !on);
    });
}

/** Segna o toglie un gruppo intero (pressione lunga, "Segna tutte"). */
export function segnaGruppo(chiavi: readonly string[], on: boolean, nome: string): void {
  const cambiate = impostaPossedute(chiavi, on);
  if (!cambiate.length) {
    avviso(on ? 'Le avevi già tutte' : 'Non ne avevi nessuna');
    return;
  }
  const quante =
    cambiate.length === 1
      ? on
        ? 'Segnata 1 moneta'
        : 'Tolta 1 moneta'
      : `${on ? 'Segnate' : 'Tolte'} ${numero(cambiate.length)} monete`;
  avvisoConAnnulla(`${quante}${nome ? ` · ${nome}` : ''}`, () => {
    impostaPossedute(cambiate, !on);
  });
  if (prefs.onlyMissing) ridisegna();
}
