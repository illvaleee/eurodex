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
    # 576x1280 (9:20 come lo schermo, multipli di 16: il 36% di punti in meno da codificare rispetto a 720x1600) e al
    # massimo 30 pezzi; se screenrecord si ferma da solo
    # con un errore il ciclo finisce, invece di riprovare all'infinito rubando tempo alla prova
    adb shell "setsid nohup sh -c 'i=10; while [ ! -f $T/ferma ] && [ \$i -lt 40 ]; do screenrecord --size 576x1280 --bit-rate 1000000 $T/pezzo_\$i.mp4 || break; i=\$((i+1)); done' </dev/null >/dev/null 2>&1 &"
    sleep 3
    if adb shell "pgrep -x screenrecord" >/dev/null; then echo "Video della prova: registrazione partita"; else avviso "la registrazione non è partita"; fi
    ;;

  ferma)
    out="${2:?manca la cartella}"
    mkdir -p "$out/pezzi"
    adb shell "touch $T/ferma" >/dev/null 2>&1
    # il segnale fa chiudere bene il file in corso. Si ripete a ogni giro dell'attesa, per il caso (raro) di un pezzo
    # partito proprio mentre si creava "ferma" (al massimo 15 secondi)
    for _ in $(seq 15); do
      adb shell "pkill -INT -x screenrecord" >/dev/null 2>&1
      adb shell "pgrep -x screenrecord" >/dev/null 2>&1 || break
      sleep 1
    done
    for f in $(adb shell "ls $T" 2>/dev/null | tr -d '\r'); do
      case "$f" in pezzo_[0-9][0-9].mp4) adb pull "$T/$f" "$out/pezzi/" >/dev/null || avviso "non riesco a scaricare $f" ;; esac
    done
    mapfile -t pezzi < <(find "$out/pezzi" -name 'pezzo_*.mp4' -size +0 -printf '%f\n' | sort)
    [ "${#pezzi[@]}" -gt 0 ] || { avviso "nessun pezzo di video registrato"; exit 0; }
    if ! command -v ffmpeg >/dev/null; then
      echo "Video della prova: ${#pezzi[@]} pezzi (ffmpeg non c'è, restano separati)"
      exit 0
    fi
    # un pezzo non chiuso (senza la parte finale dell'mp4) ffmpeg lo salterebbe uscendo comunque con 0: si guardano
    # prima uno per uno, si uniscono quelli leggibili e quelli rotti restano nell'artifact, con un avviso
    buoni=() rotti=()
    for f in "${pezzi[@]}"; do
      if ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/pezzi/$f" >/dev/null 2>&1; then
        buoni+=("$f")
      else
        rotti+=("$f")
      fi
    done
    [ "${#rotti[@]}" -eq 0 ] || avviso "pezzi non leggibili, lasciati a parte: ${rotti[*]}"
    [ "${#buoni[@]}" -gt 0 ] || exit 0
    printf "file '%s'\n" "${buoni[@]}" >"$out/pezzi/lista.txt"
    if ffmpeg -nostdin -xerror -loglevel error -f concat -safe 0 -i "$out/pezzi/lista.txt" -vf scale=540:1200 \
      -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -movflags +faststart -an "$out/prova.mp4"; then
      for f in "${buoni[@]}"; do rm -f "$out/pezzi/$f"; done
      rm -f "$out/pezzi/lista.txt"
      rmdir "$out/pezzi" 2>/dev/null || true
      echo "Video della prova: $(du -h "$out/prova.mp4" | cut -f1), da ${#buoni[@]} pezzi"
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
