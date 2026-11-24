import { App } from '@capacitor/app';
import { html, render } from 'lit-html';
import { caricaSchede } from '../catalogo/dati';
import { catalogo, costruisciIndice, pezzi, tipoPerId } from '../catalogo/indice';
import { nomeTipo } from '../catalogo/proprieta';
import { backupNativo, backupSubito, driveDovuto, leggiCopia } from '../collezione/backup';
import { annullaOperazione, fotografa } from '../collezione/annulla';
import { condividiFile, condividiTesto, csvCollezione, stampa, type EsitoFile } from '../collezione/esporta';
import {
  annullaUltimaImportazione,
  confermaRipristino,
  eseguiRipristinoInAttesa,
  importaCsv,
  opzioniIndice,
} from '../collezione/ripristino';
import {
  meta,
  note,
  possedute,
  preferite,
  prefs,
  registraModifica,
  salva,
  serializza,
  collezioneViva,
  type FiltroExtra,
  type FrequenzaDrive,
  type ModoCatalogo,
  type ModoMie,
  type Ordinamento,
  type Preferenze,
} from '../collezione/stato';
import { $, $$, fogliAperti, inCorso } from '../core/dom';
import { senzaBloccare } from '../core/errori';
import { numero, oggiIso } from '../core/formato';
import { apriAggiornamento, controllaAggiornamento, installaAggiornamento } from '../nativo/aggiornamenti';
import { Nativo, annullato, messaggio, nativo } from '../nativo/plugin';
import { azioneAccedi, azioneEsci, azioneRinomina, azioneSincronizzaOra } from '../sync/interfaccia';
import { annunciaOra, sincronizzazioneAttiva } from '../sync/sincronizzazione';
import { muroAccedi, muroAncora, muroAperto, muroChiedi, muroEsci } from '../sync/muro';
import { apriGestioneAccessi, azioneChiediAccesso, cambiaMuro, decidiAccesso } from '../viste/accesso';
import { apriImpostazioni } from '../viste/impostazioni';
import { apriNovita, avvisiAggiornamenti } from '../viste/finestre';
import { mancantiFiltrate, testoMancanti } from '../viste/mancanti';
import { ordina } from '../viste/ordine';
import { interpreta } from '../viste/cerca';
import { righeAnno } from '../viste/paese';
import { apriScheda } from '../viste/scheda-moneta';
import { altroStorico } from '../viste/storico';
import { avviso, avvisoConAnnulla, eseguiAnnulla } from './avvisi';
import { chipTipo } from './componenti';
import { aggiornaDatiOra } from './dati-catalogo';
import { chiudiDialogo, dialogoAperto } from './dialogo';
import { apriFoglio, chiudiFoglio } from './foglio';
import { ICONA } from './icone';
import { cambiaScheda, indietro, ridisegna, vai } from './navigazione';
import { consumaPressioneLunga, scelta } from './pressione-lunga';
import { apriScelta } from './scelte';
import { alterna, segnaGruppo } from './segna';
import { applicaSfondo, cambiaLuminosita, cambiaSfondo, fotoPerBackup, scegliFoto } from './sfondo';
import { stato, type FiltriCerca, type FiltriMancanti, type Scheda, type Schermata } from './stato-ui';
import { apriZoom, chiudiZoom, giraZoom, zoomAperto } from './zoom';

/** Indietro (tasto di Android o freccia in alto): chiude quello che è aperto, poi torna indietro. Falso = uscire. */
export function tornaIndietro(): boolean {
  if (dialogoAperto()) {
    chiudiDialogo();
    return true;
  }
  // davanti al muro non c'è niente dietro cui tornare: indietro chiude l'app
  if (muroAperto()) return false;
  if (zoomAperto()) {
    chiudiZoom();
    return true;
  }
  if (fogliAperti()) {
    chiudiFoglio();
    return true;
  }
  return indietro();
}

function apriEsportaMancanti(): void {
  apriFoglio(
    html`<h2>Esporta le mancanti</h2>
      <div class="muted small">Con i filtri scelti: ${numero(mancantiFiltrate().length)} monete.</div>
      <button class="btn" data-act="sharemiss">${ICONA.share} Condividi come testo (WhatsApp, email…)</button>
      <button class="btn sec2" data-act="csvmiss">File CSV (Excel)</button>
      <button class="btn sec2" data-act="printmiss">Lista da stampare</button>
      <button class="btn sec2" data-act="close">Chiudi</button>`,
  );
}

