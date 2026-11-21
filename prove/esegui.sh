#!/bin/bash
# Tutte le prove dell'app nel browser (come una persona, sincronizzazione, backup e ripristino, uso completo).
# Uso: bash prove/esegui.sh   (dalla cartella del repository). Esce con errore se anche una sola prova fallisce.
cd "$(dirname "$0")/.."
python3 -m http.server 8791 -d www >/tmp/prove-server.log 2>&1 &
SRV=$!; trap "kill $SRV 2>/dev/null" EXIT; sleep 1
ESITO=0
for p in come-una-persona sincronizzazione regole-accesso backup-ripristino uso-completo; do
  echo "===== $p ====="
  CMD="timeout 900 python3 -u prove/$p.py"
  # la sincronizzazione si prova con i servizi veri di Firebase in versione locale (emulatori, stesse regole)
  if [ "$p" = sincronizzazione ] || [ "$p" = regole-accesso ]; then CMD="npx firebase emulators:exec --only auth,firestore --project collezione-euro-24ecd \"$CMD\""; fi
  if eval "$CMD" > /tmp/prova-$p.log 2>&1; then grep -E "RISULTATO" /tmp/prova-$p.log | tail -1
  else ESITO=1; grep -E "^✗|^NO |RISULTATO|Error|Traceback" /tmp/prova-$p.log | head -20; fi
done
exit $ESITO
