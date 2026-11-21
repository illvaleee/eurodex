# Progetto: accesso a Eurodex solo su approvazione

Stato: **bozza da rivedere** (Claude 1, 21/11/2026). Niente codice finché Claude 2 e Claude 3 non l'hanno rivisto e
Valerio non l'ha approvato.

## 1. Lo scopo (parole di Valerio, 21/11)

Chi installa l'app la può vedere, ma non usarla. La richiesta arriva a Valerio, che la accetta o la rifiuta: finché
non è accettata la persona resta sulla schermata di accesso. Chi non è approvato non deve ricevere né gli
aggiornamenti dell'app né quelli dei contenuti, e non deve poter usare **nessuna parte online**. Questo vale anche se
modifica l'APK o lo ricompila. I servizi esterni sono pensati per pochi dispositivi, e devono restare così.

## 2. Cosa c'è oggi, e chi lo può usare

| Parte online | Dove sta | Chi la può usare oggi |
| --- | --- | --- |
| Sincronizzazione | Firestore, `collezioni/{uid}/…` (regole: solo il proprietario) | **chiunque abbia un account Google**: si crea la sua collezione sul nostro progetto |
| Avvisi di sincronizzazione | funzione `avvisaDispositivi` → argomento FCM `c_<cid>` | chi sincronizza |
| Avvisi di versione nuova | argomento FCM `aggiornamenti` (`scripts/invia-avviso.py`) | **chiunque abbia l'app**: l'iscrizione a un argomento non richiede accesso |
| Aggiornamenti dell'app | `version.json` e APK su `raw.githubusercontent.com/illvaleee/collezione-euro-download` | **chiunque**, anche senza l'app |
| Aggiornamenti dei contenuti | `dati/` (indice, catalogo, schede, foto) sulla stessa pagina pubblica | **chiunque** |
| Numista | solo un collegamento alla pagina web della moneta; i dati sono già nelle schede | nessun uso diretto: nell'app non c'è nessuna chiave |

## 3. Il principio