async function condividiMancanti(): Promise<void> {
  chiudiFoglio();
  await caricaSchede();
  const titolo = 'Monete che mi mancano';
  const testo = testoMancanti();
  const esito = await condividiTesto(titolo, testo);
  if (esito === 'copiato') avviso('Lista copiata: incollala dove vuoi');
  else if (esito === 'no')
    apriFoglio(
      html`<h2>${titolo}</h2>
        <textarea class="big" readonly aria-label=${titolo} .value=${testo}></textarea>
        <button class="btn" data-act="close">Chiudi</button>`,
    );
}

async function collegaDrive(): Promise<void> {
  try {
    const r = await Nativo.scegliFile({ nome: 'eurodex-backup.json' });
    meta.drive = { nome: r.nome ?? '', dove: r.dove ?? '' };
    meta.driveErr = '';
    salva();
    await backupNativo(true);
    avviso(meta.driveErr ? 'Collegato, ma il salvataggio non è riuscito' : 'Backup collegato ✓');
    await apriImpostazioni();
  } catch (e) {
    if (!annullato(e)) avviso(`Non riuscito: ${messaggio(e).slice(0, 60)}`);
  }
}

async function ripristinaDaDrive(): Promise<void> {
  try {
    await Nativo.apriFile();
    const r = await Nativo.leggi({ aperto: true });
    // quel file diventa anche il file del backup automatico solo se lo si sceglie nella finestra e il ripristino non
    // viene annullato (proposto acceso se adesso non c'è nessun file collegato: telefono nuovo o reinstallazione)
    confermaRipristino(r.testo, 'dal file scelto', {
      proposto: !meta.drive,
      fai: () => {
        void Nativo.collegaAperto()
          .then(f => {
            meta.drive = { nome: f.nome ?? '', dove: f.dove ?? '' };
            meta.driveErr = '';
            salva();
            avviso('Backup automatico collegato a questo file ✓');
          })
          .catch(() => undefined);
      },
      lascia: () => void Nativo.rilasciaAperto().catch(() => undefined),
    });
  } catch (e) {
    if (!annullato(e)) avviso(`Non riuscito: ${messaggio(e).slice(0, 60)}`);
  }
}

/** Un file da condividere non è partito per un errore: lo si dice (chiudere la condivisione non è un errore). */
function esitoFile(e: EsitoFile): void {
  if (e === 'errore') avviso('Non riuscito: riprova tra poco');
}

async function esportaBackup(): Promise<void> {
  const e = await condividiFile(
    `eurodex-${oggiIso()}.json`,
    serializza(fotoPerBackup()),
    'application/json',
    'Backup Eurodex',
  );
  esitoFile(e);
  // conta come backup fatto solo se il file è davvero partito (non se si è chiusa la condivisione)
  if (e === 'condiviso') {
    meta.lastExport = Date.now();
    salva();
  }
}

function cambiaFrequenzaDrive(f: FrequenzaDrive): void {
  prefs.driveFreq = f;
  salva();
  for (const b of $$('[data-act="drivefreq"]')) {
    b.classList.toggle('on', b.dataset.v === f);
    b.setAttribute('aria-checked', b.dataset.v === f ? 'true' : 'false');
  }
  if (f === 'sempre' || driveDovuto()) void backupNativo();
  const quando = {
    sempre: '',
    giorno: 'una volta al giorno',
    settimana: 'una volta alla settimana',
    mese: 'una volta al mese',
  }[f];
  avviso(
    f === 'sempre' ? 'Il file si aggiorna a ogni modifica' : `Il file si aggiorna ${quando}, se ci sono modifiche`,
  );
}

function alternaPreferita(id: string): void {
  if (preferite.has(id)) preferite.delete(id);
  else preferite.add(id);
  salva();
  const on = preferite.has(id);
  for (const b of $$(`.starbtn[data-id="${CSS.escape(id)}"]`)) {
    b.classList.toggle('on', on);
    b.textContent = on ? '★' : '☆';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Togli dalle preferite' : 'Aggiungi alle preferite');
  }
  avviso(on ? 'Aggiunta alle preferite ★' : 'Tolta dalle preferite');
  if (!$('.starbtn')) chiudiFoglio();
}

