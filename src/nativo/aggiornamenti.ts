import type { PluginListenerHandle } from '@capacitor/core';
import { html, nothing, type TemplateResult } from 'lit-html';
import { backupNativo } from '../collezione/backup';
import { meta } from '../collezione/stato';
import { RAW_DOWNLOAD } from '../core/costanti';
import { $ } from '../core/dom';
import { leggiFresco } from '../core/rete';
import { avviso } from '../ui/avvisi';
import { apriFoglio, apriFoglioEAspetta } from '../ui/foglio';
import { ICONA } from '../ui/icone';
import { ridisegna } from '../ui/navigazione';
import { stato, type VersioneDisponibile } from '../ui/stato-ui';
import { Nativo, messaggio, nativo } from './plugin';
import { versioneApp } from './versione';

/** Aggiornamenti dell'app (APK dalla pagina di download, installati con la finestra di Android). */

/** Il file ha il numero di versione nel nome: così non si scarica mai una copia vecchia rimasta in memoria su internet. */
const indirizzoApk = (): string =>
  RAW_DOWNLOAD +
  (stato.update?.apk && /^[\w.-]+\.apk$/.test(stato.update.apk) ? stato.update.apk : 'CollezioneEuro.apk');

export async function controllaAggiornamento(
  manuale: boolean,
  attesaMax?: number,
  giaAggiornata = "Hai già l'ultima versione ✓",
): Promise<void> {
  if (!versioneApp?.code) {
    if (manuale) avviso("Gli aggiornamenti si controllano nell'app installata");
    return;
  }
  try {
    const ac = attesaMax ? new AbortController() : null;
    if (ac) setTimeout(() => ac.abort(), attesaMax);
    const v = await leggiFresco<VersioneDisponibile>('version.json', ac?.signal);
    meta.updChecked = Date.now();
    if (v.code > versioneApp.code) {
      stato.update = v;
      if (manuale) apriAggiornamento();
      else if (stato.tab === 'coll' && !stato.stack.length) ridisegna();
    } else {
      stato.update = null;
      if (manuale) avviso(giaAggiornata);
    }
  } catch {
    if (manuale) avviso('Controllo non riuscito: sei connesso a internet?');
  }
}

function contenuto(allAvvio: boolean): TemplateResult {
  const v = stato.update;
  if (!v || !versioneApp) return html``;
  const mb = v.size ? `${Math.round(v.size / 1048576)} MB` : '';
  const nota = v.note ? html`<div class="unote">${v.note}</div>` : nothing;
  const rigaStato = html`<div
    id="updst"
    class="muted small"
    style="margin-top:10px"
    role="status"
    aria-live="polite"
  ></div>`;
  return allAvvio
    ? html`<div class="nvhead">
          <div class="nvico">${ICONA.spark}</div>
          <h2>È uscita la versione ${v.version}</h2>
          <div class="muted">
            Stai usando la ${versioneApp.version}, che non è la più recente. Ti consiglio di aggiornare adesso: ci vuole
            un minuto e la collezione resta com'è.
          </div>
        </div>
        ${nota}${rigaStato}
        <div class="nvbtn">
          <button class="btn" data-act="install" id="instbtn">Aggiorna ora${mb ? ` · ${mb}` : ''}</button>
          <button class="btn sec2" data-act="close">Più tardi</button>
        </div>`
    : html`<h2>Nuova versione ${v.version}</h2>
        ${nota}
        <div class="muted">
          Installata: ${versioneApp.version}${mb ? ` · download ${mb}` : ''}. La collezione resta com'è.
        </div>
        ${rigaStato}
        <button class="btn" data-act="install" id="instbtn">Scarica e installa</button>
        <button class="btn sec2" data-act="close">Più tardi</button>`;
}

export function apriAggiornamento(): void {
  if (stato.update) apriFoglio(contenuto(false));
}

/**
 * All'apertura (ogni volta che l'app parte da chiusa, non quando torna da un'altra app): se c'è una versione più
 * nuova lo dice subito, prima di tutto il resto. Si può aggiornare o andare avanti.
 */
export function avvisoAggiornamento(): Promise<void> {
  return apriFoglioEAspetta(contenuto(true));
}

let ascoltoDownload: PluginListenerHandle | null = null;

export async function installaAggiornamento(): Promise<void> {
  const st = $('#updst');
  const b = $<HTMLButtonElement>('#instbtn');
  if (!nativo()) {
    location.href = indirizzoApk();
    return;
  }
  if (!st || !b) return;
  try {
    const pr = await Nativo.puoInstallare();
    if (!pr.permesso) {
      st.textContent =
        'Android chiede il permesso (solo la prima volta): nella schermata che si apre attiva «Consenti da questa fonte», poi torna qui e tocca di nuovo «Scarica e installa».';
      await Nativo.permessoInstallazione();
      return;
    }
    b.disabled = true;
    b.textContent = 'Scarico…';
    await ascoltoDownload?.remove();
    ascoltoDownload = await Nativo.addListener('download', e => {
      if (b.isConnected) b.textContent = `Scarico… ${e.percento}%`;
    });
    await backupNativo(); // prima di tutto la collezione al sicuro
    await Nativo.scaricaEInstalla({ url: indirizzoApk(), size: stato.update?.size ?? 0 });
    // se nella finestra di Android si tocca "Annulla", da qui si può riaprire
    b.disabled = false;
    b.textContent = "Riapri l'installazione";
    st.textContent =
      "Nella finestra di Android tocca «Aggiorna». Alla fine l'app si chiude da sola: riaprila e trovi la versione nuova, con la collezione com'era.";
  } catch (e) {
    b.disabled = false;
    b.textContent = 'Riprova';
    st.textContent = messaggio(e);
  }
}
