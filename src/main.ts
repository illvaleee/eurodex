import { html, render } from 'lit-html';
import './stili/app.css';
import { caricaSchede, dati, datiLocali, impostaFotoApk, pulisciDati } from './catalogo/dati';
import { costruisciIndice, tipi, catalogo } from './catalogo/indice';
import type { CatalogoGrezzo } from './catalogo/tipi';
import { attivaBackupAutomatico, backupNativo, leggiFileInterno } from './collezione/backup';
import { spostaChiaviCambiate } from './collezione/migrazione';
import { opzioniIndice, ripristina } from './collezione/ripristino';
import { carica, meta, possedute, prefs, salva, type BackupQualsiasi } from './collezione/stato';
import { $, necessario } from './core/dom';
import { installaGestoreErrori, registraErrore } from './core/errori';
import { avvisoAggiornamento, controllaAggiornamento } from './nativo/aggiornamenti';
import { Nativo, nativo } from './nativo/plugin';
import { modoProve } from './nativo/prove';
import { leggiVersioneApp } from './nativo/versione';
import { esponiPerLeProve } from './prove';
import {
  accessoDaRifare,
  alRicevere,
  avviaSincronizzazione,
  collegamentoConCodice,
  sincronizzazioneAttiva,
  stessoDispositivo,
  sync,
} from './sync/sincronizzazione';
import { sessioneNativaPronta } from './sync/sessione-nativa';
import { aggiornaMuro, controllaMuro, muroAcceso, preparaNotifiche } from './sync/muro';
import { apriGestioneAccessi } from './viste/accesso';
import { avviso } from './ui/avvisi';
import { attivaAzioni } from './ui/azioni';
import { aggiornaContatori } from './ui/contatori';
import { aggiornaDatiOra, confermaAlTelefono, usaDatiGiaScaricati } from './ui/dati-catalogo';
import { attivaTrascinamento, chiudiFoglio } from './ui/foglio';
import { avviaIntro, dopoIntro, introPronta } from './ui/intro';
import { ridisegna, vai } from './ui/navigazione';
import { attivaPressioneLunga } from './ui/pressione-lunga';
import { applicaSfondo, caricaFotoPerBackup, coloraBarre } from './ui/sfondo';
import { stato } from './ui/stato-ui';
import { attivaGestiZoom } from './ui/zoom';
import { schedaValore } from './viste/valore';
import {
  avvisiAggiornamenti,
  benvenuto,
  caricaNovita,
  catalogoAggiornato,
  chiediAvvisi,
  firmaCatalogo,
  novitaVersione,
  propostaSincronizzazione,
  ultimoPassoAccesso,
} from './viste/finestre';

/** Cosa fare quando si tocca una notifica: aggiornamento, modifica da un altro dispositivo, dati nuovi. */
async function azioneNotifica(a: string | undefined, allAvvio: boolean): Promise<void> {
  if (a === 'aggiorna') {
    if (allAvvio && stato.update) return; // la finestra dell'aggiornamento compare già da sola
    await controllaAggiornamento(true);
  } else if (a === 'sync') {
    if (!document.body.classList.contains('open-sheet') && stato.stack[stato.stack.length - 1]?.v !== 'hist')
      vai('hist', {});
  } else if (a === 'dati') await usaDatiGiaScaricati();
  // una richiesta o un tentativo di accesso (notifica di Valerio): si apre la sua sezione
  else if (a === 'accessi') await apriGestioneAccessi();
  // approvato o accesso tolto: il muro si toglie o si mette da solo
  else if (a === 'accesso') await aggiornaMuro();
}

const ogniTanto = (ultima: number | undefined, ore: number) => Date.now() - (ultima ?? 0) > ore * 3600e3;

/** L'app torna in primo piano: backup se serve, aggiornamenti e dati nuovi ogni tanto. */
function alRitorno(): void {
  void aggiornaMuro(); // Valerio potrebbe aver acceso o spento il muro, o approvato questo account
  if (meta.drive && meta.driveSporco) void backupNativo();
  if (ogniTanto(meta.updChecked, 6)) void controllaAggiornamento(false);
  void usaDatiGiaScaricati().then(arrivati => {
    if (!arrivati && ogniTanto(meta.datiChecked, 3)) {
      meta.datiChecked = Date.now();
      void aggiornaDatiOra(false);
    }
  });
}

