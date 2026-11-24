package it.collezione.euro;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Notifica immediata (push, come WhatsApp): appena GitHub pubblica una versione nuova manda un messaggio
 * attraverso Google (Firebase) e qui si mostra la notifica, anche con l'app chiusa.
 * Una sola notifica per versione: lo stesso registro lo usa il controllo ogni 6 ore, così non arrivano doppioni.
 */
public class AvvisiPush extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        // stessa collezione su un altro dispositivo: cosa è cambiato, da quale dispositivo e quando
        if ("sync".equals(d.get("tipo"))) {
            try {
                Context c = getApplicationContext();
                SharedPreferences sp = c.getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE);
                String cid = sp.getString("sync_cid", ""), mio = sp.getString("sync_did", "");
                if (cid.isEmpty() || !cid.equals(d.get("cid")) || mio.equals(d.get("did"))) return;
                // la stessa notizia può arrivare due volte, dall'argomento (per le versioni vecchie) e dal token di
                // questo telefono (§4.5): la seconda si ignora
                String chiave = d.get("did") + "|" + d.get("ts") + "|" + d.get("testo");
                if (chiave.equals(sp.getString("sync_ultimo", ""))) return;
                sp.edit().putString("sync_ultimo", chiave).apply();
                NativoPlugin.evento(d);   // se l'app è aperta si aggiorna subito
                if (!sp.getBoolean("attivi", true)) return;   // notifiche spente nelle impostazioni dell'app
                // app aperta sullo schermo: l'avviso lo mostra già l'app, la notifica sarebbe un doppione
                if (NativoPlugin.inPrimoPiano && NativoPlugin.istanza != null) return;
                long ts = d.containsKey("ts") ? Long.parseLong(d.get("ts")) : System.currentTimeMillis();
                java.util.Calendar a = java.util.Calendar.getInstance(), b = java.util.Calendar.getInstance(); b.setTimeInMillis(ts);
                boolean oggi = a.get(java.util.Calendar.YEAR) == b.get(java.util.Calendar.YEAR) && a.get(java.util.Calendar.DAY_OF_YEAR) == b.get(java.util.Calendar.DAY_OF_YEAR);
                String quando = new java.text.SimpleDateFormat(oggi ? "'oggi alle' HH:mm" : "d MMM 'alle' HH:mm", java.util.Locale.ITALIAN).format(new java.util.Date(ts));
                notificaSync(c, sp, d.get("nome"), quando + " · " + d.get("testo"));
            } catch (Exception ignored) {}
            return;
        }
        // accesso su approvazione (per Valerio richieste e tentativi; per gli altri l'approvazione o l'accesso tolto):
        // con l'app aperta lo dice l'app; ad app chiusa questi messaggi non passano da qui, la notifica (titolo e
        // testo) la mostra Android
        String tipo = d.get("tipo");
        if ("accesso".equals(tipo) || "approvato".equals(tipo) || "tolto".equals(tipo)) {
            NativoPlugin.accesso(d);
            return;
        }
        // dati nuovi (catalogo, schede, foto): non serve installare niente, l'app li scarica quando si apre
        if ("dati".equals(d.get("tipo"))) {
            try {
                ControlloAggiornamenti.avvisaDati(getApplicationContext(), Long.parseLong(d.get("rev")),
                    d.containsKey("schema") ? Integer.parseInt(d.get("schema")) : 1, d.get("note"));
            } catch (Exception ignored) {}
            return;
        }
        try {
            long nuova = Long.parseLong(d.containsKey("code") ? d.get("code") : "0");
            Context c = getApplicationContext();
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            long installata = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            SharedPreferences sp = c.getSharedPreferences("aggiornamenti", Context.MODE_PRIVATE);
            if (nuova <= installata || nuova <= sp.getLong("notificata", 0)) return;
            if (!sp.getBoolean("attivi", true)) return;
            String note = d.containsKey("note") ? d.get("note") : "";
            String ver = d.containsKey("version") ? d.get("version") : "";
            if (ControlloAggiornamenti.notifica(c, "Eurodex " + ver + " è pronta",
                note == null || note.isEmpty() ? "Tocca per aggiornare: la collezione resta com'è." : note + " · Tocca per aggiornare."))
                sp.edit().putLong("notificata", nuova).apply();
        } catch (Exception ignored) {}
    }

    // modifiche dagli altri dispositivi: UNA notifica che si aggiorna (ultime righe una sotto l'altra), che suona solo la
    // prima volta, su un canale suo a importanza normale (si può zittire senza perdere gli avvisi degli aggiornamenti)
    static final int ID_SYNC = 1000;
    static final String CANALE_SYNC = "sincronizzazione";

    static void notificaSync(Context c, SharedPreferences sp, String nome, String testo) {
        // ogni riga dice da quale dispositivo viene; il titolo è generico se i dispositivi sono più di uno
        String riga = nome + ": " + testo;
        if (!androidx.core.app.NotificationManagerCompat.from(c).areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationManager nm = c.getSystemService(android.app.NotificationManager.class);
            android.app.NotificationChannel ch = new android.app.NotificationChannel(CANALE_SYNC, "Modifiche dagli altri dispositivi", android.app.NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Monete segnate o tolte sugli altri dispositivi collegati allo stesso account");
            nm.createNotificationChannel(ch);
        }
        // le righe ripartono da zero se la notifica non è più in tendina (letta o tolta)
        java.util.ArrayList<String> righe = new java.util.ArrayList<>();
        if (ControlloAggiornamenti.attiva(c, ID_SYNC)) for (String r : sp.getString("sync_righe", "").split("\n")) if (!r.isEmpty()) righe.add(r);
        righe.add(0, riga);
        while (righe.size() > 6) righe.remove(righe.size() - 1);
        sp.edit().putString("sync_righe", android.text.TextUtils.join("\n", righe)).apply();
        android.content.Intent apri = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (apri != null) {
            apri.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            apri.putExtra("eurodex_azione", "sync");
        }
        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(c, ID_SYNC, apri,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        java.util.HashSet<String> nomi = new java.util.HashSet<>();
        for (String r : righe) { int i = r.indexOf(": "); nomi.add(i > 0 ? r.substring(0, i) : r); }
        String titolo = nomi.size() > 1 ? "Eurodex · modifiche dagli altri dispositivi" : "Eurodex · da " + nome;
        androidx.core.app.NotificationCompat.InboxStyle stile = new androidx.core.app.NotificationCompat.InboxStyle();
        for (String r : righe) stile.addLine(r);
        if (righe.size() > 1) stile.setSummaryText(righe.size() + " modifiche");
        androidx.core.app.NotificationCompat.Builder b = new androidx.core.app.NotificationCompat.Builder(c, CANALE_SYNC)
            .setSmallIcon(R.drawable.ic_notifica)
            .setColor(0xFFD7AF50)
            .setContentTitle(titolo)
            .setContentText(riga)
            .setStyle(stile)
            .setNumber(righe.size())
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_SOCIAL);
        try { androidx.core.app.NotificationManagerCompat.from(c).notify(ID_SYNC, b.build()); } catch (SecurityException ignored) {}
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // l'app non usa i token singoli: riceve gli avvisi dall'argomento "aggiornamenti"
    }
}
