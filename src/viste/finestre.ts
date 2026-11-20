import { html, nothing, type TemplateResult } from 'lit-html';
import { tuttiPezzi, tuttiTipi } from '../catalogo/indice';
import { meta, possedute, prefs, salva, type FirmaCatalogo } from '../collezione/stato';
import { fogliAperti } from '../core/dom';
import { Nativo, nativo } from '../nativo/plugin';
import { versioneApp } from '../nativo/versione';
import { avviso } from '../ui/avvisi';
import { apriFoglio, apriFoglioEAspetta } from '../ui/foglio';
import { ICONA, ICONA_GOOGLE } from '../ui/icone';

/** Finestre che si aprono da sole: benvenuto, novità della versione, catalogo aggiornato, domanda sugli avvisi. */

export function avvisiAggiornamenti(attivi: boolean, chiediPermesso = true): void {
  if (!nativo()) return;
  Nativo.pianificaControlli({ attivi }).catch(() => undefined);
  Nativo.iscriviAvvisi({ attivi })
    .then(r => {
      if (!r.ok) console.warn(`avvisi push non attivi: ${r.errore ?? ''}`);
    })
    .catch(() => undefined);
  if (attivi && chiediPermesso) Nativo.permessoNotifiche().catch(() => undefined);
}

/** Chi ha l'app (aggiornata da una versione senza avvisi) e non ha le notifiche attive: lo si chiede una volta sola. */
export async function chiediAvvisi(): Promise<void> {
  if (!nativo() || !prefs.avvisi || meta.chiestoAvvisi) return;
  try {
    if ((await Nativo.statoNotifiche()).attive) return;
  } catch {
    return;
  }
  meta.chiestoAvvisi = Date.now();
  salva();
  apriFoglio(
    html`<h2>Vuoi un avviso quando c'è qualcosa di nuovo?</h2>
      <div class="muted" style="margin:6px 0 14px">
        Quando escono monete, foto o informazioni nuove, o una versione migliorata dell'app, ricevi una notifica. Poche
        volte al mese, mai pubblicità.
      </div>
      <button class="btn" data-act="wavvisi">Sì, avvisami</button>
      <button class="btn sec2" data-act="noavvisi">No, grazie</button>`,
  );
}

