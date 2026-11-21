#!/usr/bin/env bash
# Video della prova sul telefono simulato, da rivedere dopo: si vede tutto quello che fa test-emulator.py.
# Android registra lo schermo al massimo 3 minuti per file, quindi sul telefono gira un ciclo che apre un file dopo
# l'altro finché non compare il file "ferma". Alla fine i pezzi vengono scaricati e, se c'è ffmpeg, uniti in un solo
# video leggero (H.264, 540x1200). Il video non deve mai far fallire la prova: se qualcosa non va, avvisa e basta.
# Uso: bash scripts/video-prova.sh avvia
#      bash scripts/video-prova.sh ferma <cartella>
set -u
T=/data/local/tmp/video-prova
avviso() { echo "::warning title=Video della prova::$1"; }

case "${1:-}" in
  avvia)
    adb shell "rm -rf $T; mkdir -p $T" || { avviso "telefono non raggiungibile: niente video"; exit 0; }
    # il ciclo gira sul telefono, staccato da adb (setsid e nohup), così continua dopo la fine di questo comando.
    # 720x1600 (multipli di 16, come piace al codificatore) e al massimo 30 pezzi; se screenrecord si ferma da solo
    # con un errore il ciclo finisce, invece di riprovare all'infinito rubando tempo alla prova
    adb shell "setsid nohup sh -c 'i=10; while [ ! -f $T/ferma ] && [ \$i -lt 40 ]; do screenrecord --size 720x1600 --bit-rate 1200000 $T/pezzo_\$i.mp4 || break; i=\$((i+1)); done' </dev/null >/dev/null 2>&1 &"
    sleep 3
    if adb shell "pgrep -x screenrecord" >/dev/null; then echo "Video della prova: registrazione partita"; else avviso "la registrazione non è partita"; fi
    ;;

  ferma)
    out="${2:?manca la cartella}"
    mkdir -p "$out/pezzi"
    adb shell "touch $T/ferma; pkill -INT -x screenrecord" >/dev/null 2>&1
    # screenrecord chiude bene il file solo dopo il segnale: aspetto che sia uscito (al massimo 15 secondi)
    for _ in $(seq 15); do adb shell "pgrep -x screenrecord" >/dev/null 2>&1 || break; sleep 1; done
    for f in $(adb shell "ls $T" 2>/dev/null | tr -d '\r'); do
      case "$f" in pezzo_[0-9][0-9].mp4) adb pull "$T/$f" "$out/pezzi/" >/dev/null || avviso "non riesco a scaricare $f" ;; esac
    done
    mapfile -t pezzi < <(find "$out/pezzi" -name 'pezzo_*.mp4' -size +0 -printf '%f\n' | sort)
    [ "${#pezzi[@]}" -gt 0 ] || { avviso "nessun pezzo di video registrato"; exit 0; }
    if ! command -v ffmpeg >/dev/null; then
      echo "Video della prova: ${#pezzi[@]} pezzi (ffmpeg non c'è, restano separati)"
      exit 0
    fi
    printf "file '%s'\n" "${pezzi[@]}" >"$out/pezzi/lista.txt"
    if ffmpeg -nostdin -loglevel error -f concat -safe 0 -i "$out/pezzi/lista.txt" -vf scale=540:1200 \
      -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -movflags +faststart -an "$out/prova.mp4"; then
      rm -rf "$out/pezzi"
      echo "Video della prova: $(du -h "$out/prova.mp4" | cut -f1), da ${#pezzi[@]} pezzi"
    else
      rm -f "$out/prova.mp4" "$out/pezzi/lista.txt"
      avviso "non sono riuscito a unire i pezzi: restano separati"
    fi
    ;;

  *)
    echo "uso: $0 avvia | ferma <cartella>" >&2
    exit 2
    ;;
esac
