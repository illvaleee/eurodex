package it.collezione.euro;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GoogleAuthProvider;

/**
 * Funzioni native di Eurodex:
 *  - backup su un file scelto dall'utente (es. su Google Drive) con il selettore di Android:
 *    nessun account sviluppatore né login, il permesso resta salvato e l'app aggiorna il file da sola;
 *  - download e installazione delle nuove versioni dell'app.
 */
@CapacitorPlugin(name = "Nativo")
public class NativoPlugin extends Plugin {
    // stessa collezione su più dispositivi: l'app aperta riceve subito le modifiche arrivate con il push
    static volatile NativoPlugin istanza = null;
    static volatile boolean inPrimoPiano = false;

    @Override
    public void load() {
        istanza = this; inPrimoPiano = true;
        // Auth e Storage nativi: gli emulatori (solo con debug.eurodex.emulatori=1, da adb) vanno impostati prima di tutto.
        // La parte web gira su https://localhost e gli emulatori sono in http: solo in quel modo la WebView li può
        // chiamare (il traffico in chiaro è permesso solo verso 10.0.2.2, res/xml/rete.xml)
        Archivio.prepara();
        if (Archivio.emulatori()) try { getActivity().runOnUiThread(() -> { try { getBridge().getWebView().getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); } catch (Exception ignored) {} }); } catch (Exception ignored) {}
        // niente effetto "elastico" di Android a inizio/fine pagina: stirava tutta la pagina, comprese la barra delle
        // schede in basso e l'intestazione, che devono restare ferme
        try { getActivity().runOnUiThread(() -> { try { getBridge().getWebView().setOverScrollMode(android.view.View.OVER_SCROLL_NEVER); } catch (Exception ignored) {} }); } catch (Exception ignored) {}
    }

    @Override
    protected void handleOnResume() { inPrimoPiano = true; }

    @Override
    protected void handleOnPause() { inPrimoPiano = false; }

    // tocco su una notifica con l'app già aperta: si dice all'app cosa aprire (aggiornamento, storico...)
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String a = intent == null ? null : intent.getStringExtra("eurodex_azione");
        if (a == null || a.isEmpty()) return;
        intent.removeExtra("eurodex_azione");
        JSObject o = new JSObject(); o.put("azione", a);
        notifyListeners("azione", o);
    }

    // app aperta toccando una notifica (partendo da chiusa)
    @PluginMethod
    public void azioneIniziale(PluginCall call) {
        Intent i = getActivity() == null ? null : getActivity().getIntent();
        String a = i == null ? null : i.getStringExtra("eurodex_azione");
        if (i != null) i.removeExtra("eurodex_azione");
        JSObject o = new JSObject(); o.put("azione", a == null ? "" : a);
        call.resolve(o);
    }

    static void evento(java.util.Map<String, String> d) {
        NativoPlugin p = istanza;
        if (p == null) return;
        JSObject o = new JSObject();
        for (java.util.Map.Entry<String, String> e : d.entrySet()) o.put(e.getKey(), e.getValue());
        try { p.notifyListeners("sincronizza", o); } catch (Exception ignored) {}
    }

    // accesso su approvazione, con l'app aperta: per Valerio richieste e tentativi (con titolo e testo da mostrare),
    // per gli altri l'approvazione o l'accesso tolto (ad app chiusa la notifica la mostra Android da solo)
    static void accesso(java.util.Map<String, String> d) {
        NativoPlugin p = istanza;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("tipo", d.get("tipo"));
        for (String k : new String[] { "titolo", "testo" }) {
            String v = d.get(k);
            if (v != null) o.put(k, v.length() > 300 ? v.substring(0, 300) : v);
        }
        try { p.notifyListeners("accesso", o); } catch (Exception ignored) {}
    }

    // il token di questo telefono per le notifiche dirette: le richieste di accesso arrivano a Valerio, l'approvazione
    // a chi l'aspetta (docs/progetto-accesso-su-approvazione.md, §9.3)
    @PluginMethod
    public void tokenNotifiche(PluginCall call) {
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                JSObject o = new JSObject();
                if (t.isSuccessful() && t.getResult() != null) o.put("token", t.getResult());
                call.resolve(o);
            });
        } catch (Exception e) {
            // telefono senza servizi Google: niente notifiche dirette
            call.resolve(new JSObject());
        }
    }

    @PluginMethod
    public void infoDispositivo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("marca", Build.MANUFACTURER);
        r.put("modello", Build.MODEL);
        r.put("tablet", getContext().getResources().getConfiguration().smallestScreenWidthDp >= 600);
        // il nome che si vede nelle impostazioni di Android (Info sul telefono), es. "OPPO Reno11 F 5G"
        String nome = null;
        try { if (Build.VERSION.SDK_INT >= 25) nome = Settings.Global.getString(getContext().getContentResolver(), Settings.Global.DEVICE_NAME); } catch (Exception ignored) {}
        if (nome == null || nome.trim().isEmpty()) try { nome = Settings.Secure.getString(getContext().getContentResolver(), "bluetooth_name"); } catch (Exception ignored) {}
        r.put("nome", nome == null ? "" : nome.trim());
        call.resolve(r);
    }

    /**
     * Le prove automatiche (telefono simulato della CI, o un telefono collegato con adb) lo dicono con due proprietà
     * di sistema, che scrive solo la shell di adb: debug.eurodex.prove=1 non mostra la schermata del muro (indirizzi
     * e regole restano quelli veri), debug.eurodex.muro=acceso fa valere il muro acceso solo su questo telefono,
     * debug.eurodex.emulatori=1 manda tutto agli emulatori di Firebase del telefono simulato (Archivio).
     */
    @PluginMethod
    public void modoProve(PluginCall call) {
        JSObject r = new JSObject();
        r.put("prove", "1".equals(proprieta("debug.eurodex.prove")));
        r.put("muro", proprieta("debug.eurodex.muro"));
        r.put("emulatori", Archivio.emulatori());
        call.resolve(r);
    }

    static String proprieta(String nome) {
        try {
            Object v = Class.forName("android.os.SystemProperties").getMethod("get", String.class).invoke(null, nome);
            return v instanceof String ? ((String) v).trim() : "";
        } catch (Throwable e) {
            return "";
        }
    }

    @PluginMethod
    public void impostaSync(PluginCall call) {
        String cid = call.getString("cid", ""), did = call.getString("did", ""), nome = call.getString("nome", "");
        SharedPreferences sp = getContext().getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE);
        String vecchio = sp.getString("sync_cid", "");
        sp.edit().putString("sync_cid", cid).putString("sync_did", did).putString("sync_nome", nome).apply();
        try {
            com.google.firebase.messaging.FirebaseMessaging fm = com.google.firebase.messaging.FirebaseMessaging.getInstance();
            // dalla 1.0.83 la sincronizzazione arriva solo al token di questo telefono (accessi/{uid}/dispositivi,
            // §10.3): l'argomento c_<uid> lo riceverebbe chiunque conosca l'uid. Ci si toglie da quello di prima e da
            // quello di adesso, e non ci si iscrive più. «aggiornamenti» invece resta (versione e catalogo nuovi)
            if (!vecchio.isEmpty()) fm.unsubscribeFromTopic("c_" + vecchio);
            if (!cid.isEmpty() && !cid.equals(vecchio)) fm.unsubscribeFromTopic("c_" + cid);
        } catch (Exception ignored) {}
        call.resolve();
    }


    // ---------- accesso con Google (stessa collezione su tutti i dispositivi con lo stesso account) ----------
    // Usa il Credential Manager di Android: compare la finestrella con gli account Google del dispositivo.
    // All'app torna solo il "gettone" di Google, che Firebase verifica: nessuna password passa dall'app.
    @PluginMethod
    public void accediGoogle(PluginCall call) {
        // «Un ultimo passo»: l'account deve essere quello della parte web. Si controlla prima di aprire la sessione
        // nativa, così un altro account non entra nemmeno, e in Authentication non nasce un utente vuoto (revisione di
        // Claude 2 su #28). Il controllo dell'uid nella parte web resta come secondo lucchetto
        String atteso = call.getString("email", "");
        if (Archivio.emulatori()) {
            // prove con gli emulatori: un gettone Google finto, che vale solo per l'emulatore di Auth (sempre lo stesso
            // utente di prova). Niente Credential Manager: sul telefono simulato non c'è un account Google
            if (altroAccount(atteso, "prova-apk@example.com")) { call.reject("altro account", "ALTRO_ACCOUNT"); return; }
            JSObject o = new JSObject();
            o.put("idToken", GETTONE_PROVA);
            o.put("email", "prova-apk@example.com");
            o.put("nome", "Prova APK");
            accediAncheQui(GETTONE_PROVA, o, call);
            return;
        }
        int idRes = getContext().getResources().getIdentifier("default_web_client_id", "string", getContext().getPackageName());
        if (idRes == 0) { call.reject("L'accesso con Google non è ancora attivo"); return; }
        String web = getContext().getString(idRes);
        try {
            androidx.credentials.CredentialManager cm = androidx.credentials.CredentialManager.create(getContext());
            // silenzioso: senza finestre, con l'account che ha già dato il permesso all'app (serve a riprendere
            // l'accesso dopo un aggiornamento); altrimenti la finestra di Google per scegliere l'account
            androidx.credentials.CredentialOption opt = call.getBoolean("silenzioso", false)
                ? new com.google.android.libraries.identity.googleid.GetGoogleIdOption.Builder()
                    .setServerClientId(web).setFilterByAuthorizedAccounts(true).setAutoSelectEnabled(true).build()
                : new com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption.Builder(web).build();
            androidx.credentials.GetCredentialRequest req = new androidx.credentials.GetCredentialRequest.Builder().addCredentialOption(opt).build();
            // la risposta arriva sul thread principale (prima si creava un thread nuovo a ogni accesso, mai chiuso)
            cm.getCredentialAsync(getActivity(), req, new android.os.CancellationSignal(), androidx.core.content.ContextCompat.getMainExecutor(getContext()),
                new androidx.credentials.CredentialManagerCallback<androidx.credentials.GetCredentialResponse, androidx.credentials.exceptions.GetCredentialException>() {
                    @Override
                    public void onResult(androidx.credentials.GetCredentialResponse r) {
                        androidx.credentials.Credential c = r.getCredential();
                        try {
                            if (c instanceof androidx.credentials.CustomCredential
                                && com.google.android.libraries.identity.googleid.GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                                com.google.android.libraries.identity.googleid.GoogleIdTokenCredential g =
                                    com.google.android.libraries.identity.googleid.GoogleIdTokenCredential.createFrom(c.getData());
                                if (altroAccount(atteso, g.getId())) { call.reject("altro account", "ALTRO_ACCOUNT"); return; }
                                JSObject o = new JSObject();
                                o.put("idToken", g.getIdToken());
                                o.put("email", g.getId());
                                o.put("nome", g.getDisplayName() == null ? "" : g.getDisplayName());
                                accediAncheQui(g.getIdToken(), o, call);
                                return;
                            }
                        } catch (Exception ignored) {}
                        call.reject("Risposta di Google non valida");
                    }

                    @Override
                    public void onError(androidx.credentials.exceptions.GetCredentialException e) {
                        if (e instanceof androidx.credentials.exceptions.GetCredentialCancellationException) call.reject("annullato", "ANNULLATO");
                        else if (e instanceof androidx.credentials.exceptions.NoCredentialException) call.reject("Su questo dispositivo non c'è nessun account Google", "NESSUN_ACCOUNT");
                        else call.reject(String.valueOf(e.getMessage()), e.getClass().getSimpleName());
                    }
                });
        } catch (Exception e) {
            call.reject("Accesso con Google non disponibile: " + e.getMessage());
        }
    }

    /** Vero se è stato chiesto un account preciso (l'email della parte web) e Google ne ha dato un altro. */
    static boolean altroAccount(String atteso, String dato) {
        if (atteso == null || atteso.trim().isEmpty()) return false;
        return dato == null || !atteso.trim().equalsIgnoreCase(dato.trim());
    }

    // lo stesso utente di prova che la CI prepara negli emulatori (prove/emulatori-apk.py): uid ProvaApkApprovato0000000001
    static final String GETTONE_PROVA = "{\"sub\":\"prova-apk-1\",\"email\":\"prova-apk@example.com\",\"email_verified\":true,\"name\":\"Prova APK\"}";

    /**
     * Lo stesso gettone Google apre anche la sessione di Firebase della parte nativa, quella che usano i lavori in
     * background per scaricare versioni e catalogo da Storage (§9.4). Se non riesce (per esempio senza rete) l'accesso
     * della parte web va avanti lo stesso: la sessione nativa si riprende dopo (sessioneNativa).
     */
    private void accediAncheQui(String gettone, JSObject o, PluginCall call) {
        try {
            FirebaseAuth.getInstance().signInWithCredential(GoogleAuthProvider.getCredential(gettone, null)).addOnCompleteListener(t -> {
                FirebaseUser u = t.isSuccessful() && t.getResult() != null ? t.getResult().getUser() : null;
                o.put("uidNativo", u == null ? "" : u.getUid());
                call.resolve(o);
            });
        } catch (Exception e) {
            o.put("uidNativo", "");
            call.resolve(o);
        }
    }

    /**
     * La sessione nativa si tiene solo se è dello stesso account della parte web (uid): se no si chiude. Restituisce
     * l'uid della sessione nativa, vuoto se non c'è.
     */
    @PluginMethod
    public void sessioneNativa(PluginCall call) {
        String uid = call.getString("uid", "");
        FirebaseUser u = Archivio.utente();
        if (u != null && uid != null && !uid.isEmpty() && !uid.equals(u.getUid())) {
            FirebaseAuth.getInstance().signOut();
            u = null;
        }
        JSObject r = new JSObject();
        r.put("uid", u == null ? "" : u.getUid());
        call.resolve(r);
    }

    /** «Esci»: la sessione nativa si chiude insieme a quella della parte web. */
    @PluginMethod
    public void esciNativo(PluginCall call) {
        Archivio.prepara();
        try { FirebaseAuth.getInstance().signOut(); } catch (Exception ignored) {}
        call.resolve();
    }

    /** version.json o l'indice del catalogo, da Storage, come testo. */
    @PluginMethod
    public void leggiArchivio(PluginCall call) {
        String p = call.getString("percorso", "");
        if (!"rilasci/version.json".equals(p) && !"dati/indice.json".equals(p)) { call.reject("percorso non previsto"); return; }
        if (Archivio.utente() == null) { call.reject("senza sessione", "SENZA_SESSIONE"); return; }
        Archivio.riferimento(p).getBytes(Archivio.MAX_TESTO).addOnCompleteListener(t -> {
            if (t.isSuccessful() && t.getResult() != null) {
                JSObject r = new JSObject();
                r.put("testo", new String(t.getResult(), StandardCharsets.UTF_8));
                call.resolve(r);
            } else {
                Exception e = t.getException();
                call.reject(e == null ? "lettura non riuscita" : String.valueOf(e.getMessage()), Archivio.codice(e));
            }
        });
    }

    // dove la parte web fa scaricare: catalogo e schede col numero dei dati, e le foto (gli stessi file di ScaricaDati)
    static final Pattern FILE_LOCALE = Pattern.compile("dati/(catalogo|schede)-[0-9]{1,14}\\.json|dati/img/[0-9a-f]{1,64}\\.webp");

    /** Un file del catalogo da Storage direttamente nei file dell'app (dati/), intero o niente. */
    @PluginMethod
    public void scaricaArchivio(PluginCall call) {
        String p = call.getString("percorso", ""), f = call.getString("file", "");
        if (p == null || !p.startsWith("dati/") || !Archivio.PERCORSO.matcher(p).matches() || f == null || !FILE_LOCALE.matcher(f).matches()
            || !Archivio.stessoTipo(p, f)) {
            call.reject("percorso non previsto");
            return;
        }
        if (Archivio.utente() == null) { call.reject("senza sessione", "SENZA_SESSIONE"); return; }
        File dest = new File(getContext().getFilesDir(), f);
        File cartella = dest.getParentFile();
        if (cartella != null) cartella.mkdirs();
        File tmp = new File(dest.getPath() + ".part");
        Archivio.riferimento(p).getFile(tmp).addOnCompleteListener(t -> {
            if (t.isSuccessful() && tmp.renameTo(dest)) { call.resolve(); return; }
            tmp.delete();
            Exception e = t.getException();
            call.reject(e == null ? "download non riuscito" : String.valueOf(e.getMessage()), Archivio.codice(e));
        });
    }

    /** Errori e avvisi della parte web finiscono nel registro di Android (etichetta "Eurodex"). */
    @PluginMethod
    public void registra(PluginCall call) {
        String testo = call.getString("testo", "");
        if ("errore".equals(call.getString("livello"))) android.util.Log.e("Eurodex", testo);
        else android.util.Log.w("Eurodex", testo);
        call.resolve();
    }

    private static final String PREFS = "collezione_nativo";
    private static final String KEY_URI = "backup_uri";
    // file aperto per un ripristino: resta separato dal file del backup finché il ripristino non è confermato
    private static final String KEY_APERTO = "aperto_uri";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private Uri savedUri() {
        String s = prefs().getString(KEY_URI, null);
        return s == null ? null : Uri.parse(s);
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return null;
    }

    private String provider(Uri uri) {
        String a = uri.getAuthority();
        if (a == null) return "";
        if (a.contains("com.google.android.apps.docs")) return "Google Drive";
        if (a.contains("providers.downloads")) return "cartella Download del telefono";
        if (a.contains("externalstorage") || a.contains("providers.media")) return "memoria del telefono";
        // altre app (OneDrive, Dropbox, ...): il nome dell'app, mai il codice tecnico
        try {
            ProviderInfo pi = getContext().getPackageManager().resolveContentProvider(a, 0);
            if (pi != null && pi.applicationInfo != null) return pi.applicationInfo.loadLabel(getContext().getPackageManager()).toString();
        } catch (Exception ignored) {}
        return "";
    }

    // ---------- backup su file scelto dall'utente ----------

    @PluginMethod
    public void scegliFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, call.getString("nome", "eurodex-backup.json"));
        startActivityForResult(call, i, "fileScelto");
    }

    @PluginMethod
    public void apriFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        startActivityForResult(call, i, "fileAperto");
    }

    // file scelto per un ripristino: NON diventa il file del backup (prima lo diventava subito, anche annullando il
    // ripristino, e il backup automatico poi lo sovrascriveva)
    @ActivityCallback
    private void fileAperto(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("annullato");
            return;
        }
        Uri uri = result.getData().getData();
        rilasciaApertoPrecedente();   // Android concede un numero limitato di permessi persistenti: niente avanzi
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        prefs().edit().putString(KEY_APERTO, uri.toString()).apply();
        JSObject r = new JSObject();
        r.put("nome", displayName(uri));
        r.put("dove", provider(uri));
        call.resolve(r);
    }

    // il file aperto per un ripristino e non collegato al backup: si toglie il suo permesso (se non è il file del backup)
    private void rilasciaApertoPrecedente() {
        String s = prefs().getString(KEY_APERTO, null);
        if (s == null) return;
        Uri prima = savedUri();
        if (prima == null || !prima.toString().equals(s)) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(s),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        prefs().edit().remove(KEY_APERTO).apply();
    }

    @PluginMethod
    public void rilasciaAperto(PluginCall call) {
        rilasciaApertoPrecedente();
        call.resolve();
    }

    // ripristino confermato: il file da cui si è ripristinato diventa il file del backup (come dopo una reinstallazione)
    @PluginMethod
    public void collegaAperto(PluginCall call) {
        String s = prefs().getString(KEY_APERTO, null);
        if (s == null) { call.reject("nessun file aperto"); return; }
        Uri uri = Uri.parse(s);
        Uri prima = savedUri();
        if (prima != null && !prima.equals(uri)) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(prima,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        prefs().edit().putString(KEY_URI, s).remove(KEY_APERTO).apply();
        JSObject r = new JSObject();
        r.put("nome", displayName(uri));
        r.put("dove", provider(uri));
        call.resolve(r);
    }

    @ActivityCallback
    private void fileScelto(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("annullato");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        prefs().edit().putString(KEY_URI, uri.toString()).apply();
        JSObject r = new JSObject();
        r.put("nome", displayName(uri));
        r.put("dove", provider(uri));
        call.resolve(r);
    }

    @PluginMethod
    public void statoFile(PluginCall call) {
        Uri uri = savedUri();
        JSObject r = new JSObject();
        r.put("collegato", uri != null);
        if (uri != null) {
            r.put("nome", displayName(uri));
            r.put("dove", provider(uri));
        }
        call.resolve(r);
    }

    @PluginMethod
    public void scollega(PluginCall call) {
        Uri uri = savedUri();
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        prefs().edit().remove(KEY_URI).apply();
        call.resolve();
    }

    @PluginMethod
    public void scrivi(PluginCall call) {
        final String testo = call.getString("testo", "");
        final Uri uri = savedUri();
        if (uri == null) { call.reject("nessun file collegato"); return; }
        new Thread(() -> {
            ContentResolver cr = getContext().getContentResolver();
            byte[] data = testo.getBytes(StandardCharsets.UTF_8);
            Exception last = null;
            for (String mode : new String[]{"wt", "rwt", "w"}) {
                try {
                    if ("w".equals(mode)) {
                        // con "w" alcuni fornitori non accorciano il file: se il nuovo è più corto, in fondo resterebbe
                        // la coda del vecchio. Si accorcia sullo STESSO descrittore della scrittura, prima di chiuderlo
                        // (riaprirlo potrebbe dare il contenuto vecchio). Se non si può (es. una pipe), resta solo una
                        // riga nel registro: la lettura regge comunque
                        android.os.ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "w");
                        if (pfd == null) throw new Exception("file non disponibile");
                        try {
                            FileOutputStream os = new FileOutputStream(pfd.getFileDescriptor());
                            try {
                                os.write(data);
                                os.flush();
                                try { android.system.Os.ftruncate(pfd.getFileDescriptor(), data.length); }
                                catch (Exception e) { android.util.Log.w("Eurodex", "backup: file non accorciato: " + e.getMessage()); }
                            } finally { os.close(); }   // lo stream non possiede il descrittore: chiuderlo è innocuo
                        } finally { pfd.close(); }   // come sopra: errori alla chiusura = salvataggio non riuscito
                    } else {
                        OutputStream os = cr.openOutputStream(uri, mode);
                        if (os == null) throw new Exception("file non disponibile");
                        // si chiude il file PRIMA di dire che è fatto: con Google Drive il salvataggio vero avviene
                        // alla chiusura, ed è lì che può non riuscire
                        try { os.write(data); os.flush(); } finally { os.close(); }
                    }
                } catch (Exception e) { last = e; continue; }
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("byte", data.length);
                call.resolve(r);
                return;
            }
            call.reject("scrittura non riuscita: " + (last != null ? last.getMessage() : ""));
        }).start();
    }

    @PluginMethod
    public void leggi(PluginCall call) {
        // "aperto": il file appena scelto per un ripristino; altrimenti il file del backup collegato
        String aperto = Boolean.TRUE.equals(call.getBoolean("aperto", false)) ? prefs().getString(KEY_APERTO, null) : null;
        final Uri uri = aperto != null ? Uri.parse(aperto) : savedUri();
        if (uri == null) { call.reject("nessun file collegato"); return; }
        new Thread(() -> {
            try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
                if (is == null) throw new Exception("file non disponibile");
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                    char[] buf = new char[8192];
                    int n;
                    while ((n = br.read(buf)) > 0) sb.append(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("testo", sb.toString());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("lettura non riuscita: " + e.getMessage());
            }
        }).start();
    }

    // ---------- aggiornamenti dell'app ----------

    @PluginMethod
    public void puoInstallare(PluginCall call) {
        JSObject r = new JSObject();
        r.put("permesso", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    @PluginMethod
    public void permessoInstallazione(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    /**
     * L'APK della versione nuova, da Storage (rilasci/), con la sessione di questo telefono: lo scarica solo chi può
     * usare Eurodex (passo 5). Il nome arriva da version.json e si controlla prima di usarlo come percorso; la
     * dimensione deve tornare con quella di version.json, così ad Android non arriva mai un APK a metà.
     */
    @PluginMethod
    public void scaricaEInstalla(PluginCall call) {
        final String nome = call.getString("apk", "");
        final long atteso = call.getData().optLong("size", 0L);
        if (nome == null || !nome.matches("[A-Za-z0-9._-]{1,80}\\.apk")) { call.reject("Aggiornamento non valido: manca il nome dell'APK"); return; }
        if (Archivio.utente() == null) { call.reject("Per scaricare gli aggiornamenti serve l'accesso con Google", "SENZA_SESSIONE"); return; }
        final File dir = new File(getContext().getCacheDir(), "aggiornamenti");
        dir.mkdirs();
        final File apk = new File(dir, "CollezioneEuro.apk");
        apk.delete();
        final int[] ultimo = { -1 };
        Archivio.riferimento("rilasci/" + nome).getFile(apk)
            .addOnProgressListener(st -> {
                long tot = st.getTotalByteCount();
                if (tot <= 0) return;
                int pct = (int) (st.getBytesTransferred() * 100 / tot);
                if (pct == ultimo[0]) return;
                ultimo[0] = pct;
                JSObject ev = new JSObject();
                ev.put("percento", pct);
                notifyListeners("download", ev);
            })
            .addOnCompleteListener(t -> {
                if (!t.isSuccessful() || t.getResult() == null) {
                    apk.delete();
                    Exception e = t.getException();
                    call.reject("download non riuscito: " + (e == null ? "" : e.getMessage()), Archivio.codice(e));
                    return;
                }
                long fatto = apk.length(), tot = t.getResult().getTotalByteCount();
                // file arrivato a metà (connessione caduta): non si passa ad Android un APK rotto
                if ((tot > 0 && fatto != tot) || (atteso > 0 && fatto != atteso)) {
                    apk.delete();
                    call.reject("Download incompleto: controlla la connessione e riprova");
                    return;
                }
                try {
                    Uri content = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(content, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(i);
                    JSObject r = new JSObject();
                    r.put("ok", true);
                    call.resolve(r);
                } catch (Exception e) {
                    call.reject("installazione non avviata: " + e.getMessage());
                }
            });
    }

    // colore delle barre di sistema (stato e navigazione) e colore delle icone (chiare su fondo scuro)
    @PluginMethod
    public void barre(PluginCall call) {
        final String colore = call.getString("colore", "#F5F6F8");
        final boolean chiare = Boolean.TRUE.equals(call.getBoolean("iconeChiare", false));
        getActivity().runOnUiThread(() -> {
            try {
                android.view.Window w = getActivity().getWindow();
                int c = android.graphics.Color.parseColor(colore);
                w.setStatusBarColor(c);
                w.setNavigationBarColor(c);
                androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(!chiare);
                ic.setAppearanceLightNavigationBars(!chiare);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // avvisi degli aggiornamenti: controllo in secondo piano attivato o spento
    @PluginMethod
    public void pianificaControlli(PluginCall call) {
        try {
            if (Boolean.FALSE.equals(call.getBoolean("attivi", true))) ControlloAggiornamenti.annulla(getContext());
            else ControlloAggiornamenti.pianifica(getContext());
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    // permesso di mostrare notifiche (Android 13 e successivi lo chiedono con una finestra)
    @PluginMethod
    public void permessoNotifiche(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(getContext(), "android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            androidx.core.app.ActivityCompat.requestPermissions(getActivity(), new String[]{"android.permission.POST_NOTIFICATIONS"}, 4711);
        }
        call.resolve();
    }

    @PluginMethod
    public void statoNotifiche(PluginCall call) {
        JSObject r = new JSObject();
        r.put("attive", androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void datiApplicati(PluginCall call) {
        // l'app dice quali dati sta usando: il controllo in secondo piano e le notifiche non avvisano di dati già presenti
        long rev = call.getData().optLong("rev", 0L);
        android.content.SharedPreferences sp = getContext().getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE);
        if (rev > sp.getLong("dati_rev", 0)) sp.edit().putLong("dati_rev", rev).apply();
        call.resolve();
    }

    /**
     * L'interruttore «Avvisami quando c'è qualcosa di nuovo». Dalla 1.0.84 gli avvisi di versione e catalogo arrivano
     * al token di questo telefono, e solo a chi può usare Eurodex (funzione avvisaNovita): l'argomento pubblico
     * «aggiornamenti» non serve più e ci si toglie sempre. L'interruttore decide se le notifiche si mostrano.
     */
    @PluginMethod
    public void iscriviAvvisi(PluginCall call) {
        final boolean on = !Boolean.FALSE.equals(call.getBoolean("attivi", true));
        getContext().getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE).edit().putBoolean("attivi", on).apply();
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().unsubscribeFromTopic("aggiornamenti").addOnCompleteListener(r -> {
                JSObject o = new JSObject();
                o.put("ok", r.isSuccessful());
                if (!r.isSuccessful() && r.getException() != null) o.put("errore", r.getException().getMessage());
                call.resolve(o);
            });
        } catch (Exception e) {
            // telefono senza servizi Google: restano gli avvisi con il controllo ogni 6 ore
            JSObject o = new JSObject(); o.put("ok", false); o.put("errore", e.getMessage()); call.resolve(o);
        }
    }
}