async function leggiCatalogo(): Promise<CatalogoGrezzo> {
  const [r, rIndice] = await Promise.all([
    fetch('data/catalog.json', { cache: 'no-store' }),
    fetch('data/indice.json', { cache: 'no-store' }).catch(() => null),
  ]);
  if (!r.ok) throw new Error(`catalogo: HTTP ${r.status}`);
  let cat = (await r.json()) as CatalogoGrezzo;
  let indiceApk: { rev?: number; img?: string[] } | null = null;
  try {
    if (rIndice?.ok) indiceApk = (await rIndice.json()) as { rev?: number; img?: string[] };
  } catch {
    indiceApk = null;
  }
  const fotoCatalogo = cat.types.flatMap(t => [...(t.img ?? [])].filter((x): x is string => !!x));
  impostaFotoApk(indiceApk?.img ?? [...new Set(fotoCatalogo)]);
  dati.rev = indiceApk?.rev ?? 0;
  dati.revApk = dati.rev;
  const locale = await datiLocali(dati.rev);
  if (locale) cat = locale;
  return cat;
}

/** Le finestre dell'avvio, una alla volta: aggiornamento, benvenuto o novità, proposte. */
async function finestreAvvio(aggiornamento: Promise<void>, muro: Promise<boolean>): Promise<void> {
  // muro acceso e account non approvato: solo la schermata per chiedere l'accesso, niente altre finestre
  if (await muro) return;
  // passo 5: chi era già entrato con Google prima della 1.0.84 ha solo la sessione della parte web, ma versioni e
  // catalogo si scaricano con quella nativa. La si apre con un tocco, chiesto al massimo una volta al giorno
  const account = sync;
  if (nativo() && account && Date.now() - (meta.ultimoPasso ?? 0) > 20 * 3600 * 1000) {
    if (!(await sessioneNativaPronta(account.uid))) {
      meta.ultimoPasso = Date.now();
      salva();
      await ultimoPassoAccesso(account.email);
      // aperta adesso: i controlli di versione e catalogo fatti all'avvio non avevano la sessione, si rifanno
      if (await sessioneNativaPronta(account.uid)) {
        void aggiornaDatiOra(false);
        await controllaAggiornamento(false, 4000);
      }
    }
  }
  await aggiornamento;
  if (stato.update) await avvisoAggiornamento();
  if (!meta.benvenuto && !possedute.size) {
    meta.firma = firmaCatalogo();
    void caricaNovita().then(l => {
      meta.novitaVista = l[0]?.id ?? 0;
      salva();
    });
    benvenuto();
    return;
  }
  meta.benvenuto ??= 1;
  const primaFirma = meta.firma?.ids ? meta.firma : null;
  let vista = await novitaVersione();
  if (!vista && dati.locale && dati.rev > (meta.datiVista ?? 0) && primaFirma) {
    catalogoAggiornato(primaFirma, dati.note);
    vista = true;
  }
  meta.datiVista = Math.max(meta.datiVista ?? 0, dati.rev);
  salva();
  if (vista) return;
  // una volta sola (e mai insieme ad altre finestre): accedere con Google per telefono e tablet
  if (nativo() && !sincronizzazioneAttiva() && (accessoDaRifare || !meta.propostaSync)) {
    meta.propostaSync = 1;
    salva();
    await propostaSincronizzazione(collegamentoConCodice);
  }
  await chiediAvvisi();
}