let azzeramentoArmato = false;
function azzera(): void {
  const b = $('#resetbtn');
  if (!b) return;
  if (!azzeramentoArmato) {
    azzeramentoArmato = true;
    b.textContent = sincronizzazioneAttiva()
      ? 'Tocca di nuovo: si azzera anche sugli altri dispositivi'
      : 'Tocca di nuovo per confermare';
    setTimeout(() => {
      azzeramentoArmato = false;
      if (b.isConnected) b.textContent = 'Azzera la collezione';
    }, 3000);
    return;
  }
  azzeramentoArmato = false;
  const prima = fotografa(collezioneViva());
  registraModifica('-', possedute);
  possedute.clear();
  salva();
  const dopo = fotografa(collezioneViva());
  chiudiFoglio();
  ridisegna();
  avvisoConAnnulla('Collezione azzerata', () => {
    // annullato: torna quello che l'azzeramento ha tolto (storico compreso), senza toccare quello arrivato nel frattempo
    annullaOperazione(prima, dopo, collezioneViva());
    salva();
    ridisegna();
  });
}

function apriOChiudiScheda(id: string): void {
  const el = $(`[data-card="${CSS.escape(id)}"]`);
  if (!el) return;
  const aperta = !el.classList.contains('open');
  el.classList.toggle('open', aperta);
  el.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', aperta ? 'true' : 'false');
  if (!aperta) {
    stato.aperte.delete(id);
    return;
  }
  stato.aperte.add(id);
  const corpo = el.querySelector<HTMLElement>('.tbody');
  if (!corpo || corpo.childElementCount) return;
  if (id.startsWith('Y|')) {
    const [, cc = '', y = ''] = id.split('|');
    render(righeAnno(cc, Number(y)), corpo);
  } else {
    const [tid = '', y] = id.split('@');
    const t = tipoPerId[tid];
    if (t) render(chipTipo(t, y ? t.pieces.filter(p => p.y === Number(y)) : undefined), corpo);
  }
}

type Dati = DOMStringMap;

