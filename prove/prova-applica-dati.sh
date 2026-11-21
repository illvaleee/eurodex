#!/usr/bin/env bash
# Prove di scripts/applica-dati.sh (job "pubblica" di catalogo.yml e foto.yml) con repository finti: origin nudo e
# checkout poco profondi come su GitHub. Uso: bash prove/prova-applica-dati.sh scripts/applica-dati.sh
set -uo pipefail
SCRIPT="$(realpath "$1")"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=prova GIT_AUTHOR_EMAIL=prova@example.com GIT_COMMITTER_NAME=prova GIT_COMMITTER_EMAIL=prova@example.com
export GITHUB_STEP_SUMMARY=/dev/null
ok=0; ko=0
esito() { if [ "$1" = "$2" ]; then echo "  ✓ $3"; ok=$((ok+1)); else echo "  ✗ $3 (atteso $2, avuto $1)"; ko=$((ko+1)); fi; }

nuovo_origin() { # crea origin.git con il commit A
  rm -rf "${T:?}"/*; git init -q --bare -b main "$T/origin.git"
  git clone -q "$T/origin.git" "$T/semina" 2>/dev/null; cd "$T/semina" || exit 1
  mkdir -p www/data/img scripts/cache src .github/workflows
  echo '{"rev":1}' > www/data/indice.json; echo '{"types":[]}' > www/data/catalog.json; echo a > www/data/img/1.jpg
  echo '{}' > scripts/cache/a.json; echo '{}' > scripts/numista-state.json; echo 'x' > src/app.ts; echo 'on: push' > .github/workflows/x.yml
  git add -A && git commit -qm A && git push -q origin HEAD:main
  A="$(git rev-parse HEAD)"; cd "$T" || exit 1
}
scarica() { # $1 = funzione che modifica i file; produce $T/dati.bundle
  rm -rf "$T/scarica"; git clone -q --depth 1 "file://$T/origin.git" "$T/scarica"; cd "$T/scarica" || exit 1
  git checkout -q "$A"; "$1"; git add -A; git commit -qm "Catalogo aggiornato [skip ci]"
  git bundle create -q "$T/dati.bundle" "$A..HEAD" 2>/dev/null; cd "$T" || exit 1
}
pubblica() { # applica il bundle partendo da un checkout poco profondo di A; stampa il codice di uscita
  rm -rf "$T/pubblica"; git clone -q --depth 1 "file://$T/origin.git" "$T/pubblica"; cd "$T/pubblica" || exit 1
  git fetch -q --depth 1 origin "$A" && git checkout -q "$A"
  GITHUB_SHA="$A" bash "$SCRIPT" "$T/dati.bundle" > "$T/uscita.txt" 2>&1; echo $? > "$T/codice.txt"; cd "$T" || exit 1
}
muovi_main() { # un commit B su main dopo A (come se qualcuno avesse spinto nel frattempo)
  rm -rf "$T/altro"; git clone -q "$T/origin.git" "$T/altro"; cd "$T/altro" || exit 1; "$1"; git add -A; git commit -qm B; git push -q origin HEAD:main; cd "$T" || exit 1
}
file_main() { git --git-dir="$T/origin.git" show "main:$1" 2>/dev/null; }

dati_ok() { echo '{"rev":2}' > www/data/indice.json; echo b > www/data/img/2.jpg; echo '{"n":1}' > scripts/cache/a.json; rm www/data/img/1.jpg; }
echo "1) caso normale, main fermo"; nuovo_origin; scarica dati_ok; pubblica
esito "$(cat $T/codice.txt)" 0 "uscita 0"; esito "$(file_main www/data/indice.json)" '{"rev":2}' "indice nuovo su main"
esito "$(file_main www/data/img/1.jpg || echo sparito)" sparito "file cancellato anche su main"
esito "$(git --git-dir=$T/origin.git log -1 --format=%s main)" "Catalogo aggiornato [skip ci]" "messaggio del commit conservato"

echo "2) main cambiato nel frattempo (altri file)"
cambia_src() { echo y > src/app.ts; }; nuovo_origin; scarica dati_ok; muovi_main cambia_src; pubblica
esito "$(cat $T/codice.txt)" 0 "uscita 0"; esito "$(file_main src/app.ts)" y "il cambio di main resta"; esito "$(file_main www/data/indice.json)" '{"rev":2}' "e i dati arrivano"

echo "3) main cambiato sugli stessi dati: vincono i dati nuovi"; nuovo_origin; scarica dati_ok
cambia_indice() { echo '{"rev":9}' > www/data/indice.json; }; muovi_main cambia_indice; pubblica
esito "$(cat $T/codice.txt)" 0 "uscita 0"; esito "$(file_main www/data/indice.json)" '{"rev":2}' "vince il dato del catalogo"

echo "4) niente di nuovo (dati già su main)"; nuovo_origin; scarica dati_ok; muovi_main dati_ok; pubblica
esito "$(cat $T/codice.txt)" 0 "uscita 0"; esito "$(grep -c 'Niente di nuovo' $T/uscita.txt)" 1 "lo dice e non spinge"

echo "5) commit che tocca un workflow: rifiutato"; nuovo_origin
cattivo1() { dati_ok; echo 'on: [push, schedule]' > .github/workflows/x.yml; }; scarica cattivo1; pubblica
esito "$(cat $T/codice.txt)" 1 "uscita 1"; esito "$(file_main .github/workflows/x.yml)" 'on: push' "main non cambia"

echo "6) commit che tocca il codice: rifiutato"; nuovo_origin
cattivo2() { dati_ok; echo 'malevolo' > src/app.ts; }; scarica cattivo2; pubblica
esito "$(cat $T/codice.txt)" 1 "uscita 1"; esito "$(file_main src/app.ts)" x "main non cambia"

echo "7) link simbolico nei dati: rifiutato"; nuovo_origin
cattivo3() { ln -s ../../.github/workflows/x.yml www/data/link.json; }; scarica cattivo3; pubblica
esito "$(cat $T/codice.txt)" 1 "uscita 1"; esito "$(file_main www/data/link.json || echo assente)" assente "main non cambia"

echo "8) file eseguibile nei dati: rifiutato"; nuovo_origin
cattivo4() { echo '#!/bin/sh' > scripts/cache/x.sh; chmod +x scripts/cache/x.sh; }; scarica cattivo4; pubblica
esito "$(cat $T/codice.txt)" 1 "uscita 1"

echo "9) due commit invece di uno: rifiutato"; nuovo_origin
rm -rf "$T/scarica"; git clone -q --depth 1 "file://$T/origin.git" "$T/scarica"; cd "$T/scarica" || exit 1
dati_ok; git add -A; git commit -qm uno; echo c > www/data/img/3.jpg; git add -A; git commit -qm due
git bundle create -q "$T/dati.bundle" "$A..HEAD" 2>/dev/null; cd "$T" || exit 1; pubblica
esito "$(cat $T/codice.txt)" 1 "uscita 1"

echo "10) bundle partito da un altro commit: rifiutato"; nuovo_origin; scarica dati_ok
VERO_A="$A"; muovi_main cambia_src; A="$(git --git-dir=$T/origin.git rev-parse main)"; pubblica; A="$VERO_A"
esito "$(cat $T/codice.txt)" 1 "uscita 1"

echo "11) percorso con .. dentro i dati: rifiutato"; nuovo_origin
cattivo5() { mkdir -p 'www/data/..x'; echo z > 'www/data/..x/f'; }; scarica cattivo5; pubblica
esito "$(cat $T/codice.txt)" 0 "un nome che comincia con .. ma resta dentro www/data è accettato"

echo "12) bundle vuoto o mancante: rifiutato"; nuovo_origin; : > "$T/dati.bundle"; pubblica
esito "$(cat $T/codice.txt)" 1 "uscita 1"

echo; echo "Prove passate: $ok, fallite: $ko"; [ "$ko" = 0 ]
