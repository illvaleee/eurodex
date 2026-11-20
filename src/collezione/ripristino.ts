import { html, nothing } from 'lit-html';
import {
  catalogo,
  chiaveAttuale,
  chiaviPezzi,
  costruisciIndice,
  nomePaese,
  paesi,
  tuttiPezzi,
  tuttiTipi,
} from '../catalogo/indice';
import type { Pezzo } from '../catalogo/tipi';
import { $ } from '../core/dom';
import { numero } from '../core/formato';
import { leggiJsonTollerante } from '../core/rete';
import { avviso, avvisoConAnnulla, trattieniInvii } from '../ui/avvisi';
import { apriFoglio, chiudiFoglio } from '../ui/foglio';
import { ridisegna } from '../ui/navigazione';
import { applicaSfondo, fotoPerBackup, impostaFotoDaBackup } from '../ui/sfondo';
import { abbina, leggiCsv, type PezzoCsv, type RigaCsv } from './importa-csv';
import { sincronizzazioneAttiva } from '../sync/sincronizzazione';
import { annullaOperazione, fotografa } from './annulla';
import { spostaChiaviCambiate } from './migrazione';
import {
  applica,
  applicaAspetto,
  collezioneViva,
  elencoPossedute,
  possedute,
  prefs,
  salva,
  serializza,
  storico,
  type Backup,
  type BackupQualsiasi,
} from './stato';

export const opzioniIndice = () => ({ noProof: !!prefs.noProof, noExtra: prefs.noExtra !== false });

/** Dopo un ripristino si rimette tutto in pari: foto di sfondo, catalogo con o senza proof e varianti, colori. */
export async function dopoNuoviDati(b: BackupQualsiasi, conAspetto = true): Promise<void> {
  if (conAspetto && !Array.isArray(b) && typeof b.sfondoFoto === 'string' && b.sfondoFoto.startsWith('data:image/'))
    await impostaFotoDaBackup(b.sfondoFoto).catch(() => undefined);
  if (catalogo) costruisciIndice(catalogo, opzioniIndice());
  spostaChiaviCambiate();
  applicaSfondo();
}

/** Applica un backup e sistema tutto il resto (indice, sfondo, chiavi cambiate). */
export async function ripristina(b: BackupQualsiasi, conAspetto = true): Promise<void> {
  applica(b, conAspetto);
  salva();
  await dopoNuoviDati(b, conAspetto);
}

let ripristinoInAttesa: (() => Promise<void>) | null = null;

/**
 * Chiede conferma (con quante monete, preferite e note ci sono) e poi sostituisce la collezione, con "Annulla".
 * Con `collega`, la finestra chiede anche se usare quel file per il backup automatico: il collegamento si fa solo
 * se il ripristino non viene annullato.
 */
export function confermaRipristino(
  testo: string,
  da: string,
  collega?: { proposto: boolean; fai: () => void; lascia: () => void },
): void {
  let b: BackupQualsiasi;
  try {
    b = leggiJsonTollerante(testo) as BackupQualsiasi;
  } catch {
    avviso('Backup non valido');
    return;
  }
  const lista = elencoPossedute(b);
  if (!lista) {
    avviso('Backup non valido');
    return;
  }
  const valide = new Set(lista.map(k => chiaveAttuale(k)).filter(Boolean)).size;
  const ora = [...possedute].filter(k => chiaviPezzi.has(k)).length;
  const completo: Backup | null = Array.isArray(b) ? null : b;
  const preferiti = completo?.preferiti?.length ?? 0;
  const quanteNote = completo?.note ? Object.keys(completo.note).length : 0;
  const conAspetto = !!completo?.preferenze || !!completo?.sfondoFoto;
  apriFoglio(
    html`<h2>Ripristinare la collezione?</h2>
      <div class="muted">
        Il backup ${da} contiene <b>${numero(valide)}</b> ${valide === 1 ? 'moneta' : 'monete'}${
          completo?.data ? ` (salvato il ${completo.data.split('-').reverse().join('/')})` : ''
        }${preferiti ? `, ${preferiti === 1 ? '1 preferita' : `${numero(preferiti)} preferite`}` : ''}${
          quanteNote ? ` e ${quanteNote === 1 ? '1 nota' : `${numero(quanteNote)} note`}` : ''
        }.
        Ora ne hai segnate ${numero(ora)}: la collezione di adesso viene sostituita da quella del
        backup${sincronizzazioneAttiva() ? ', anche sugli altri dispositivi collegati al tuo account Google' : ''} (puoi
        annullare subito dopo).
      </div>
      ${
        conAspetto
          ? html`<label class="tgl" style="margin-top:10px"
              ><span
                ><b>Anche aspetto e impostazioni</b
                ><small
                  >Sfondo, colori, vista album, proof e ordinamenti com'erano nel backup. Spegnilo se su questo
                  dispositivo vuoi tenere l'aspetto che ha adesso</small
                ></span
              ><input type="checkbox" id="rstaspetto" checked /><i></i
            ></label>`
          : nothing
      }
      ${
        collega
          ? html`<label class="tgl" style="margin-top:10px"
              ><span
                ><b>Usa questo file anche per il backup automatico</b
                ><small
                  >Da adesso l'app aggiorna questo file (al posto di quello collegato finora, se c'era)</small
                ></span
              ><input type="checkbox" id="rstcollega" .checked=${collega.proposto} /><i aria-hidden="true"></i
            ></label>`
          : nothing
      }
      <button class="btn" data-act="dorestore">Ripristina</button>
      <button class="btn sec2" data-act="close">Annulla</button>`,
  );
  ripristinoInAttesa = async () => {
    const aspetto = !!$<HTMLInputElement>('#rstaspetto')?.checked;
    const daCollegare = !!collega && !!$<HTMLInputElement>('#rstcollega')?.checked;
    const prima = JSON.parse(serializza(fotoPerBackup())) as Backup;
    const fotoPrima = fotografa(collezioneViva());
    // fino a quando compare "Annulla" gli invii agli altri dispositivi aspettano (il ripristino può durare un po')
    trattieniInvii(true);
    try {
      await ripristina(b, aspetto);
      const fotoDopo = fotografa(collezioneViva());
      chiudiFoglio();
      ridisegna();
      const cosa = `${valide === 1 ? 'Ripristinata 1 moneta' : `Ripristinate ${numero(valide)} monete`}${preferiti ? ', preferite' : ''}${quanteNote ? ', note' : ''}${aspetto && completo?.preferenze ? ' e aspetto' : ''}`;
      avvisoConAnnulla(
        cosa,
        () => {
          // torna quello che il ripristino ha cambiato (e l'aspetto di prima), non quello arrivato nel frattempo
          annullaOperazione(fotoPrima, fotoDopo, collezioneViva());
          if (aspetto) applicaAspetto(prima);
          salva();
          void dopoNuoviDati(prima, aspetto).then(() => {
            ridisegna();
          });
          collega?.lascia();
        },
        daCollegare ? collega.fai : undefined,
      );
    } finally {
      trattieniInvii(false);
    }
    if (collega && !daCollegare) collega.lascia();
  };
}

