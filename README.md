# Eurodex

App Android per tenere traccia delle monete euro da circolazione: tutti i paesi, ogni anno, ogni zecca, versioni
proof, varianti e 2 euro commemorativi. Foto e descrizioni ufficiali della BCE, dati tecnici, tirature e stime da
[Numista](https://it.numista.com).

## Architettura

| Parte | Tecnologia | Dove |
| --- | --- | --- |
| Interfaccia | TypeScript (strict) + [lit-html](https://lit.dev/docs/libraries/standalone-templates/), compilata con [Vite](https://vite.dev) | `src/` → `www/` |
| App Android | [Capacitor 8](https://capacitorjs.com) + plugin nativo in Java (accesso Google, file su Drive, notifiche, aggiornamenti) | `native/` |
| Sincronizzazione | Firebase Authentication + Cloud Firestore (SDK ufficiale, offline), orologio logico ibrido per voce | `src/sync/`, `firebase/` |
| Catalogo | Script Node che scaricano da Numista e BCE; pubblicazione dei dati senza nuova versione dell'app | `scripts/`, `www/data/` |
| Prove | Vitest (unità), Playwright (browser), esploratore su emulatore Android, Firebase vero | `tests/`, `prove/`, `scripts/test-emulator.py` |

Moduli principali di `src/`:

- `catalogo/` — tipi dei dati, indice in memoria, varianti (scheda Extra), dati aggiornabili, gruppi e contatori
- `collezione/` — monete, preferite, note, storico e impostazioni; backup nei file; importazione CSV; ripristino
- `sync/` — orologio logico (`orologio.ts`), regola di unione (`unione.ts`, un CRDT "last-writer-wins" per voce),
  Firestore (`motore.ts`), stato e accesso (`sincronizzazione.ts`), interfaccia (`interfaccia.ts`)
- `ui/` — navigazione, schede, finestre di dialogo, avvisi, zoom, sfondo, azioni dell'utente
- `viste/` — una per schermata (Collezione, Le mie, Catalogo, Mancanti, Extra, Cerca, scheda moneta, impostazioni…)
- `nativo/` — tipi del plugin Android, versione installata, aggiornamenti dell'app

Regole del codice: niente HTML costruito con stringhe (i modelli lit-html neutralizzano ogni testo inserito), niente
gestori inline, accessibilità (nomi per TalkBack, finestre modali che isolano la pagina sotto, barre con il loro valore),
errori non previsti registrati nel log di Android con l'etichetta `Eurodex`.

## Sviluppo

```bash
npm ci
npm run dev        # anteprima nel browser
npm run verifica   # tipi + regole del codice (ESLint strict) + formattazione (Prettier) + test unitari
npm run build      # compila in www/
bash prove/esegui.sh   # prove nel browser (la sincronizzazione richiede gli emulatori di Firebase)
```

## Rilascio

Ogni push su `main` che tocca l'app avvia *Compila APK*: controlli del codice, prove nel browser (con gli emulatori di
Firebase), prova guidata sul telefono simulato, **esploratore** (`prove/esploratore.py`: prova l'app come una persona,
senza sequenze di tocchi scritte prima) e solo se tutto passa pubblica la versione, manda la notifica e prova
l'aggiornamento dalla versione precedente. Dai rami diversi da `main` si compila e si prova tutto senza pubblicare.

Il catalogo si aggiorna da solo (*Scarica catalogo*: il 1° del mese completo, ogni lunedì le monete nuove dell'anno) e
arriva nelle app installate senza una versione nuova.

## Dove sono le cose

- `www/data/` — catalogo (`catalog.json`), schede (`details.json`) e foto, generati dagli script
- `scripts/fetch-catalog.mjs` — scarica il catalogo dall'API ufficiale di Numista (con cache e quota per chiave)
- `scripts/cache/` — risposte già scaricate, così non si consumano richieste due volte
- `keystore/` — chiave di firma dell'APK: **non va mai cambiata**, senza non si installano gli aggiornamenti
- Il repository deve restare **privato**: contiene chiavi e credenziali
