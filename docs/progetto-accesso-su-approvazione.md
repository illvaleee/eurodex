# Progetto: accesso a Eurodex solo su approvazione

Stato: **bozza, rivista da Claude 2 e Claude 3 il 21/11** (le decisioni sono in §9). Valerio ha scelto **A**
(§9.1): si proteggono i servizi. Niente codice finché Claude 2 e Claude 3 non l'hanno rivisto e
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
- **Telefono simulato**: qui c'è un problema vero da decidere insieme (vedi §6.1). Senza una soluzione, la schermata
  di accesso fermerebbe tutte le prove di oggi sull'APK.

### 6.1 Come provare l'APK vero con la schermata di accesso (da decidere)

Oggi l'APK provato sul telefono simulato è **lo stesso, byte per byte**, di quello pubblicato: cambia solo la firma
(R16, verificato con la 1.0.80). Questa garanzia va tenuta. Ma sul telefono simulato non c'è un account Google, quindi
la schermata di accesso non si supera.

| Strada | Come | Pro | Contro |
| --- | --- | --- | --- |
| A. APK di prova diverso | un'opzione al momento della compilazione toglie la schermata | semplice | **l'APK provato non è più quello pubblicato**: si perde R16 |
| B. Modalità prove da adb | l'app salta la schermata solo se c'è una proprietà `debug.eurodex.prove` (la può mettere solo chi ha il telefono collegato con adb) | stesso APK; nessun segreto | chi ha adb vede l'app in locale (come chi modifica l'APK); i servizi restano chiusi dal server |
| C. Emulatori di Firebase anche per l'APK | l'APK, se gli si dice con adb di usare gli emulatori, ci si collega e fa l'accesso finto | prova anche la schermata stessa | molto lavoro (accesso Google finto nell'app nativa); stessa questione di B |
| D. Account Google di prova sul telefono simulato | si aggiunge un account vero sul telefono simulato | prova l'accesso vero | servirebbe la password di un account (non la inserisco io) e Google blocca gli accessi automatici |

**Proposta: B**. La schermata di accesso è comodità per la persona, non sicurezza: il muro sta sul server (§3), e chi
ha adb o modifica l'APK vede solo i dati già dentro l'APK, senza servizi. Con B l'APK provato resta quello pubblicato. La
schermata stessa si prova nel browser (Playwright con gli emulatori: le quattro schermate, l'approvazione in
diretta, la revoca) e sul telefono vero di Valerio, con il suo account. → **Domanda per Claude 2, Claude 3 e Valerio.**
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
- Restano **pubblici, per scelta di Valerio (A, §9.1)**: le release con l'APK firmato, gli artifact `apk-*`, `www/data`
  (catalogo, schede e foto) e i rami delle prove con le schermate. Chi li prende ha app e contenuti, ma l'app senza
  approvazione non usa i servizi: sincronizzazione, avvisi, aggiornamenti e contenuti nuovi dall'app.

## 8. Lavori, in ordine

1. Revisione di questo documento (Claude 2 e 3), poi approvazione di Valerio.
2. Regole, con le loro prove sull'emulatore. PR a parte.
3. Funzioni: notifica a Valerio, invii ai token, revoca. PR a parte.
4. App: schermata di accesso, sezione di Valerio, Storage, token, configurazione di prova per gli emulatori.
5. Workflow: pubblicazione su Storage, catalogo e foto su Storage, `invia-avviso.py` ai token.
6. Passaggio (punto 5), con Valerio presente.

Ogni passo ha le sue prove ed è rivisto da tutti e tre prima di andare su main.

## 9. Revisione di Claude 2 e Claude 3 (21/11): decisioni

Questi punti hanno la precedenza su quello che c'è scritto sopra, dove sono in contrasto.

### 9.1 Servizi o anche contenuti: deciso A

**Valerio ha scelto A** (21/11, alle 09:36, nella chat di Claude 2: "Preferisco A"). Si proteggono i servizi; che app
e contenuti si trovino su GitHub va bene, ed è scritto in §7. Sotto, la domanda com'era stata posta.

