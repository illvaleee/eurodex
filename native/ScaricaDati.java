package it.collezione.euro;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/**
 * Dati nuovi (catalogo, schede, foto) scaricati in secondo piano, anche con l'app chiusa, appena arriva
 * la notifica push che sono stati pubblicati. Li salva dove li legge l'app (cartella dati/ nei file dell'app,
 * stesso formato che usa www/app.js): alla prossima apertura l'app li usa subito, senza scaricare niente.
 * Scarica solo quello che manca: le foto già dentro l'APK o già scaricate non si riscaricano.
 * Se non c'è rete il lavoro aspetta da solo che torni.
 */
public class ScaricaDati extends Worker {
    static final String BASE = "https://raw.githubusercontent.com/illvaleee/collezione-euro-download/main/dati/";

    public ScaricaDati(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void accoda(Context c) { accoda(c, 0); }

    // atteso: il numero dei dati annunciati dalla notifica (se il server risponde ancora con i dati di prima, si riprova)
    static void accoda(Context c, long atteso) {
        Constraints k = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest w = new OneTimeWorkRequest.Builder(ScaricaDati.class).setConstraints(k)
            .setInputData(new androidx.work.Data.Builder().putLong("atteso", atteso).build())
            .setBackoffCriteria(androidx.work.BackoffPolicy.LINEAR, 30, java.util.concurrent.TimeUnit.SECONDS).build();
        WorkManager.getInstance(c).enqueueUniqueWork("scaricadati", ExistingWorkPolicy.REPLACE, w);
    }

    static String testo(File f) throws Exception {
        try (InputStream is = new FileInputStream(f)) { return leggiTutto(is); }
    }

    static String leggiTutto(InputStream is) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n;
        while ((n = is.read(buf)) > 0) b.write(buf, 0, n);
        return new String(b.toByteArray(), StandardCharsets.UTF_8);
    }

    static void scarica(String url, File dest) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(20000); con.setReadTimeout(30000);
        if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode() + " " + url);
        File p = dest.getParentFile(); if (p != null) p.mkdirs();
        File tmp = new File(dest.getPath() + ".part");
        try (InputStream is = con.getInputStream(); OutputStream os = new FileOutputStream(tmp)) {
            byte[] buf = new byte[32768]; int n; while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
        }
        if (!tmp.renameTo(dest)) throw new Exception("rinomina non riuscita");
    }

    static void scrivi(File f, String s) throws Exception {
        File tmp = new File(f.getPath() + ".part");
        try (OutputStream os = new FileOutputStream(tmp)) { os.write(s.getBytes(StandardCharsets.UTF_8)); }
        // su Android renameTo sostituisce il file in un colpo solo: niente momento senza il file
        if (!tmp.renameTo(f)) throw new Exception("rinomina non riuscita");
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        SharedPreferences sp = c.getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE);
        try {
            String t = ControlloAggiornamenti.leggiFresco(ControlloAggiornamenti.URL_DATI, ControlloAggiornamenti.RAW_DATI);
            if (t == null) return Result.retry();
            JSONObject ix = new JSONObject(t);
            long rev = ix.optLong("rev", 0);
            long atteso = getInputData().getLong("atteso", 0);
            if (atteso > rev && getRunAttemptCount() < 10) return Result.retry();   // il server non ha ancora i dati annunciati
            int schema = ix.optInt("schema", 1);
            if (schema > ControlloAggiornamenti.SCHEMA_DATI) return Result.success();   // serve la versione nuova dell'app

            // dati dentro l'APK
            long revApk = 0; Set<String> nellApk = new HashSet<>();
            try (InputStream is = c.getAssets().open("public/data/indice.json")) {
                JSONObject a = new JSONObject(leggiTutto(is)); revApk = a.optLong("rev", 0);
                JSONArray im = a.optJSONArray("img"); if (im != null) for (int i = 0; i < im.length(); i++) nellApk.add(im.getString(i));
            } catch (Exception ignored) {}
            // dati già scaricati
            File dir = new File(c.getFilesDir(), "dati");
            long revLocale = 0; Set<String> locali = new HashSet<>();
            File st = new File(dir, "stato.json");
            if (st.exists()) {
                try {
                    JSONObject s = new JSONObject(testo(st)); revLocale = s.optLong("rev", 0);
                    JSONArray im = s.optJSONArray("img"); if (im != null) for (int i = 0; i < im.length(); i++) locali.add(im.getString(i));
                } catch (Exception ignored) {}
            }
            if (rev <= Math.max(Math.max(revApk, revLocale), sp.getLong("dati_rev", 0))) return Result.success();

            JSONObject file = ix.optJSONObject("file");
            String fc = file != null ? file.optString("catalogo", "catalog.json") : "catalog.json";
            String fs = file != null ? file.optString("schede", "details.json") : "details.json";
            // file con il numero dei dati (stesso schema della parte web, src/catalogo/dati.ts): quelli in uso non si
            // toccano mai, e per ultimo lo stato che indica i nuovi. Se il processo muore a metà restano i dati di prima
            String nomeCat = "catalogo-" + rev + ".json", nomeSch = "schede-" + rev + ".json";
            File cat = new File(dir, nomeCat), det = new File(dir, nomeSch);
            scarica(BASE + fc + "?r=" + rev, cat);
            scarica(BASE + fs + "?r=" + rev, det);
            new JSONObject(testo(cat));   // devono essere JSON validi
            new JSONObject(testo(det));

            JSONArray img = ix.optJSONArray("img");
            JSONArray presenti = new JSONArray(); int nuove = 0, fallite = 0;
            if (img != null) for (int i = 0; i < img.length(); i++) {
                String x = img.getString(i);
                if (nellApk.contains(x)) continue;
                File f = new File(dir, x);
                if (locali.contains(x) && f.exists()) { presenti.put(x); continue; }
                try { scarica(BASE + x, f); presenti.put(x); nuove++; } catch (Exception e) { fallite++; }
            }
            // per ultimo lo stato, che è l'unico interruttore: indica i file nuovi (i vecchi li pulisce la parte web)
            JSONObject stato = new JSONObject();
            stato.put("rev", rev); stato.put("schema", schema); stato.put("img", presenti); stato.put("data", ix.optString("data", ""));
            stato.put("cat", nomeCat); stato.put("sch", nomeSch);
            stato.put("da", "notifica"); stato.put("note", ix.optString("note", ""));
            scrivi(st, stato.toString());

            // la notifica (arrivata subito con il push) si aggiorna: i dati sono già nel telefono.
            // Se l'utente l'ha già tolta non la si rimette
            String note = ix.optString("note", "");
            String txt = (note.isEmpty() ? "Informazioni e foto nuove" : note) + " · Già scaricato, tocca per vederlo";
            if (sp.getBoolean("attivi", true)) {
                if (rev > sp.getLong("dati_notificati", 0)) {
                    if (ControlloAggiornamenti.notifica(c, "Eurodex: catalogo aggiornato", txt, 8, false)) sp.edit().putLong("dati_notificati", rev).apply();
                } else if (ControlloAggiornamenti.attiva(c, 8)) ControlloAggiornamenti.notifica(c, "Eurodex: catalogo aggiornato", txt, 8, true);
            }
            return Result.success();
        } catch (Exception e) {
            return getRunAttemptCount() < 5 ? Result.retry() : Result.failure();
        }
    }
}