async function azione(nome: string, d: Dati): Promise<void> {
  switch (nome) {
    case 'minemode':
      prefs.mineMode = d.v as ModoMie;
      salva();
      ridisegna();
      window.scrollTo(0, 0);
      break;
    case 'extrafiltro':
      prefs.extraFiltro = d.v as FiltroExtra;
      salva();
      ridisegna();
      window.scrollTo(0, 0);
      break;
    case 'tab':
      cambiaScheda(d.tab as Scheda);
      break;
    case 'back':
      tornaIndietro();
      break;
    case 'noavvisi':
      prefs.avvisi = false;
      salva();
      avvisiAggiornamenti(false);
      chiudiFoglio();
      avviso('Va bene: puoi attivarli quando vuoi dalle impostazioni');
      break;
    case 'wavvisi':
      prefs.avvisi = true;
      salva();
      avvisiAggiornamenti(true);
      chiudiFoglio();
      avviso('Se Android te lo chiede, tocca «Consenti»');
      break;
    case 'go':
      vai(d.v as Schermata, { cc: d.cc, y: d.y, d: d.d });
      break;
    case 'catmode':
      prefs.catMode = d.v as ModoCatalogo;
      salva();
      ridisegna();
      break;
    case 'pmap':
      prefs.paesiMap = d.v === '1';
      salva();
      ridisegna();
      break;
    case 'album':
      prefs.album = d.v === '1';
      salva();
      ridisegna();
      break;
    case 'mode':
      stato.countryMode = d.mode === 'anno' ? 'anno' : 'taglio';
      ridisegna();
      break;
    case 'onlymiss':
      prefs.onlyMissing = !prefs.onlyMissing;
      salva();
      chiudiFoglio();
      ridisegna();
      avviso(prefs.onlyMissing ? 'Solo mancanti: le monete che hai sono nascoste' : 'Mostro tutte le monete');
      break;
    case 'ex':
      Object.assign(stato.ex, { [d.f ?? '']: d.v, limit: 30 } as Partial<FiltriCerca>);
      ridisegna();
      break;
    case 'more':
      stato.ex.limit += 30;
      ridisegna();
      break;
    case 'miss':
      Object.assign(stato.miss, { [d.f ?? '']: d.v, limit: 40 } as Partial<FiltriMancanti>);
      ridisegna();
      break;
    case 'missmore':
      stato.miss.limit += 60;
      ridisegna();
      break;
    case 'sharemiss':
      await condividiMancanti();
      break;
    case 'exportmiss':
      apriEsportaMancanti();
      break;
    case 'csvmiss':
      esitoFile(
        await condividiFile(
          `mancanti-${oggiIso()}.csv`,
          csvCollezione(true, mancantiFiltrate()),
          'text/csv',
          'Monete mancanti',
        ),
      );
      break;
    case 'printmiss':
      esitoFile(
        await stampa(ordina(mancantiFiltrate(), 'paese'), 'Monete euro mancanti', `mancanti-${oggiIso()}.html`),
      );
      break;
    case 'settings':
      await apriImpostazioni();
      break;
    case 'close':
      chiudiFoglio();
      break;
    case 'zoom':
      apriZoom(d.id ?? '', d.side === 'common' ? 'common' : 'nat');
      break;
    case 'zclose':
      chiudiZoom();
      break;
    case 'zflip':
      giraZoom();
      break;
    case 'fav':
      alternaPreferita(d.id ?? '');
      break;
    case 'markall': {
      const t = tipoPerId[d.id ?? ''];
      if (t)
        segnaGruppo(
          t.pieces.map(p => p.key),
          d.v === '1',
          nomeTipo(t),
        );
      break;
    }
    case 'lpall':
      chiudiFoglio();
      segnaGruppo(scelta.chiavi, d.v === '1', scelta.nome);
      break;
    case 'lpnp':
      chiudiFoglio();
      segnaGruppo(scelta.senzaProof, true, scelta.nome);
      break;
    case 'export':
      await esportaBackup();
      break;
    case 'exportcsv':
      esitoFile(await condividiFile(`eurodex-${oggiIso()}.csv`, csvCollezione(false), 'text/csv', 'Eurodex (CSV)'));
      break;
    case 'pdfcat':
      await inCorso('[data-act="pdfcat"]', 'Preparo il PDF…', async () => {
        // jsPDF si carica solo adesso: non pesa sull'apertura dell'app
        const { creaPdfCatalogo } = await import('../collezione/pdf-catalogo');
        esitoFile(
          await condividiFile(
            `eurodex-catalogo-${oggiIso()}.pdf`,
            creaPdfCatalogo(),
            'application/pdf',
            'Catalogo base in PDF',
          ),
        );
      });
      break;
    case 'print':
      esitoFile(
        await stampa(
          ordina(
            pezzi.filter(p => possedute.has(p.key)),
            'paese',
          ),
          'La mia collezione di monete euro',
          `collezione-${oggiIso()}.html`,
        ),
      );
      break;
    case 'drivelink':
      await collegaDrive();
      break;
    case 'driveopen':
      await ripristinaDaDrive();
      break;
    case 'drivefreq':
      cambiaFrequenzaDrive(d.v as FrequenzaDrive);
      break;
    case 'drivenow':
      await backupNativo(true);
      avviso(meta.driveErr ? `Non riuscito: ${meta.driveErr.slice(0, 50)}` : 'Salvato su Drive ✓');
      await apriImpostazioni();
      break;
    case 'driveread':
      try {
        confermaRipristino((await Nativo.leggi()).testo, 'su Drive');
      } catch {
        avviso('Lettura non riuscita');
      }
      break;
    case 'driveoff':
      await senzaBloccare('scollegamento del file di Drive', () => Nativo.scollega());
      meta.drive = null;
      meta.driveErr = '';
      salva();
      await apriImpostazioni();
      break;
    case 'snap':
      try {
        const n = d.v ?? '';
        confermaRipristino(await leggiCopia(n), `del ${n.slice(8, 10)}/${n.slice(5, 7)}`);
      } catch {
        avviso('Copia non leggibile');
      }
      break;
    case 'dorestore':
      await eseguiRipristinoInAttesa();
      break;
    case 'undoimport':
      if (annullaUltimaImportazione()) {
        chiudiFoglio();
        avviso('Importazione annullata');
      }
      break;
    case 'checkupd':
      await inCorso('[data-act="checkupd"]', 'Controllo in corso…', async () => {
        // una risposta c'è sempre: anche quando arriva il catalogo nuovo si dice com'è messa l'app
        const datiNuovi = await aggiornaDatiOra(true);
        await controllaAggiornamento(
          true,
          undefined,
          datiNuovi ? "Catalogo aggiornato ✓ · l'app è già all'ultima versione" : undefined,
        );
      });
      break;
    case 'novita':
      await apriNovita();
      break;
    case 'syncaccedi':
      await azioneAccedi();
      break;
    case 'syncnome':
      await azioneRinomina();
      break;
    case 'syncora':
      await azioneSincronizzaOra();
      break;
    case 'syncscollega':
      await azioneEsci();
      break;
    case 'accchiedi':
      await azioneChiediAccesso();
      break;
    case 'accgestisci':
      await apriGestioneAccessi();
      break;
    case 'accok':
      await decidiAccesso(d.v, 'approvato');
      break;
    case 'accno':
      await decidiAccesso(d.v, 'rifiutato');
      break;
    case 'accvia':
      await decidiAccesso(d.v, 'revocato');
      break;
    case 'muroaccedi':
      await inCorso('[data-act="muroaccedi"]', null, () => muroAccedi());
      break;
    case 'murochiedi':
      await inCorso('[data-act="murochiedi"]', 'Invio…', () => muroChiedi());
      break;
    case 'muroancora':
      await inCorso('[data-act="muroancora"]', 'Invio…', () => muroAncora());
      break;
    case 'muroesci':
      await muroEsci();
      break;
    case 'sfondo':
      cambiaSfondo(d.v === 'colore' || d.v === 'foto' ? d.v : 'predefinito');
      break;
    case 'histmore':
      altroStorico();
      ridisegna();
      break;
    case 'update':
      apriAggiornamento();
      break;
    case 'install':
      await installaAggiornamento();
      break;
    case 'reset':
      azzera();
      break;
  }
}

