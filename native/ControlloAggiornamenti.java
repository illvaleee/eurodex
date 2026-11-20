package it.collezione.euro;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Controllo in secondo piano (ogni 6 ore circa, solo con internet): se è uscita una versione nuova
 * dell'app (catalogo, foto o app aggiornati) manda UNA notifica per quella versione. Niente altro.
 */
public class ControlloAggiornamenti extends Worker {
    // I file piccoli che dicono "c'è qualcosa di nuovo" si leggono dalle API di GitHub, sempre aggiornate: la copia
    // "raw" passa da una cache che per diversi minuti dopo la pubblicazione può dare ancora la versione vecchia.
    static final String URL_VERSIONE = "https://api.github.com/repos/illvaleee/collezione-euro-download/contents/version.json?ref=main";
    static final String URL_DATI = "https://api.github.com/repos/illvaleee/collezione-euro-download/contents/dati/indice.json?ref=main";
    static final String RAW_VERSIONE = "https://raw.githubusercontent.com/illvaleee/collezione-euro-download/main/version.json";
    static final String RAW_DATI = "https://raw.githubusercontent.com/illvaleee/collezione-euro-download/main/dati/indice.json";
    // struttura dei dati che questa versione sa leggere: deve essere uguale a SCHEMA_DATI in src/catalogo/dati.ts
    static final int SCHEMA_DATI = 1;
    static final String CANALE = "novita"; // importanza alta: la notifica compare in alto sullo schermo (prima era "aggiornamenti", normale)
    static final String LAVORO = "controllo-aggiornamenti";

    public ControlloAggiornamenti(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    public static void pianifica(Context c) {
        Constraints vincoli = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(ControlloAggiornamenti.class, 6, TimeUnit.HOURS)
            .setConstraints(vincoli).setInitialDelay(30, TimeUnit.MINUTES).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(LAVORO, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    public static void annulla(Context c) { WorkManager.getInstance(c).cancelUniqueWork(LAVORO); }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        controllaDati(c);
        try {
            String tv = leggiFresco(URL_VERSIONE, RAW_VERSIONE);
            if (tv == null) return Result.success();
            JSONObject v = new JSONObject(tv);
            long nuova = v.optLong("code", 0);
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            long installata = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            SharedPreferences sp = c.getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE);
            if (nuova <= installata || nuova <= sp.getLong("notificata", 0) || !sp.getBoolean("attivi", true)) return Result.success();
            String note = v.optString("note", "");
            // si segna come avvisata solo se la notifica è comparsa davvero (se le notifiche sono spente,
            // appena l'utente le accende arriva al giro dopo)
            if (notifica(c, "Eurodex " + v.optString("version", "") + " è pronta",
                note.isEmpty() ? "Tocca per aggiornare: la collezione resta com'è." : note + " · Tocca per aggiornare."))
                sp.edit().putLong("notificata", nuova).apply();
        } catch (Exception e) {
            // nessuna rete o risposta strana: si riprova al prossimo giro, senza disturbare
        }
        return Result.success();
    }

    // prima le API (sempre aggiornate), se non rispondono (limite di richieste) la copia raw
    static String leggiFresco(String api, String raw) {
        try { String t = leggi(api); if (t != null) return t; } catch (Exception ignored) {}
        try { return leggi(raw); } catch (Exception e) { return null; }
    }

    static String leggi(String url) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url + (url.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis()).openConnection();
        con.setConnectTimeout(15000); con.setReadTimeout(15000);
        con.setUseCaches(false);
        if (url.contains("api.github.com")) con.setRequestProperty("Accept", "application/vnd.github.raw");
        if (con.getResponseCode() != 200) return null;
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) {
            String l; while ((l = r.readLine()) != null) sb.append(l);
        }
        return sb.toString();
    }

    // dati nuovi (catalogo, schede, foto) pubblicati da soli: si avvisa, e aprendo l'app si scaricano
    static void controllaDati(Context c) {
        try {
            String t = leggiFresco(URL_DATI, RAW_DATI);
            if (t == null) return;
            JSONObject ix = new JSONObject(t);
            avvisaDati(c, ix.optLong("rev", 0), ix.optInt("schema", 1), ix.optString("note", ""));
        } catch (Exception ignored) {}
    }

    // dati nuovi pubblicati: notifica subito e download in secondo piano (anche con l'app chiusa; senza rete
    // il download parte da solo appena la rete torna). Finito il download la notifica dice "già scaricato".
    static void avvisaDati(Context c, long rev, int schema, String note) {
        SharedPreferences sp = c.getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE);
        if (schema > SCHEMA_DATI) return;   // dati che questa versione non sa leggere: arriverà l'avviso della versione nuova
        if (rev <= sp.getLong("dati_rev", 0)) return;
        if (rev > sp.getLong("dati_notificati", 0) && sp.getBoolean("attivi", true)) {
            if (notifica(c, "Eurodex: catalogo aggiornato", (note == null || note.isEmpty() ? "Informazioni e foto nuove" : note) + " · Tocca per vederle", 8, false))
                sp.edit().putLong("dati_notificati", rev).apply();
        }
        ScaricaDati.accoda(c, rev);
    }

    static boolean attiva(Context c, int id) {
        try {
            if (Build.VERSION.SDK_INT < 23) return false;
            for (android.service.notification.StatusBarNotification n : c.getSystemService(NotificationManager.class).getActiveNotifications()) if (n.getId() == id) return true;
        } catch (Exception ignored) {}
        return false;
    }

    static boolean notifica(Context c, String titolo, String testo) { return notifica(c, titolo, testo, 7, false); }

    static boolean notifica(Context c, String titolo, String testo, int id) { return notifica(c, titolo, testo, id, false); }

    static boolean notifica(Context c, String titolo, String testo, int id, boolean silenziosa) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            NotificationChannel ch = new NotificationChannel(CANALE, "Novità e aggiornamenti", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Avvisi quando ci sono una versione nuova, monete, foto o informazioni nuove");
            nm.createNotificationChannel(ch);
            try { nm.deleteNotificationChannel("aggiornamenti"); } catch (Exception ignored) {}
            if (nm.getNotificationChannel(CANALE) != null && nm.getNotificationChannel(CANALE).getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        Intent apri = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        String azione = id == 7 ? "aggiorna" : id == 8 ? "dati" : id >= 1000 ? "sync" : "";
        if (apri != null) {
            apri.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            apri.putExtra("eurodex_azione", azione);
        }
        PendingIntent pi = PendingIntent.getActivity(c, id == 7 ? 7 : id == 8 ? 8 : 1000, apri, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CANALE)
            .setSmallIcon(R.drawable.ic_notifica)
            .setColor(0xFFD7AF50)
            .setContentTitle(titolo)
            .setContentText(testo)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(testo))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setOnlyAlertOnce(silenziosa);
        try { NotificationManagerCompat.from(c).notify(id, b.build()); return true; } catch (SecurityException e) { return false; }
    }
}
