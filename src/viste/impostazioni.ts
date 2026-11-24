import { html, nothing, render, type TemplateResult } from 'lit-html';
import { catalogo, ordinePaesi, pezzi, tipi } from '../catalogo/indice';
import { copieGiornaliere, FREQUENZE_DRIVE } from '../collezione/backup';
import { meta, prefs, salvaMeta } from '../collezione/stato';
import { $ } from '../core/dom';
import { numero } from '../core/formato';
import { Nativo, nativo } from '../nativo/plugin';
import { versioneApp } from '../nativo/versione';
import { mostraDispositivi, mostraInAttesa, sezioneSync } from '../sync/interfaccia';
import { disegnaSezioneAccesso } from './accesso';
import { sincronizzazioneAttiva } from '../sync/sincronizzazione';
import { apriFoglio, foglioCon } from '../ui/foglio';
import { ICONA, ICONA_GOOGLE } from '../ui/icone';
import { disegnaRuota, sceltaSfondo } from '../ui/sfondo';

const interruttore = (chiave: string, titolo: string, spiegazione: string, acceso: boolean) =>
  html`<label class="tgl"
    ><span><b>${titolo}</b><small>${spiegazione}</small></span
    ><input type="checkbox" data-pref=${chiave} .checked=${acceso} /><i aria-hidden="true"></i
  ></label>`;

