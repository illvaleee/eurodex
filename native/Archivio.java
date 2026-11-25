package it.collezione.euro;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.storage.FirebaseStorage;
import com.google.firebase.storage.StorageException;
import com.google.firebase.storage.StorageReference;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Versioni (rilasci/) e catalogo (dati/) dal server di Eurodex, cioè Cloud Storage di Firebase, con la sessione di
 * questo telefono (Firebase Authentication nella parte nativa). Le regole di Storage (firebase/storage.rules) danno i
 * file solo a chi può usare Eurodex. Qui non ci sono indirizzi con il token di download: solo l'SDK, che manda il
 * gettone dell'utente (docs/progetto-accesso-su-approvazione.md, §4.6, §9.2 e §9.4).
 *
 * Con debug.eurodex.emulatori=1, una proprietà che può scrivere solo la shell di adb come debug.eurodex.prove, tutto
 * va agli emulatori di Firebase sul computer che fa girare il telefono simulato (10.0.2.2): Auth e Storage qui, Auth e
 * Firestore nella parte web. Mai metà e metà.
 */
final class Archivio {
    static final String HOST_EMULATORI = "10.0.2.2";
    static final int PORTA_AUTH = 9099, PORTA_STORAGE = 9199;

    // i percorsi che l'app può chiedere: version.json e gli APK, l'indice, catalogo e schede, le foto (come le regole)
    static final Pattern PERCORSO = Pattern.compile(
        "rilasci/version\\.json|rilasci/[A-Za-z0-9._-]{1,80}\\.apk|dati/indice\\.json"
            + "|dati/(catalog|details)(-[0-9]{1,9})?\\.json|dati/img/[0-9a-f]{1,64}\\.webp");
    // letti in memoria solo version.json e l'indice, che sono piccoli (l'indice circa 25 KB); catalogo, schede, foto e
    // APK si scaricano direttamente nei file
    static final long MAX_TESTO = 1024 * 1024;

    private static volatile boolean pronto = false;
    private static volatile boolean conEmulatori = false;

    private Archivio() {}

    /** Va chiamato prima di ogni uso di Auth e Storage nativi: gli emulatori si impostano prima del primo uso. */
    static synchronized void prepara() {
        if (pronto) return;
        conEmulatori = "1".equals(NativoPlugin.proprieta("debug.eurodex.emulatori"));
        if (conEmulatori) {
            FirebaseAuth.getInstance().useEmulator(HOST_EMULATORI, PORTA_AUTH);
            FirebaseStorage.getInstance().useEmulator(HOST_EMULATORI, PORTA_STORAGE);
        }
        pronto = true;
    }

    static boolean emulatori() {
        prepara();
        return conEmulatori;
    }

    /** La sessione nativa, o null se in questa parte non si è ancora fatto l'accesso. */
    static FirebaseUser utente() {
        prepara();
        return FirebaseAuth.getInstance().getCurrentUser();
    }

    static StorageReference riferimento(String percorso) {
        prepara();
        if (percorso == null || !PERCORSO.matcher(percorso).matches()) throw new IllegalArgumentException("percorso non previsto");
        return FirebaseStorage.getInstance().getReference(percorso);
    }

    /** Il motivo di un errore, con un codice che capisce anche la parte web (src/core/archivio.ts). */
    static String codice(Exception e) {
        if (e instanceof SenzaSessione) return "SENZA_SESSIONE";
        if (e instanceof StorageException) {
            int c = ((StorageException) e).getErrorCode();
            if (c == StorageException.ERROR_NOT_AUTHENTICATED) return "SENZA_SESSIONE";
            if (c == StorageException.ERROR_NOT_AUTHORIZED) return "NEGATO";
            if (c == StorageException.ERROR_OBJECT_NOT_FOUND) return "ASSENTE";
        }
        return "RETE";
    }

    // ---- per i lavori in background, nel thread del Worker: lì si può aspettare la risposta ----

    /** Aspetta la risposta; l'errore che arriva è quello di Storage, non l'involucro di Tasks.await. */
    static <T> T aspetta(Task<T> t, long secondi) throws Exception {
        try {
            return Tasks.await(t, secondi, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            Throwable c = e.getCause();
            throw c instanceof Exception ? (Exception) c : e;
        }
    }

    static String testo(String percorso) throws Exception {
        if (utente() == null) throw new SenzaSessione();
        byte[] b = aspetta(riferimento(percorso).getBytes(MAX_TESTO), 60);
        return new String(b, StandardCharsets.UTF_8);
    }

    /** Scarica in un file, prima con un nome provvisorio: il file vero compare solo intero. */
    static void inFile(String percorso, File dest) throws Exception {
        if (utente() == null) throw new SenzaSessione();
        File p = dest.getParentFile();
        if (p != null) p.mkdirs();
        File tmp = new File(dest.getPath() + ".part");
        try {
            aspetta(riferimento(percorso).getFile(tmp), 180);
        } catch (Exception e) {
            tmp.delete();
            throw e;
        }
        if (!tmp.renameTo(dest)) throw new Exception("rinomina non riuscita");
    }

    static final class SenzaSessione extends Exception {
        SenzaSessione() { super("Per versioni e catalogo nuovi serve l'accesso con Google"); }
    }
}