function leggiFile(input: HTMLInputElement, f: (testo: string) => void): void {
  const file = input.files?.[0];
  if (!file) return;
  void file.text().then(f);
  input.value = '';
}

let timerRicerca: ReturnType<typeof setTimeout> | undefined;
let timerNota: ReturnType<typeof setTimeout> | undefined;

function alClic(e: MouseEvent): void {
  if (consumaPressioneLunga()) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('#tundo')) {
    eseguiAnnulla();
    return;
  }
  const esterno = t.closest<HTMLAnchorElement>('a.ext');
  if (esterno && nativo()) {
    e.preventDefault();
    location.href = esterno.href;
    return;
  }
  const pezzo = t.closest<HTMLElement>('[data-key]');
  if (pezzo) {
    alterna(pezzo.dataset.key ?? '');
    return;
  }
  const scegli = t.closest<HTMLButtonElement>('button.pick');
  if (scegli) {
    apriScelta(scegli);
    return;
  }
  const dettaglio = t.closest<HTMLElement>('[data-detail]');
  if (dettaglio) {
    apriScheda(dettaglio.dataset.detail ?? '');
    return;
  }
  const apri = t.closest<HTMLElement>('[data-toggle]');
  if (apri) {
    apriOChiudiScheda(apri.dataset.toggle ?? '');
    return;
  }
  const a = t.closest<HTMLElement>('[data-act]');
  if (a) {
    void azione(a.dataset.act ?? '', a.dataset);
    return;
  }
  // tocco sullo spazio vuoto di una riga moneta: si apre la sua scheda (come toccando nome o foto)
  const riga = t.closest<HTMLElement>('[data-lp^="type:"]');
  if (riga && !riga.classList.contains('tcard') && !t.closest('.chips, .chip, button')) {
    apriScheda((riga.dataset.lp ?? '').slice(5));
    return;
  }
  // tocco su un'intestazione (paese, anno, serie): una volta sola si ricorda che tenendo premuto si segna tutto
  if (t.closest('.sec[data-lp], .secflag[data-lp]') && !sessionStorage.getItem('suggLp')) {
    sessionStorage.setItem('suggLp', '1');
    avviso('Tieni premuto per segnarle tutte in un colpo');
  }
}