async function sezioneDrive(): Promise<TemplateResult> {
  let st: { collegato: boolean; nome?: string; dove?: string } = { collegato: false };
  try {
    st = await Nativo.statoFile();
  } catch {
    // file non raggiungibile: si propone di collegarlo
  }
  if (!st.collegato && meta.drive) {
    meta.drive = null;
    salvaMeta(); // solo informazioni di servizio: non è una modifica della collezione
  }
  if (!st.collegato)
    return html`<button class="btn" data-act="drivelink">${ICONA.cloud} Collega Google Drive</button>
      <button class="btn sec2" data-act="driveopen">Ripristina da un backup su Drive</button>`;
  const freq = prefs.driveFreq ?? 'sempre';
  return html`<div class="bstat ${meta.driveErr ? 'err' : 'ok'}" role="status">
      <b>${meta.driveErr ? '⚠️ Ultimo salvataggio non riuscito' : '✓ Backup automatico attivo'}</b>
      <span
        >File:
        ${st.nome || 'backup'}${st.dove ? ` · ${st.dove}` : ''}${
          meta.driveAt
            ? html`<br />Ultimo salvataggio:
                ${new Date(meta.driveAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : nothing
        }${meta.driveErr ? html`<br />${meta.driveErr}` : nothing}</span
      >
    </div>
    ${
      (st.dove ?? '').includes('telefono')
        ? html`<div class="muted small">
            Questo file è sul telefono: se il telefono si rompe o si perde, si perde anche lui. Per stare tranquillo
            scollegalo e scegli Google Drive.
          </div>`
        : nothing
    }
    <div class="muted small" style="margin:10px 0 6px">Ogni quanto aggiornare il file:</div>
    <div class="seg segfreq" role="radiogroup" aria-label="Frequenza del backup su Drive">
      ${FREQUENZE_DRIVE.map(
        ([k, nome]) =>
          html`<button
            class=${freq === k ? 'on' : ''}
            data-act="drivefreq"
            data-v=${k}
            role="radio"
            aria-checked=${freq === k ? 'true' : 'false'}
          >
            ${nome}
          </button>`,
      )}
    </div>
    <div class="row gap">
      <button class="btn sm sec2" data-act="drivenow">Salva ora</button
      ><button class="btn sm sec2" data-act="driveread">Ripristina da qui</button>
    </div>
    <button class="btn sm ghost" data-act="driveoff">Scollega il file</button>`;
}

export async function apriImpostazioni(): Promise<void> {
  // Già aperte (ridisegnate dopo un'azione fatta qui dentro, per esempio dopo aver collegato Drive): alla fine si torna
  // nel punto in cui si era, così il risultato è sotto gli occhi invece di ripartire dall'inizio della scheda.
  const posizione = foglioCon('[data-foglio="impostazioni"]') ? ($('.sheet .in')?.scrollTop ?? 0) : 0;
  const app = nativo();
  const drive = app ? await sezioneDrive() : nothing;
  // l'interruttore degli avvisi mostra lo stato vero (se Android ha le notifiche spente per l'app, lo dice).
  // Si legge PRIMA di disegnare la scheda: aggiungere la riga dopo sposterebbe i pulsanti sotto il dito.
  let notificheSpente = false;
  if (app)
    try {
      notificheSpente = prefs.avvisi && !(await Nativo.statoNotifiche()).attive;
    } catch {
      // stato non leggibile: si mostra l'impostazione dell'app
    }
  const copie = app ? [...(await copieGiornaliere())].reverse() : [];
  apriFoglio(html`
    <h2 data-foglio="impostazioni">Impostazioni</h2>
    <div class="sec">Visualizzazione</div>
    ${interruttore('onlyMissing', 'Solo mancanti', 'Nasconde ovunque le monete che hai già', prefs.onlyMissing)}
    ${interruttore('album', 'Vista album', 'Monete in griglia, quelle che mancano in grigio', prefs.album)}
    ${interruttore(
      'noExtra',
      'Varianti solo nella scheda Extra',
      'Errori di conio, lettera nella stella, stelle grandi e piccole e le altre varianti escono da collezione, catalogo, mancanti e percentuali: resta la serie base. Quelle che hai segnato restano salvate',
      prefs.noExtra !== false,
    )}
    ${interruttore(
      'noProof',
      'Nascondi le monete proof',
      'Spariscono da catalogo, mancanti e percentuali. Quelle che hai segnato restano salvate e tornano se lo spegni',
      !!prefs.noProof,
    )}
    <div class="sec">Sfondo</div>
    <div id="sfondobox"></div>
    <div id="accessobox"></div>
    <div class="sec">Salvataggio e sincronizzazione</div>
    <div class="muted small">
      Per non perdere mai la collezione e ritrovarla su un altro dispositivo, o su un telefono nuovo se quello vecchio
      si rompe o si perde. Sono modi diversi per la stessa cosa: puoi usarne uno o anche tutti insieme.
    </div>
    <div class="metodo">
      <div class="mtit">
        <span class="mico">${ICONA_GOOGLE}</span><b>Account Google</b>${
          sincronizzazioneAttiva()
            ? html`<span class="mbadge ok">attivo</span>`
            : html`<span class="mbadge">consigliato</span>`
        }
      </div>
      <div class="muted small">
        La collezione resta salvata sul tuo account e si sincronizza subito su tutti i dispositivi dove accedi, con una
        notifica a ogni modifica. Su un telefono nuovo installi Eurodex, accedi e la ritrovi.
      </div>
      <div id="syncbox"></div>
    </div>
    <div class="metodo">
      <div class="mtit">
        <span class="mico">${ICONA.cloud}</span><b>File su Google Drive</b>${
          app && meta.drive ? html`<span class="mbadge ok">attivo</span>` : nothing
        }
      </div>
      <div class="muted small">
        Un file con tutta la collezione in una cartella del tuo Drive, aggiornato da solo con la frequenza che scegli.
        Su un telefono nuovo tocchi "Ripristina" e scegli il file.
      </div>
      ${app ? drive : html`<div class="muted small">Disponibile nell'app Android.</div>`}
    </div>
    ${
      app
        ? html`<div class="metodo">
            <div class="mtit">
              <span class="mico">${ICONA.telefono}</span><b>Copie automatiche</b
              ><span class="mbadge ok">sempre attive</span>
            </div>
            <div class="muted small">
              Non devi fare niente: Android salva la collezione nel backup del telefono e la rimette quando configuri un
              telefono nuovo con lo stesso account; in più l'app tiene sul telefono le copie degli ultimi 7 giorni.
            </div>
            ${
              copie.length
                ? html`<div class="muted small" style="margin-top:8px">
                      <b>Copie degli ultimi giorni</b>: tocca un giorno per tornare a com'era.
                    </div>
                    <div class="chips" style="margin-top:8px">
                      ${copie.map(
                        n =>
                          html`<button
                            class="fchip"
                            data-act="snap"
                            data-v=${n}
                            aria-label="Copia del ${n.slice(8, 10)}/${n.slice(5, 7)}"
                          >
                            <span class="cv">${n.slice(8, 10)}/${n.slice(5, 7)}</span>
                          </button>`,
                      )}
                    </div>`
                : nothing
            }
          </div>`
        : nothing
    }
    <div class="metodo">
      <div class="mtit"><span class="mico">${ICONA.list}</span><b>File da tenere dove vuoi</b></div>
      <div class="muted small">
        Salvi o invii (mail, WhatsApp, chiavetta…) un file con tutta la collezione e da lì la ripristini quando vuoi.
      </div>
      <button class="btn sec2" data-act="export">
        ${app ? 'Salva / invia un file di backup' : 'Scarica il backup'}
      </button>
      <label class="btn sec2 lbtn"
        >Ripristina da un file<input type="file" id="bkfile" accept=".json,.txt,application/json,text/plain" hidden
      /></label>
    </div>
    <div class="sec">Importa ed esporta</div>
    <div class="muted small">
      Dalla vecchia app esporta la collezione in CSV (Excel) e sceglila qui: le monete trovate vengono segnate come
      possedute, con la data in cui le avevi aggiunte.
    </div>
    <label class="btn sec2 lbtn"
      >Importa da CSV<input type="file" id="csvfile" accept=".csv,text/csv,text/plain" hidden
    /></label>
    <button class="btn sec2" data-act="exportcsv">Esporta tutta la collezione (CSV)</button>
    <button class="btn sec2" data-act="print">Lista da stampare</button>
    <div class="sec">Catalogo in PDF</div>
    <div class="muted small">
      Tutte le monete da 1 cent a 2 euro, una tabella per paese (Germania: una per zecca) con quelle che hai, quelle che
      mancano e quelle mai coniate.
    </div>
    <button class="btn sec2" data-act="pdfcat">Crea il PDF del catalogo</button>
    <div class="sec">Aggiornamenti</div>
    ${interruttore(
      'avvisi',
      "Avvisami quando c'è qualcosa di nuovo",
      'Una notifica ogni tanto, solo quando escono monete, foto o informazioni nuove',
      prefs.avvisi && !notificheSpente,
    )}
    ${
      notificheSpente
        ? html`<div class="muted small" id="notoff">
            Le notifiche sono spente per questa app: attiva l'interruttore e, se Android lo chiede, tocca «Consenti».
          </div>`
        : nothing
    }
    <div class="muted small">
      Versione installata: <b>${versioneApp?.version ?? 'anteprima'}</b>. Il catalogo e le foto si aggiornano da soli,
      senza installare niente: una versione nuova dell'app serve solo per le funzioni nuove.
    </div>
    <button class="btn sec2" data-act="checkupd">Controlla aggiornamenti</button>
    <button class="btn sec2" data-act="novita">Novità delle versioni</button>
    <div class="sec">Collezione</div>
    <button class="btn sec2" data-act="go" data-v="hist">Storico delle modifiche</button>
    <button class="btn danger" data-act="reset" id="resetbtn">Azzera la collezione</button>
    <div class="sec">Informazioni</div>
    <div class="small muted">
      Catalogo del ${(catalogo?.generated ?? '').split('-').reverse().join('/')}: ${numero(tipi.length)} monete diverse,
      ${numero(pezzi.length)} pezzi (anni, zecche, versioni), ${ordinePaesi.length} paesi.<br />
      Immagini e descrizioni ufficiali: Banca centrale europea, Commissione europea. Dati tecnici, tirature e stime:
      <a class="ext" href="https://it.numista.com" target="_blank" rel="noopener">Numista</a>.
    </div>
    <button class="btn" data-act="close" style="margin-top:18px">Chiudi</button>
  `);
  // sfondo e account hanno contenitori propri: si ridisegnano da soli quando cambiano, senza toccare il resto
  const sfondo = $('#sfondobox');
  const account = $('#syncbox');
  if (sfondo) render(sceltaSfondo(), sfondo);
  if (account) render(sezioneSync(), account);
  disegnaRuota();
  void mostraDispositivi();
  void mostraInAttesa();
  void disegnaSezioneAccesso();
  const dentro = $('.sheet .in');
  if (dentro && posizione) dentro.scrollTop = posizione;
}
