import { dopo } from './orologio';

/**
 * Regola di unione della collezione condivisa, senza Firebase né interfaccia (si prova da sola in
 * tests/unione.test.ts). Ogni voce (moneta posseduta, preferita, nota) ha un valore e l'istante dell'ultima modifica;
 * vince sempre l'istante più avanti. È un registro "last-writer-wins" per voce: un CRDT, quindi tutti i dispositivi
 * arrivano allo stesso risultato in qualsiasi ordine ricevano le modifiche.
 */

export type TipoVoce = 'p' | 'f' | 'n';

export interface Voce {
  /** Posseduta/preferita (sì o no) oppure testo della nota ('' = nessuna nota). */
  v: boolean | string;
  /** Istante dell'orologio logico. */
  t: string;
}

export type Voci = Record<string, Voce>;

/** Chiave interna: tipo + chiave della moneta (es. "p:12345-678"). */
export const chiaveVoce = (tipo: TipoVoce, k: string): string => `${tipo}:${k}`;

export function separa(chiave: string): [TipoVoce, string] {
  return [chiave.slice(0, 1) as TipoVoce, chiave.slice(2)];
}

/** Documento Firestore in cui sta una voce: le possedute sono divise in 16 parti, così nessun documento cresce troppo. */
export function documentoDi(tipo: TipoVoce, k: string): string {
  if (tipo === 'f') return 'f';
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return tipo === 'p' ? `p${(h % 16).toString(16)}` : `n${h % 4}`;
}

/** Tipo delle voci contenute in un documento di voci/ (null per un nome che non è dei nostri). */
export function tipoDelDocumento(nome: string): TipoVoce | null {
  if (!/^(p[0-9a-f]|f|n[0-3])$/.test(nome)) return null;
  return nome[0] as TipoVoce;
}

/** Raggruppa le voci per documento, come si scrivono su Firestore: nel documento la chiave è senza il tipo. */
export function vociPerDocumento(voci: Voci): Map<string, Record<string, Voce>> {
  const out = new Map<string, Record<string, Voce>>();
  for (const [chiave, voce] of Object.entries(voci)) {
    const [tipo, k] = separa(chiave);
    const nome = documentoDi(tipo, k);
    out.set(nome, { ...out.get(nome), [k]: voce });
  }
  return out;
}

/** Il contrario di vociPerDocumento: dal campo "e" di un documento alle voci con la loro chiave completa. */
export function vociDelDocumento(nome: string, e: unknown): Voci {
  const tipo = tipoDelDocumento(nome);
  const out: Voci = {};
  if (!tipo || !e || typeof e !== 'object') return out;
  for (const [k, x] of Object.entries(e as Record<string, Partial<Voce> | null | undefined>)) {
    if (!x || typeof x.t !== 'string') continue;
    const { v, t } = x;
    // le possedute e le preferite sono sì/no, le note sono testo: un valore del tipo sbagliato non si accetta
    if (typeof v === (tipo === 'n' ? 'string' : 'boolean') && v !== undefined) out[chiaveVoce(tipo, k)] = { v, t };
  }
  return out;
}

/** Una chiave interna valida ("p:…", "f:…", "n:…"). */
export const chiaveValida = (chiave: string): boolean => /^[pfn]:./.test(chiave);

export interface Cambio {
  chiave: string;
  prima: Voce | undefined;
  dopo: Voce;
}

/** Unisce voci arrivate da fuori allo stato conosciuto: restituisce quelle che hanno vinto (da applicare qui). */
export function unisci(conosciute: Voci, arrivate: Voci): Cambio[] {
  const cambi: Cambio[] = [];
  for (const [chiave, voce] of Object.entries(arrivate)) {
    if (!chiaveValida(chiave)) continue;
    const ora = conosciute[chiave];
    if (ora && !dopo(voce.t, ora.t)) continue;
    conosciute[chiave] = voce;
    if (ora?.v !== voce.v) cambi.push({ chiave, prima: ora, dopo: voce });
  }
  return cambi;
}

export interface StatoCollezione {
  possedute: ReadonlySet<string>;
  preferite: ReadonlySet<string>;
  note: Readonly<Record<string, string>>;
}