**Il controllo sta sul server, mai nell'app.** Tutto quello che sta nell'APK (una password, un "se non approvato non
mostrare", la configurazione di Firebase) chi lo modifica lo legge o lo salta. La configurazione di Firebase non è un
segreto, ed è già nel codice pubblico: la sicurezza la fanno le regole. Quindi:

- l'app mostra la schermata di accesso, ma è solo l'interfaccia;
- il server (regole di Firestore e di Storage, funzioni) dà i dati, gli aggiornamenti e le notifiche **solo agli
  account approvati**, controllando ogni richiesta.

Con chi abbiamo a che fare:

1. chi installa l'APK pubblico;
2. chi lo modifica, o lo ricompila dal codice pubblico (stessa configurazione Firebase);
3. una persona approvata a cui poi Valerio toglie l'accesso;
4. chi manda richieste a raffica (tanti account Google);
5. chi ruba la sessione di un approvato. La sessione di Firebase dura un'ora e si rinnova solo sul dispositivo;
   con la revoca si chiude subito (punto 4.7).

## 4. Come funziona

### 4.1 Stati di un account

`nessuno → in_attesa → approvato | rifiutato`, e da `approvato` si può passare a `revocato`. Valerio può sempre
cambiare idea: rifiutato → approvato, revocato → approvato.

Ogni account ha il suo documento `accessi/{uid}`:

| Campo | Chi lo scrive | Note |
| --- | --- | --- |
| `stato` | la persona solo alla creazione (`in_attesa`), poi **solo Valerio** | le regole impediscono di approvarsi da soli |
| `nome`, `email` | la persona, alla creazione | presi dall'accesso Google, con lunghezza limitata (`email` deve essere quella del gettone) |
| `dispositivo` | la persona, alla creazione | modello del telefono, al massimo 80 caratteri |
| `richiesta`, `decisione` | il server (`request.time`) | date |
| `nota` | solo Valerio | facoltativa, per ricordarsi chi è |

### 4.2 Le regole di Firestore (il muro vero)

```
function admin() { return request.auth != null && request.auth.uid == '<UID di Valerio>'
                        && request.auth.token.email_verified == true; }
function approvato() { return request.auth != null
  && get(/databases/$(database)/documents/accessi/$(request.auth.uid)).data.stato == 'approvato'; }

match /accessi/{uid} {
  allow create: if request.auth.uid == uid && request.resource.data.stato == 'in_attesa'
                && <solo i campi previsti, lunghezze limitate, email == request.auth.token.email>;
  allow get:    if request.auth.uid == uid || admin();
  allow list, update: if admin();          // approvare, rifiutare, revocare
  allow delete: if admin();
}
match /collezioni/{uid}/{documento=**} {
  // tutte le regole di oggi, più: && approvato()
}
```

- La revoca ha effetto **subito**: `approvato()` legge lo stato a ogni richiesta (costa una lettura in più, niente
  per pochi dispositivi). I "custom claims" nel gettone sarebbero più economici, ma la revoca avrebbe fino a un'ora
  di ritardo.
- Il codice di Valerio non c'è nelle regole: c'è solo il suo UID, che non è un segreto (identifica, non autorizza).

### 4.3 La sezione di Valerio nell'app

Nelle impostazioni, visibile solo all'account di Valerio (ma protetta dalle regole, non dalla visibilità):
richieste in attesa (nome, email, telefono, data, con i pulsanti **Accetta** e **Rifiuta**), persone approvate (con
**Togli l'accesso**) e persone rifiutate (con **Ripensaci**). A ogni richiesta nuova a Valerio arriva una
notifica: una funzione su `accessi/{uid}` creato la manda ai **suoi** dispositivi.

Più avanti si potrà aggiungere una **pagina web** con le stesse funzioni (Firebase Hosting, accesso con Google, stesse
regole). Nel settore si fanno di solito tutte e due; partirei dall'app, che Valerio usa già.

### 4.4 La schermata di accesso nell'app

All'apertura, prima di tutto il resto:

- non è entrato → "Accedi con Google", con una riga che spiega che il creatore vedrà nome ed email;
- `in_attesa` → "Richiesta inviata, aspetta che venga approvata", con il pulsante "Controlla di nuovo"
  (e lo stato si aggiorna da solo quando cambia);
- `rifiutato` o `revocato` → un messaggio, e l'uscita dall'account;
- `approvato` → l'app normale.

Senza rete, se l'ultimo stato conosciuto è "approvato", l'app si usa con i dati locali: tanto la parte online
la controlla il server. Chi modifica l'APK può saltare la schermata e vedere i dati già dentro l'APK: non si può
impedire, e non tocca i servizi.

### 4.5 Notifiche: niente più argomenti pubblici

- **Versione nuova** e **contenuti nuovi**: non più all'argomento `aggiornamenti` (chiunque ci si può iscrivere), ma ai
  **token dei dispositivi degli approvati**, salvati in `accessi/{uid}/dispositivi/{did}` (scrivibili solo
  dall'approvato). `invia-avviso.py` li legge con l'SDK Admin e manda gli invii a gruppi.
- **Sincronizzazione**: `avvisaDispositivi` manda ai token dei dispositivi di quell'account, non più all'argomento
  `c_<cid>`.
- L'app nuova si disiscrive dagli argomenti vecchi.

### 4.6 Aggiornamenti e contenuti solo agli approvati

Si spostano dalla pagina pubblica a **Cloud Storage di Firebase**, con regole che leggono lo stato da Firestore:

```
match /b/{bucket}/o {
  match /{percorso=**} {
    allow read: if request.auth != null
      && firestore.get(/databases/(default)/documents/accessi/$(request.auth.uid)).data.stato == 'approvato';
    allow write: if false;                    // scrive solo il workflow, con l'account di servizio
  }
}
```

- Ci vanno `rilasci/version.json`, `rilasci/Eurodex-<versione>.apk`, `dati/indice.json`, il catalogo, le schede e
  le foto.
- L'app scarica con l'SDK di Storage, che manda il gettone dell'utente. L'aggiornamento dall'app scarica l'APK nella
  cache e apre l'installazione, come adesso.
- I workflow (firma-e-pubblica, catalogo, foto) caricano su Storage con un account di servizio che può solo
  scrivere lì.
- Costi: sono APK da circa 40 MB e qualche MB di dati per pochi dispositivi, dentro la quota gratuita. L'avviso di
  spesa da 5 € resta.

**La pagina pubblica** resta solo per la **prima installazione**: lì c'è l'APK che apre la schermata di accesso, e
basta. `version.json` pubblico resta fermo alla prima versione con l'accesso (punto 5), così le installazioni
vecchie si aggiornano una volta, fino alla schermata di accesso, e poi non vedono più niente.

### 4.7 Revoca

Valerio tocca "Togli l'accesso". Lo stato diventa `revocato`, le regole bloccano subito sincronizzazione e download,
e una funzione toglie i token di quei dispositivi e chiude le sessioni (`revokeRefreshTokens`). Alla prossima
apertura, o al primo errore del server, l'app torna alla schermata di accesso.

### 4.8 Richieste a raffica

- Si accede solo con Google: niente accessi anonimi, niente email e password.
- Una sola richiesta per account (`create` solo se il documento non c'è), con campi corti e controllati.
- Valerio può cancellare in un colpo le richieste che non conosce.
- **App Check** (verificare che l'app sia quella vera) con Play Integrity richiede la distribuzione dal Play Store;
  per un APK scaricato non c'è un metodo solido. Lo lascerei fuori: senza approvazione un'app modificata non ottiene
  niente comunque. → **domanda aperta per Claude 2 e 3**.

### 4.9 Dati personali

Si salvano nome, email e modello del telefono di chi chiede l'accesso, visibili solo a Valerio. Lo si dice nella
schermata di accesso. Su richiesta della persona, Valerio cancella il documento.

## 5. Il passaggio, senza perdere niente

1. **Server, compatibile**: si pubblicano le regole con `accessi`, la sezione admin e la richiesta, ma **senza
   ancora** `approvato()` sulle collezioni. Nessuno perde niente.
2. **App 1.0.81** (ultima pubblicata anche sulla pagina pubblica), con dentro: schermata di accesso, richiesta,
   sezione di Valerio, download da Storage, notifiche ai token.
3. **Valerio entra**: il suo account è approvato fin dall'inizio. Poi approva il suo amico (e chi vuole lui).
4. **Regole strette**: `approvato()` su collezioni e Storage, e via gli argomenti pubblici. Da qui chi non è
   approvato non riceve più niente.
5. **Pagina pubblica ferma** alla 1.0.81: le versioni successive escono solo su Storage.

I dati di sincronizzazione dell'amico restano in `collezioni/{uid}` e tornano appena è approvato.

## 6. Le prove (tutte automatiche)

- **Regole**, con l'emulatore di Firestore e Storage:
  - un account non approvato non legge e non scrive;
  - `in_attesa` non può approvarsi da solo, né cambiare nome o email dopo;
  - Valerio approva, rifiuta e revoca, e la revoca ha effetto subito;
  - un approvato non legge le collezioni degli altri;
  - Storage risponde solo agli approvati.
- **App nel browser** (Playwright con gli emulatori): le quattro schermate di accesso, la sezione di Valerio,
  l'approvazione che sblocca l'app in diretta, la revoca che la richiude.
- **Telefono simulato**: l'APK di prova si collega agli emulatori di Firebase con un utente di prova già approvato.
  Senza, la schermata di accesso fermerebbe tutte le prove di oggi.
- **Telefono vero di Valerio** (USB, il suo account Google già sul telefono): accesso vero, richiesta, approvazione,
  sincronizzazione.
- **Sicurezza**: dall'APK pubblicato, senza approvazione, una prova chiama direttamente Firestore e Storage con la
  configurazione dell'app e controlla che rispondano "permesso negato".

## 7. Cosa non si può impedire (detto chiaro)

- Il codice di eurodex è pubblico: chiunque può leggerlo e ricompilarlo. Senza approvazione, però, non usa i servizi.
  Renderlo privato costerebbe minuti di GitHub Actions, che per i progetti privati sono pochi.
- I contenuti già dentro un APK installato (catalogo e foto della versione installata) restano lì; quelli nuovi non
  arrivano.
- Chi è approvato può far vedere l'app a qualcun altro sul suo telefono: questo è normale.

## 8. Lavori, in ordine

1. Revisione di questo documento (Claude 2 e 3), poi approvazione di Valerio.
2. Regole, con le loro prove sull'emulatore. PR a parte.
3. Funzioni: notifica a Valerio, invii ai token, revoca. PR a parte.
4. App: schermata di accesso, sezione di Valerio, Storage, token, configurazione di prova per gli emulatori.
5. Workflow: pubblicazione su Storage, catalogo e foto su Storage, `invia-avviso.py` ai token.
6. Passaggio (punto 5), con Valerio presente.

Ogni passo ha le sue prove ed è rivisto da tutti e tre prima di andare su main.