async function avvia(): Promise<void> {
  installaGestoreErrori();
  avviaIntro();
  carica();
  applicaSfondo();
  attivaGestiZoom();
  attivaTrascinamento();
  attivaPressioneLunga();
  attivaAzioni(alRitorno);
  attivaBackupAutomatico();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applicaSfondo();
    if (catalogo) ridisegna();
    coloraBarre();
  });
  try {
    // le prove automatiche via adb si conoscono prima di usare Firebase (con gli emulatori tutto va lì)
    await Promise.all([leggiVersioneApp(), modoProve()]);
    const cat = await leggiCatalogo();
    costruisciIndice(cat, opzioniIndice());
    if (!tipi.length) throw new Error('catalogo vuoto');
    const interno = (await leggiFileInterno()) as BackupQualsiasi | null;
    if (interno) {
      await ripristina(interno);
      if (possedute.size) avviso('Collezione ripristinata dal backup ✓');
    }
    void caricaFotoPerBackup(); // copia compatta della foto di sfondo, per i file di backup
    spostaChiaviCambiate();
    ridisegna();
    // il muro si controlla subito, durante l'animazione: chi non è approvato non vede la collezione prima del muro
    // (con il muro acceso l'animazione aspetta il controllo, al massimo 4 secondi)
    const muro = controllaMuro();
    if (muroAcceso()) void Promise.race([muro, new Promise(r => setTimeout(r, 4000))]).finally(() => introPronta());
    else introPronta();
    coloraBarre();
    document.addEventListener('introfine', coloraBarre, { once: true });
    esponiPerLeProve();
    alRicevere(() => {
      ridisegna();
      aggiornaContatori();
    });
    void avviaSincronizzazione().then(() => preparaNotifiche().catch(() => undefined));
    if (nativo()) {
      if (prefs.avvisi) avvisiAggiornamenti(true, false);
      confermaAlTelefono();
      dopoIntro(() => setTimeout(() => void aggiornaDatiOra(false), 2500));
      // file dei dati che non servono più: con calma, quando l'app è già partita
      dopoIntro(() => setTimeout(() => void pulisciDati().catch(() => undefined), 20_000));
      void Nativo.addListener('azione', d => void azioneNotifica(d.azione, false));
      Nativo.azioneIniziale()
        .then(d => {
          if (d.azione) dopoIntro(() => setTimeout(() => void azioneNotifica(d.azione, true), 600));
        })
        .catch(() => undefined);
      void Nativo.addListener('accesso', d => {
        // con l'app aperta: a Valerio richieste e tentativi (approvati o rifiutati in automatico); agli altri
        // l'approvazione o l'accesso tolto (il muro cambia da solo)
        if (d.tipo === 'accesso')
          avviso(
            d.titolo
              ? `${d.titolo}: ${d.testo ?? ''} (Impostazioni → Accesso)`
              : 'Nuova richiesta di accesso a Eurodex: aprila da Impostazioni → Accesso',
            7000,
          );
        else void aggiornaMuro();
      });
      void Nativo.addListener('sincronizza', d => {
        if (!stessoDispositivo(d.did))
          avviso(d.testo ? `Da ${d.nome ?? ''}: ${d.testo}` : 'Collezione aggiornata da un altro dispositivo', 7000);
      });
    }
    const aggiornamento = nativo() ? controllaAggiornamento(false, 4000) : Promise.resolve(); // parte subito, durante l'animazione
    dopoIntro(() => void finestreAvvio(aggiornamento, muro));
    // le schede complete (1,9 MB) si leggono quando il telefono è libero, dopo l'animazione: niente scatti all'avvio
    dopoIntro(() =>
      requestIdleCallback(
        () =>
          void caricaSchede().then(() => {
            const scheda = $('#valcard');
            if (scheda?.parentElement) {
              const contenitore = document.createElement('div');
              render(schedaValore(), contenitore);
              const nuova = contenitore.firstElementChild;
              if (nuova) scheda.replaceWith(nuova);
            }
          }),
        { timeout: 1500 },
      ),
    );
  } catch (e) {
    registraErrore('avvio', e);
    introPronta();
    chiudiFoglio();
    render(
      html`<div class="splash">
        <div><b>Catalogo non disponibile</b>Il file del catalogo non è presente in questa versione dell'app.</div>
      </div>`,
      necessario('#main'),
    );
    render(html``, necessario('#nav'));
  }
}

void avvia();