function alCambio(e: Event): void {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const anno = t.closest<HTMLSelectElement>('[data-exsel]');
  if (anno) {
    const campo = anno.dataset.exsel === 'to' ? 'to' : 'from';
    stato.ex[campo] = Number(anno.value);
    if (stato.ex.from > stato.ex.to) [stato.ex.from, stato.ex.to] = [stato.ex.to, stato.ex.from];
    stato.ex.limit = 30;
    ridisegna();
    return;
  }
  const ordine = t.closest<HTMLSelectElement>('[data-sort]');
  if (ordine) {
    const chiave = ordine.dataset.sort === 'sortSearch' ? 'sortSearch' : 'sortMiss';
    prefs[chiave] = ordine.value as Ordinamento;
    salva();
    if (ordine.value === 'valore')
      void caricaSchede().then(() => {
        ridisegna();
      });
    else ridisegna();
    return;
  }
  const domanda = t.closest<HTMLSelectElement>('[data-qc]');
  if (domanda) {
    const k = domanda.dataset.qc === 'y' ? 'y' : domanda.dataset.qc === 'd' ? 'd' : 'cc';
    stato.qc[k] = domanda.value;
    if (k === 'cc' && stato.qc.y && !pezzi.some(p => p.t.cc === domanda.value && p.y === Number(stato.qc.y)))
      stato.qc.y = '';
    ridisegna();
    return;
  }
  const muro = t.closest<HTMLInputElement>('[data-muro]');
  if (muro) {
    void cambiaMuro(muro);
    return;
  }
  const pref = t.closest<HTMLInputElement>('[data-pref]');
  if (pref) {
    const chiave = pref.dataset.pref as keyof Preferenze;
    (prefs as unknown as Record<string, boolean>)[chiave] = pref.checked;
    salva();
    if (chiave === 'noProof' || chiave === 'noExtra') {
      if (catalogo) costruisciIndice(catalogo, opzioniIndice());
      if (chiave === 'noProof')
        for (const f of [stato.ex, stato.miss] as { tipo: string }[])
          if (f.tipo === 'proof' || f.tipo === 'noproof') f.tipo = 'all';
      ridisegna();
      avviso(
        chiave === 'noProof'
          ? pref.checked
            ? 'Monete proof nascoste'
            : 'Monete proof di nuovo visibili'
          : pref.checked
            ? 'Varianti solo nella scheda Extra'
            : 'Varianti di nuovo anche in collezione',
      );
      return;
    }
    if (chiave === 'avvisi') {
      avvisiAggiornamenti(pref.checked);
      if (pref.checked) $('#notoff')?.remove();
      return;
    }
    ridisegna();
    return;
  }
  if (!(t instanceof HTMLInputElement)) return;
  if (t.id === 'bgfile' && t.files?.[0]) {
    void scegliFoto(t.files[0]);
    return;
  }
  if (t.id === 'bgvis' || t.id === 'bglum') {
    salva();
    return;
  }
  if (t.id === 'csvfile') leggiFile(t, importaCsv);
  if (t.id === 'bkfile')
    leggiFile(t, testo => {
      confermaRipristino(testo, 'scelto');
    });
}

function alInserimento(e: Event): void {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.id === 'bgvis') {
    prefs.sfondoVis = Number(t.value);
    const v = $('#visval');
    if (v) v.textContent = `${t.value}%`;
    applicaSfondo();
    return;
  }
  if (t instanceof HTMLInputElement && t.id === 'bglum') {
    cambiaLuminosita(Number(t.value));
    return;
  }
  if (t instanceof HTMLTextAreaElement && t.dataset.note) {
    const id = t.dataset.note;
    const v = t.value;
    clearTimeout(timerNota);
    timerNota = setTimeout(() => {
      if (v.trim()) note[id] = v;
      else Reflect.deleteProperty(note, id);
      salva();
    }, 400);
    return;
  }
  if (!(t instanceof HTMLInputElement) || !t.matches('[data-exq]')) return;
  stato.ex.q = t.value;
  stato.ex.limit = 30;
  clearTimeout(timerRicerca);
  if (interpreta(stato.ex.q).parole.length) void caricaSchede();
  timerRicerca = setTimeout(() => {
    const pos = t.selectionStart ?? t.value.length;
    ridisegna();
    const campo = $<HTMLInputElement>('[data-exq]');
    if (campo) {
      campo.focus();
      campo.setSelectionRange(pos, pos);
    }
  }, 280);
}

/** Gli elementi che fanno da pulsante senza esserlo (righe che si aprono) rispondono anche a Invio e Spazio. */
function allaTastiera(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!(t instanceof HTMLElement) || t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
    return;
  if (t.getAttribute('role') !== 'button') return;
  e.preventDefault();
  t.click();
}

type AlRitorno = () => void;

export function attivaAzioni(alRitorno: AlRitorno): void {
  document.addEventListener('click', alClic, true);
  document.addEventListener('change', alCambio);
  document.addEventListener('input', alInserimento);
  document.addEventListener('keydown', allaTastiera);
  if (!nativo()) return;
  // tasto indietro di Android, app in secondo piano (si salva) e ritorno (si controlla se c'è qualcosa di nuovo)
  void App.addListener('backButton', () => {
    if (!tornaIndietro()) void App.exitApp();
  });
  void App.addListener('pause', () => {
    backupSubito();
    void annunciaOra(); // l'avviso agli altri dispositivi in attesa parte prima che l'app venga chiusa
  });
  void App.addListener('resume', alRitorno);
}