/** Le voci che descrivono la collezione di adesso (senza istanti: quelli li mette chi le invia). */
export function valoriAttuali(s: StatoCollezione): Map<string, boolean | string> {
  const m = new Map<string, boolean | string>();
  for (const k of s.possedute) m.set(chiaveVoce('p', k), true);
  for (const k of s.preferite) m.set(chiaveVoce('f', k), true);
  for (const [k, testo] of Object.entries(s.note)) if (testo) m.set(chiaveVoce('n', k), testo);
  return m;
}

/**
 * Voci arrivate dal server più vecchie di quelle che si conoscono: il server tiene l'ultima scrittura ARRIVATA, non la
 * più recente (un dispositivo rimasto senza rete manda tardi una modifica vecchia e copre quella nuova). Chi conosce la
 * voce più recente la riscrive identica: il server torna alla più recente e tutti si rimettono d'accordo. Finisce da
 * sola, perché ogni riscrittura porta il server a un istante più avanti e una voce uguale non cambia niente.
 */
export function daRiparare(conosciute: Readonly<Voci>, arrivate: Readonly<Voci>): Voci {
  const out: Voci = {};
  for (const [chiave, voce] of Object.entries(arrivate)) {
    const nota = conosciute[chiave];
    if (nota && chiaveValida(chiave) && dopo(nota.t, voce.t)) out[chiave] = nota;
  }
  return out;
}

/**
 * Dei cambi arrivati da fuori, quelli da applicare alla collezione: non quelli delle voci toccate qui e non ancora
 * inviate (il tocco è la modifica più recente: l'orologio ha già visto la voce arrivata, quindi l'invio che segue
 * esce con un istante più avanti e vince ovunque).
 */
export function cambiDaApplicare(cambi: readonly Cambio[], pendenti: ReadonlyMap<string, unknown>): Cambio[] {
  return cambi.filter(c => !pendenti.has(c.chiave));
}

/** La collezione di questo dispositivo, modificabile (per rimetterci sopra le modifiche fatte qui). */
export interface CollezioneModificabile {
  possedute: Set<string>;
  preferite: Set<string>;
  note: Record<string, string>;
}

/** Applica alla collezione delle modifiche (chiave → valore), per esempio quelle fatte qui e non ancora inviate. */
export function riapplica(s: CollezioneModificabile, modifiche: ReadonlyMap<string, boolean | string>): void {
  for (const [chiave, v] of modifiche) {
    if (!chiaveValida(chiave)) continue;
    const [tipo, k] = separa(chiave);
    if (tipo === 'n') {
      if (typeof v === 'string' && v) s.note[k] = v;
      else Reflect.deleteProperty(s.note, k);
    } else {
      const insieme = tipo === 'p' ? s.possedute : s.preferite;
      if (v === true) insieme.add(k);
      else insieme.delete(k);
    }
  }
}

/**
 * Un invio rifiutato (non solo rimandato per mancanza di rete): le voci tornano com'erano prima, così quelle
 * modifiche risultano ancora da inviare e ripartono. Quelle già superate da una modifica più recente restano.
 */
export function annullaInvio(
  conosciute: Voci,
  inviate: Readonly<Voci>,
  prima: Readonly<Record<string, Voce | undefined>>,
): void {
  for (const [chiave, voce] of Object.entries(inviate)) {
    if (conosciute[chiave] !== voce) continue;
    const p = prima[chiave];
    if (p) conosciute[chiave] = p;
    else Reflect.deleteProperty(conosciute, chiave);
  }
}

/** Cosa è cambiato qui rispetto alle voci conosciute: chiave → nuovo valore. */
export function modificheLocali(s: StatoCollezione, conosciute: Readonly<Voci>): Map<string, boolean | string> {
  const attuali = valoriAttuali(s);
  const out = new Map<string, boolean | string>();
  for (const [chiave, v] of attuali) if (conosciute[chiave]?.v !== v) out.set(chiave, v);
  for (const [chiave, voce] of Object.entries(conosciute)) {
    if (attuali.has(chiave) || !chiaveValida(chiave)) continue;
    const vuoto = chiave.startsWith('n:') ? '' : false;
    if (voce.v !== vuoto) out.set(chiave, vuoto);
  }
  return out;
}