export async function eseguiRipristinoInAttesa(): Promise<void> {
  const f = ripristinoInAttesa;
  ripristinoInAttesa = null;
  await f?.();
}

// ───────── importazione dalla vecchia app (CSV) ─────────

let annullaImportazione: (() => void) | null = null;

export function importaCsv(testo: string): void {
  const righe = leggiCsv(testo);
  if (!righe?.length) {
    avviso('File non riconosciuto');
    return;
  }
  // si cerca tra tutti i pezzi, anche quelli nascosti (proof, varianti): una moneta segnata non va persa
  const perTipo = new Map<string, Pezzo[]>();
  for (const p of tuttiPezzi) perTipo.set(p.t.id, [...(perTipo.get(p.t.id) ?? []), p]);
  const esito = abbina(
    righe,
    tuttiTipi.map(t => ({ ...t, pieces: perTipo.get(t.id) ?? [] })),
  );
  const fotoPrima = fotografa(collezioneViva());
  const aggiunte: string[] = [];
  for (const r of righe) {
    const p: PezzoCsv | null | undefined = r.piece;
    if (!p || possedute.has(p.key)) continue;
    possedute.add(p.key);
    aggiunte.push(p.key);
    // il file ha solo la data: la modifica si mette a mezzogiorno di quel giorno e si segna "solo data" (niente ora)
    if (r.date) storico.push([Math.floor(new Date(`${r.date}T12:00:00`).getTime() / 1000), '+', p.key, 'd']);
    else storico.push([Math.floor(Date.now() / 1000), '+', p.key]);
  }
  storico.sort((a, b) => a[0] - b[0]);
  salva();
  const fotoDopo = fotografa(collezioneViva());
  ridisegna();
  const paese = (cc: string) => (paesi[cc] ? `${paesi[cc].flag} ${nomePaese(cc)}` : cc);
  const etichetta = (r: RigaCsv) =>
    `${paese(r.cc)} · ${r.y} · ${r.v >= 100 ? `${r.v / 100} euro` : `${r.v} cent`}${r.mint ? ` ${r.mint}` : ''}${r.title ? ` — ${r.title}` : ''}`;
  apriFoglio(
    html`<h2>Importazione completata</h2>
      <div class="muted">
        Righe nel file: ${numero(righe.length)} · riconosciute:
        <b>${numero(righe.length - esito.nonTrovate.length)}</b> · nuove in collezione: ${numero(aggiunte.length)}
      </div>
      ${
        esito.spostate.length
          ? html`<div class="sec">Paese corretto (${esito.spostate.length})</div>
              <div class="small muted">Nel file avevano il paese sbagliato: sono state segnate nel paese giusto.</div>
              <ul class="small" style="padding-left:18px">
                ${esito.spostate.map(
                  r =>
                    html`<li>
                      ${etichetta(r)} →
                      ${paese(r.altCc ?? '')}${
                        righe.some(x => x !== r && !x.altCc && x.piece?.key === r.piece?.key)
                          ? " (era già segnata: nella vecchia app c'era due volte)"
                          : ''
                      }
                    </li>`,
                )}
              </ul>`
          : nothing
      }
      ${
        esito.nonTrovate.length
          ? html`<div class="sec">Non trovate nel catalogo (${esito.nonTrovate.length})</div>
              <div class="small muted">Puoi segnarle a mano dalla ricerca.</div>
              <ul class="small" style="padding-left:18px">
                ${esito.nonTrovate.map(r => html`<li>${etichetta(r)}</li>`)}
              </ul>`
          : nothing
      }
      <button class="btn" data-act="close" style="margin-top:14px">Fatto</button>
      ${aggiunte.length ? html`<button class="btn ghost" data-act="undoimport">Annulla l'importazione</button>` : nothing}`,
  );
  annullaImportazione = () => {
    // via solo le monete importate e le loro righe: restano quelle arrivate da altri dispositivi mentre si leggeva
    annullaOperazione(fotoPrima, fotoDopo, collezioneViva());
    salva();
    ridisegna();
  };
}

export function annullaUltimaImportazione(): boolean {
  const f = annullaImportazione;
  annullaImportazione = null;
  f?.();
  return !!f;
}