Il progetto, così com'è, protegge i **servizi**. Con eurodex pubblico, alcune cose restano scaricabili da chiunque abbia
un account GitHub:
- le release pubbliche con l'APK firmato (`gh release create`);
- gli artifact `apk-prova` (un'app funzionante, firmata con la chiave di prova) e `apk-non-firmato`;
- `www/data`, cioè catalogo, schede e foto;
- i rami `prove*` ed `esplorazione`, con le schermate.

**A**: bastano i servizi, e il progetto resta com'è. **B**: anche app e contenuti riservati, quindi niente release
pubbliche, niente APK negli artifact e dati fuori dal progetto pubblico (almeno una parte torna privata, con il costo
in minuti di GitHub Actions). Claude 2 e Claude 1 l'hanno chiesto a Valerio; la risposta decide il passo 5.

### 9.2 Storage

- **Mai `getDownloadURL()`.** Gli indirizzi con il token di download non passano dalle regole. L'app usa
  `getBytes`, `getStream` o `getFile` dell'SDK, che mandano il gettone dell'utente.
- **I workflow caricano senza token di download**: niente `firebaseStorageDownloadTokens` nei metadati.
- **Regole con `firestore.get()`**: alla prima pubblicazione Firebase chiede di dare un ruolo all'account di servizio
  di Storage. È un'azione per Valerio.
- **Costi**: Storage richiede il piano Blaze (c'è già per le funzioni). Per i bucket nuovi la parte gratuita vale solo
  in US-CENTRAL1, US-EAST1 e US-WEST1, mentre un bucket in Europa si paga dal primo byte. Con questi volumi sono
  centesimi, ma la regione va scelta quando si crea il bucket. L'avviso di spesa da 5 € resta.
  Fonte: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024.

### 9.3 Avvisi agli approvati: li manda una funzione, non GitHub (sostituisce §4.5, punto 1)

In Firestore i permessi IAM valgono per tutto il database. Se `invia-avviso.py` leggesse i token con l'SDK Admin, la
chiave di GitHub (`FIREBASE_INVIO_JSON`, anche nell'environment `catalogo`, che è senza revisori) leggerebbe tutte le
collezioni e tutte le richieste. Quindi:
- il workflow carica `rilasci/version.json` o `dati/indice.json` su Storage;
- una funzione `onObjectFinalized` legge i token, controlla lo stato di ogni account e manda gli avvisi;
- la chiave di GitHub serve solo a scrivere su Storage, limitata a bucket e percorsi con le condizioni IAM;
- `FIREBASE_INVIO_JSON` perde il permesso di Cloud Messaging, oppure viene sostituita.

### 9.4 Lavori in background: serve una sessione nativa (aperto)

`ScaricaDati` e `ControlloAggiornamenti` girano in WorkManager, nella parte nativa, mentre l'accesso oggi sta nella
parte web (SDK JS). Con Storage, i lavori in background hanno bisogno di un gettone valido, e il gettone dura un'ora.
Va deciso dove vive la sessione:
- **Firebase Auth nativo**, condiviso con la parte web tramite un plugin di Capacitor;
- oppure la **parte web passa i gettoni**: in quel caso in background si scarica solo finché il gettone è valido.

**Deciso (Claude 2, Claude 3 e Claude 1): Firebase Auth nativo come sessione principale, nel nostro plugin nativo
(`NativoPlugin`, che con Credential Manager prende già il gettone Google) e non con un plugin di Capacitor di terzi.**
- Il gettone Google ID di Credential Manager (`androidx.credentials` e `googleid` ci sono già) serve per due accessi:
  `FirebaseAuth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null))` nella parte nativa e
  `signInWithCredential` nell'SDK JS. Se si usa un nonce, è lo stesso per tutti e due.
- In background, `ScaricaDati` e `ControlloAggiornamenti` usano l'SDK nativo di Storage (`getFile`, con `Tasks.await`
  nel thread del Worker). Il gettone lo rinnova l'SDK da solo, senza passare dal nostro codice.
- `revokeRefreshTokens` chiude tutte e due le sessioni. In background un rinnovo rifiutato ferma il lavoro. "Esci" fa
  `signOut` in tutti e due i posti.
- **Perché non la strada "la parte web passa i gettoni"**: o il background funziona solo nell'ora del gettone (e così il
  controllo ogni 6 ore e gli scaricamenti dalla notifica non vanno), oppure il refresh token lo salviamo noi e lo
  rinnoviamo a mano, cioè proprio la parte più delicata da scrivere da soli.
- **Perché non un plugin di terzi**: sarebbe un pacchetto in più dentro l'APK firmato, mentre il nostro plugin ha già
  Credential Manager e la parte nuova è piccola.
- **Da provare sul telefono vero** (Claude 3): che lo stesso gettone Google valga per tutti e due gli accessi, nella sua
  ora; quanto cresce l'APK con le due librerie native.

### 9.5 Richieste: il nome non è affidabile (fatto in #8)

Si decide sull'email del gettone, e il nome è solo un aiuto. Nelle regole, `nome` e `dispositivo` sono
`[^@\p{Cc}\p{Cf}]{0,80}`: niente `@` per fingersi un altro, niente a capo né caratteri di direzione (provato con RE2
e sull'emulatore). La notifica a Valerio comincia con l'email, e nella sua sezione l'email è in evidenza.
Accesso solo con Google anche nelle regole: `conGoogle()` in `create`, in `approvato()` e in `admin()`.

### 9.6 Richieste a raffica e dati personali (sostituisce §4.8 e §4.9 dove diversi)

- **App Check**: resta fuori.
- **Notifiche a Valerio a rate**: al massimo una ogni tanto, con il numero di richieste nuove.
- **Un tetto**: oltre N richieste nuove al giorno, la funzione cancella le successive.
- **Pulizia**: le richieste rifiutate o mai decise si cancellano da sole dopo 30 giorni, con una funzione programmata.

### 9.7 Le prove dell'APK (decide §6.1): B, con due condizioni

1. La proprietà `debug.eurodex.prove` **salta solo la schermata di accesso**: non cambia indirizzi né regole. Su
   Android le proprietà `debug.*` le può mettere solo chi ha adb o il root, cioè chi potrebbe già modificare l'APK.
2. Le prove che **scaricano dall'app** (`aggiornamento`, la parte scaricata di `sopra`), quando aggiornamenti e
   contenuti passano a Storage, senza un account approvato non scaricano più niente. Servono gli emulatori di Auth e
   Storage per quei flussi, raggiungibili dal telefono simulato a `10.0.2.2` (strada C, con la stessa proprietà),
   oppure quella parte si prova sul telefono vero. Va scelto prima di scrivere l'app.

**Fatto per la 1.0.83** (Claude 3 si è accorto che su `main` mancava):
- `Nativo.modoProve()` legge `debug.eurodex.prove` e `debug.eurodex.muro` con `SystemProperties.get`;
- con `prove=1`, `cambia()` resta `aperto` (la schermata non c'è, il resto è vero);
- con `muro=acceso`, il muro vale acceso solo su quel telefono: può solo chiudere, e serve a provare il muro vero
  nell'APK senza toccare l'interruttore di Valerio;
- `test-emulator.py` ed `esploratore.py` mettono `prove=1` prima del primo avvio. La prova 7b controlla che con
  `muro=acceso` si veda il muro e che con `prove=1` si veda l'app.

Le versioni fino alla 1.0.82 non conoscono le proprietà. «Sopra» e la prova di aggiornamento partono dalla versione
pubblicata, quindi **il muro si accende solo quando la versione pubblicata è almeno la 1.0.83**.

### 9.8 Passo 5, reso esplicito (con A, §9.1)

- **togliere `dati/` dalla pagina pubblica**, o almeno smettere di aggiornarla. Non è per nascondere i contenuti, che
  restano in `www/data`: è che le app vecchie, non approvate, li scaricano da lì da sole, e questo è un servizio;
- `controllo` legge la versione pubblicata da Storage invece che dalla pagina pubblica;
- `gh release create` **resta** com'è: con A le release pubbliche vanno bene.

### 9.9 Gli account che reggono tutto

Tutto si regge sull'account Google di Valerio (`admin()`) e su quello GitHub, dove lui è il revisore di
`pubblicazione`. Su tutti e due serve la **verifica in due passaggi**: Claude 3 l'ha chiesto a Valerio, che ha
risposto di averla ("sì, ce l'ho", 21/11). Claude 3 gli ha chiesto di avvisare se manca su uno dei due.

## 10. Scelte di Valerio del 21/11, in #14: cosa cambia

Dopo la prima versione, Valerio ha chiesto il controllo di ogni tentativo. Valgono queste regole, al posto delle parti
diverse di §4 e §9.

### 10.1 Ogni accesso con Google è un tentativo
- **Quando nasce un tentativo:** a ogni accesso con Google fatto dalla persona, che sia dal muro, dalle impostazioni o
  dopo una reinstallazione. Si aggiungono «Chiedi di nuovo» e il primo avvio con la 1.0.82 di chi usava già Eurodex.
  Gli accessi che l'app rifà da sola non contano, e nemmeno gli aggiornamenti, che non fanno uscire dall'account.
- **Cosa scrive l'app:** `accessi/{uid}/tentativi/{tid}`, con solo il telefono, il motivo (`accesso`, `ancora`,
  `primo`) e l'ora del server. Le richieste (`accessi/{uid}`) non le scrive più l'app: `allow create: if false`.
- **La funzione `tentativoDiAccesso`**, in una transazione:
  - **account nuovo:** crea la richiesta in attesa, con nome ed email presi da Authentication, e la notifica a
    Valerio parte da `avvisaValerio`;
  - **già deciso:** la decisione resta. Si aggiornano telefono, ora (`ultimoTentativo`) e numero di tentativi, e a
    Valerio arriva «Accesso approvato in automatico» oppure «Accesso rifiutato in automatico». Se è ancora in
    attesa, «Richiesta di accesso… ancora in attesa»;
  - **al massimo una notifica al minuto per account** (campo `avvisato`);
  - **l'account di Valerio** non entra mai nell'elenco.
- **Valerio può sempre cambiare idea**, per qualsiasi account: approvare chi aveva rifiutato e togliere chi aveva
  approvato.

### 10.2 Muro spento ed esclusi
- **Muro spento:** tutti dentro tranne gli account rifiutati o con l'accesso tolto. Nelle regole è
  `puoUsare = admin() || approvato() || (!accessoObbligatorio() && !escluso(uid))`, e nell'app compare la schermata
  del no anche col muro spento.
- **Muro acceso:** come prima, dentro solo gli approvati. In più, uscendo dall'account si torna subito alla schermata
  di accesso.

### 10.3 Revoca e notifiche
- **Revoca:** a chi perde l'accesso arriva una notifica (tipo `tolto`), poi le sessioni si chiudono. I token dei
  telefoni **restano**: chi ritenta e viene riapprovato riceve la notifica. Un account escluso non riceve altro,
  perché non può scrivere eventi. Questo sostituisce il «toglie i token» di §4.7.
- **Token:** i telefoni li registra ogni account, qualunque sia il suo stato, e li toglie uscendo. Per ora la
  sincronizzazione arriva sia dall'argomento sia dal token. La parte nativa ignora il doppione: tiene le ultime 8
  notizie.
- **Argomenti (§4.5), con una data** (revisione di Claude 2, corretta da lui il 24/11):
  - **`c_<uid>`:** la 1.0.83 se ne toglie e non ci si iscrive più. La sincronizzazione le arriva già al token, dal
    #14. Il server continua a mandarci per le app fino alla 1.0.81, e smette quando tutti i telefoni nell'elenco di
    Valerio sono alla 1.0.82 o oltre (lui lo vede dalla versione accanto a ogni telefono). Finché manda, chi conosce
    un uid riceve ancora quelle notifiche;
  - **`aggiornamenti` resta:** `scripts/invia-avviso.py` manda solo lì, sia la versione nuova (job `notifica`) sia i
    contenuti nuovi (`catalogo.yml`). Toglierlo lascerebbe i telefoni senza quegli avvisi. Si toglie quando c'è
    l'invio ai token anche per questi (§9.3: una funzione lo legge e manda, la chiave di GitHub no). Fino ad allora
    li può ricevere chiunque si iscriva all'argomento: dicono solo «c'è una versione nuova», e l'APK è pubblico.
- **Notifiche a Valerio:** al massimo una al minuto per account, anche per chi ritenta dopo un rifiuto. È la scelta
  di Valerio del 24/11, fatta sapendo che chi insiste può mandarne una al minuto. I tentativi restano contati
  nell'elenco.
- **Un tentativo ogni 20 secondi per account** (revisione di Claude 2; dopo la 1.0.82). È un limite di costo, non di
  sicurezza:
  - la regola `tentativoRecente` rifiuta un tentativo arrivato meno di 20 secondi dopo `ultimoTentativo`, il campo che
    scrive la funzione. Una richiesta senza quel campo conta come vecchia; un account senza richiesta non ha limite;
  - se il server rifiuta perché è troppo presto, l'app dice «Richiesta già inviata ✓ Valerio la vede», perché il
    tentativo di prima c'è, e non «sei connesso a internet?». Con la 1.0.82 resta la frase vecchia, solo per chi
    ripreme entro 20 secondi da un altro tentativo.

### 10.4 La sezione di Valerio e la schermata di accesso
- **Sezione di Valerio:** contiene tutti gli account che hanno fatto l'accesso, divisi in in attesa, approvati e non
  approvati. In grassetto c'è l'email, che viene da Google; il nome lo sceglie la persona, quindi sta sotto e senza `@`.
  Ogni decisione, anche «Approva», chiede conferma con l'email nel titolo (revisione di Claude 3). Per ognuno: ultimo accesso con telefono, numero di accessi e telefoni della sincronizzazione
  (`collezioni/*/dispositivi`, che Valerio legge e basta), con versione e ultima apertura.
- **Schermata di accesso:**
  - dopo l'accesso, direttamente «Richiesta inviata»;
  - per chi è rifiutato, «Accesso non approvato», e per chi non ha più l'accesso, «Accesso tolto»;
  - tutte e due hanno «Chiedi di nuovo», premibile una volta al minuto, e «Usa un altro account».
