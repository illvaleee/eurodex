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

import java.util.concurrent.TimeUnit;

/**
 * Controllo in secondo piano (ogni 6 ore circa, solo con internet): se è uscita una versione nuova
 * dell'app (catalogo, foto o app aggiornati) manda UNA notifica per quella versione. Niente altro.
 * Dalla 1.0.84 version.json e l'indice del catalogo si leggono da Storage con la sessione di questo telefono
 * (Archivio): senza sessione, o per un account che non può usare Eurodex, non c'è niente da controllare.
 */
public class ControlloAggiornamenti extends Worker {
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
            JSONObject v = new JSONObject(Archivio.testo("rilasci/version.json"));
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
            // senza sessione, nessuna rete o risposta strana: si riprova al prossimo giro, senza disturbare
        }
        return Result.success();
    }

    // dati nuovi (catalogo, schede, foto) pubblicati da soli: si avvisa, e aprendo l'app si scaricano
    static void controllaDati(Context c) {
        try {
            JSONObject ix = new JSONObject(Archivio.testo("dati/indice.json"));
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