export function benvenuto(): void {
  meta.benvenuto = Date.now();
  salva();
  const app = nativo();
  apriFoglio(
    html`<div class="welc">
      <div class="wlogo" aria-hidden="true">€</div>
      <h2>Benvenuto in Eurodex</h2>
      <p class="muted">Tutte le monete in euro dei 25 paesi, dal 1999 a oggi, con le foto ufficiali.</p>
      <ul class="wtips">
        <li><b>Tocca un anno</b> per segnare la moneta come tua. Lo tocchi di nuovo e la togli.</li>
        <li><b>Tieni premuto</b> su un paese, un anno o una moneta per segnarli tutti in un colpo.</li>
        <li><b>Tocca la foto</b> per la scheda completa; nella scheda puoi ingrandirla e girarla.</li>
      </ul>
      <label class="btn"
        ><input type="file" id="csvfile" accept=".csv,text/csv,text/plain" hidden />Importa la collezione dalla vecchia
        app</label
      >
      ${
        app
          ? html`<p class="muted small wq">Hai già la collezione su un altro dispositivo?</p>
              <button class="btn gbtn" data-act="syncaccedi">${ICONA_GOOGLE} Accedi con Google</button>
              <button class="btn sec2" data-act="wavvisi">Avvisami quando c'è qualcosa di nuovo</button>`
          : nothing
      }
      <button class="btn sec2" data-act="close">Inizia</button>
    </div>`,
    'welcome',
  );
}

// ───────── cosa c'è di nuovo ─────────

export function firmaCatalogo(): FirmaCatalogo {
  return {
    v: versioneApp?.code ?? 0,
    ids: tuttiTipi.map(t => t.id),
    foto: tuttiTipi.filter(t => !t.pf).map(t => t.id),
    pezzi: tuttiPezzi.length,
  };
}

interface VoceNovita {
  id: number;
  v?: number;
  data?: string;
  titolo?: string;
  nuovo?: string[];
  migliorato?: string[];
  corretto?: string[];
  tolto?: string[];
}

type Sezioni = Partial<Record<'nuovo' | 'migliorato' | 'corretto' | 'tolto', string[]>> & {
  catalogo?: TemplateResult[];
};

let novita: Promise<VoceNovita[]> | null = null;
/** Elenco scritto a mano in novita.json (cosa è nuovo, migliorato, corretto, tolto), dalla versione più recente. */
export function caricaNovita(): Promise<VoceNovita[]> {
  novita ??= fetch('novita.json', { cache: 'no-store' })
    .then(r => (r.ok ? (r.json() as Promise<unknown>) : []))
    .then(l => (Array.isArray(l) ? (l as VoceNovita[]) : []))
    .catch(() => []);
  return novita;
}

const SEZIONI: readonly [keyof Sezioni, string, string][] = [
  ['nuovo', 'Novità', 'nv-n'],
  ['migliorato', 'Migliorato', 'nv-m'],
  ['corretto', 'Corretto', 'nv-c'],
  ['tolto', 'Tolto', 'nv-t'],
  ['catalogo', 'Nel catalogo', 'nv-k'],
];

function sezioniNovita(v: Sezioni): TemplateResult {
  return html`${SEZIONI.map(([k, nome, classe]) => {
    const voci = v[k];
    if (!voci?.length) return nothing;
    return html`<div class="nvsez ${classe}">
      <div class="nvlab">${nome}</div>
      <ul>
        ${voci.map(x => html`<li>${x}</li>`)}
      </ul>
    </div>`;
  })}`;
}

/** Cosa è cambiato nel catalogo (monete, foto, anni e zecche in più). */
export function differenzeCatalogo(prima: FirmaCatalogo | null | undefined, ora: FirmaCatalogo): TemplateResult[] {
  if (!prima?.ids) return [];
  const ids = new Set(prima.ids);
  const foto = new Set(prima.foto);
  const out: TemplateResult[] = [];
  const nuove = ora.ids.filter(id => !ids.has(id)).length;
  const nuoveFoto = ora.foto.filter(id => ids.has(id) && !foto.has(id)).length;
  const pezzi = Math.max(0, ora.pezzi - prima.pezzi);
  if (nuove) out.push(html`<b>${nuove}</b> ${nuove === 1 ? 'moneta nuova' : 'monete nuove'}`);
  if (nuoveFoto) out.push(html`<b>${nuoveFoto}</b> ${nuoveFoto === 1 ? 'foto nuova' : 'foto nuove'}`);
  if (pezzi) out.push(html`<b>${pezzi}</b> ${pezzi === 1 ? 'anno o zecca in più' : 'anni e zecche in più'}`);
  return out;
}

const pulsantiNovita = (nuove: number) =>
  html`<div class="nvbtn">
    ${nuove ? html`<button class="btn" data-act="go" data-v="news">Guarda le monete nuove</button>` : nothing}
    <button class="btn ${nuove ? 'sec2' : ''}" data-act="close">Ok</button>
  </div>`;

/** Alla prima apertura dopo un aggiornamento dell'app: cosa c'è di nuovo. Vero se la finestra si è aperta. */
export async function novitaVersione(): Promise<boolean> {
  const prima = meta.firma;
  const ora = firmaCatalogo();
  const lista = await caricaNovita();
  const ultima = lista[0]?.id ?? 0;
  const vista = meta.novitaVista;
  meta.firma = ora;
  meta.novitaVista = ultima;
  salva();
  if (!prima || !versioneApp || !prima.v || prima.v >= ora.v) return false;
  // voci non ancora viste (chi salta qualche versione le vede tutte insieme)
  const voci = lista.filter(n => (vista != null ? n.id > vista : n.v ? n.v > prima.v : n.id === ultima));
  const v: Sezioni = { nuovo: [], migliorato: [], corretto: [], tolto: [] };
  for (const n of voci)
    for (const k of ['nuovo', 'migliorato', 'corretto', 'tolto'] as const) v[k]?.push(...(n[k] ?? []));
  v.catalogo = differenzeCatalogo(prima, ora);
  const nuove = ora.ids.filter(id => !new Set(prima.ids).has(id)).length;
  const qualcosa = SEZIONI.some(([k]) => v[k]?.length);
  apriFoglio(
    html`<div class="nvhead">
        <div class="nvico">${ICONA.spark}</div>
        <h2>Aggiornata alla versione ${versioneApp.version}</h2>
        <div class="muted">
          ${qualcosa ? 'Ecco cosa cambia.' : 'Piccoli miglioramenti: tutto più curato.'} La tua collezione è rimasta
          com'era.
        </div>
      </div>
      ${sezioniNovita(v)} ${pulsantiNovita(nuove)}`,
    'nvsheet',
  );
  return true;
}

export async function apriNovita(): Promise<void> {
  const lista = await caricaNovita();
  apriFoglio(
    html`<h2>Novità delle versioni</h2>
      ${
        lista.length
          ? lista.map(
              (n, i) =>
                html`<div class="nvver">
                    <b>${n.titolo ?? ''}</b
                    ><span
                      >${n.v ? `1.0.${n.v}` : i === 0 && versioneApp ? versioneApp.version : ''}${
                        n.data
                          ? ` · ${new Date(n.data).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`
                          : ''
                      }</span
                    >
                  </div>
                  ${sezioniNovita({ nuovo: n.nuovo ?? [], migliorato: n.migliorato ?? [], corretto: n.corretto ?? [], tolto: n.tolto ?? [] })}`,
            )
          : html`<div class="muted">Elenco non disponibile.</div>`
      }
      <div class="nvbtn"><button class="btn sec2" data-act="close">Chiudi</button></div>`,
    'nvsheet',
  );
}

/** Finestra "Catalogo aggiornato" (se c'è già un'altra finestra aperta basta un avviso in basso). */
export function catalogoAggiornato(prima: FirmaCatalogo | null | undefined, nota: string): void {
  const ora = firmaCatalogo();
  meta.firma = { ...ora };
  salva();
  const catalogo = differenzeCatalogo(prima, ora);
  if (!catalogo.length) catalogo.push(html`${nota || 'Informazioni e foto aggiornate'}`);
  const nuove = prima ? ora.ids.filter(id => !new Set(prima.ids).has(id)).length : 0;
  if (fogliAperti()) {
    avviso('Catalogo aggiornato ✓');
    return;
  }
  apriFoglio(
    html`<div class="nvhead">
        <div class="nvico">${ICONA.spark}</div>
        <h2>Catalogo aggiornato</h2>
        <div class="muted">
          Sono arrivati dati nuovi, senza bisogno di aggiornare l'app. La tua collezione è rimasta com'era.
        </div>
      </div>
      ${sezioniNovita({ catalogo })} ${pulsantiNovita(nuove)}`,
    'nvsheet',
  );
}

/** Proposta, una volta sola: accedere con Google per avere la stessa collezione su telefono e tablet. */
export function propostaSincronizzazione(codiceSostituito: boolean): Promise<void> {
  return apriFoglioEAspetta(
    html`<div class="nvhead">
        <div class="nvico">${ICONA.cloud}</div>
        <h2>Stessa collezione su telefono e tablet</h2>
        <div class="muted">
          ${
            codiceSostituito
              ? 'Il collegamento con il codice è stato sostituito: ora basta accedere con il tuo account Google.'
              : 'Usi Eurodex su più dispositivi? Accedi con il tuo account Google.'
          }
          Dove accedi con lo stesso account la collezione è la stessa, e ogni modifica arriva subito sugli altri con una
          notifica.
        </div>
      </div>
      <div class="nvbtn">
        <button class="btn gbtn" data-act="syncaccedi">${ICONA_GOOGLE} Accedi con Google</button
        ><button class="btn sec2" data-act="close">Non ora</button>
      </div>
      <div class="muted small center">Puoi farlo quando vuoi da Impostazioni → Salvataggio e sincronizzazione.</div>`,
    'nvsheet',
  );
}

export const haCollezione = (): boolean => possedute.size > 0;
