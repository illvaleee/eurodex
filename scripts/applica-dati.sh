#!/usr/bin/env bash
# Mette su main il commit dei dati preparato da un job senza permesso di scrittura ("scarica" in catalogo.yml e
# foto.yml, dove girano gli script del catalogo e sharp). Questo script gira nel job "pubblica", l'unico che può
# scrivere nel progetto, e tratta il commit come un dato non fidato. Lo accetta solo se:
#  - è UN solo commit, figlio diretto di quello da cui è partito il giro ($GITHUB_SHA);
#  - tocca SOLO i file dei dati, con il loro tipo: risposte di Numista (scripts/cache/*.json), pagine e foto della
#    BCE (scripts/ecb-cache/), catalogo e foto dell'app (www/data/*.json, www/data/img/*.webp), stato Numista,
#    monete viste per la prima volta, esclusioni;
#  - contiene solo file normali: niente link simbolici, file eseguibili, submodule, nomi che cominciano con un punto.
# Poi lo applica sopra il main di adesso (se nel frattempo è cambiato, vincono i dati, come prima con
# "git pull --rebase -X theirs"), ricontrolla la stessa regola sul risultato finale, e lo spinge con un messaggio
# scelto qui e il bot come autore (niente testo del job non fidato nella storia di main).
# Uso: bash scripts/applica-dati.sh <file .bundle> "<messaggio del commit>"
set -euo pipefail

bundle="${1:?manca il file del bundle}"
messaggio="${2:?manca il messaggio del commit}"
base="${GITHUB_SHA:?manca GITHUB_SHA}"
errore() { echo "::error title=Dati dal job scarica::$1"; exit 1; }

# la regola: solo file dei dati, del tipo giusto, file normali (si usa due volte: sul commit e sul risultato finale)
controlla() { # da, a
  python3 - "$1" "$2" <<'PY'
import re
import subprocess
import sys

da, a = sys.argv[1:3]
uscita = subprocess.run(['git', 'diff', '--raw', '--no-renames', '-z', da, a], capture_output=True, check=True).stdout
pezzi = uscita.split(b'\0')
N = rb'[^/.\0][^/\0]*'   # un pezzo del percorso: niente vuoti, niente nomi che cominciano con un punto
PERMESSI = re.compile(
    rb'scripts/cache/' + N + rb'\.json'
    rb'|scripts/ecb-cache/(?:' + N + rb'/)?' + N + rb'\.(?:html|json|jpg|jpeg|png|gif|webp)'
    rb'|www/data/' + N + rb'\.json'
    rb'|www/data/img/' + N + rb'\.webp'
    rb'|scripts/(?:numista-state\.json|first-seen\.json|esclusi\.txt)'
)
errori, n = [], 0
for i in range(0, len(pezzi) - 1, 2):
    info, percorso = pezzi[i], pezzi[i + 1]
    modo_nuovo = info[1:].split(b' ')[1]
    nome = percorso.decode('utf-8', 'replace')
    if not PERMESSI.fullmatch(percorso):
        errori.append(f'fuori dai file dei dati (o tipo non ammesso): {nome}')
    elif modo_nuovo not in (b'100644', b'000000'):
        errori.append(f'tipo di file non ammesso ({modo_nuovo.decode()}): {nome}')
    n += 1
if errori:
    for e in errori[:20]:
        print(f'::error title=Dati dal job scarica::{e}')
    sys.exit(f'rifiutato: {len(errori)} file non ammessi su {n}')
print(f'controllati {n} file: tutti dati, del tipo giusto')
PY
}

[ -s "$bundle" ] || errore "il bundle non c'è o è vuoto"
git bundle verify -q "$bundle" >/dev/null 2>&1 || errore "il bundle non è valido (o non parte da $base)"
git fetch -q "$bundle" HEAD
nuovo="$(git rev-parse FETCH_HEAD)"
[ "$(git rev-list --parents -n 1 "$nuovo")" = "$nuovo $base" ] || errore "il bundle non è un solo commit sopra $base"
controlla "$base" "$nuovo" || errore "il commit tocca file che non sono dati"

# l'identità del commit la decide questo script (le variabili GIT_AUTHOR_* e GIT_COMMITTER_* avrebbero la precedenza)
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE
git config user.name "github-actions[bot]"
git config user.email "41898099+github-actions[bot]@users.noreply.github.com"
for tentativo in 1 2 3; do
  git fetch -q origin main
  main_ora="$(git rev-parse FETCH_HEAD)"
  git checkout -q -B main "$main_ora"
  if ! git cherry-pick --no-commit -X theirs "$nuovo" >/dev/null; then
    git cherry-pick --abort || git reset -q --hard
    errore "il commit dei dati non si applica sopra il main di adesso"
  fi
  if git diff --cached --quiet; then
    echo "Niente di nuovo da salvare: i dati sono già nel progetto"
    exit 0
  fi
  git commit -q -m "$messaggio"
  # la stessa regola sul risultato: il cherry-pick non deve aver portato le modifiche fuori dai dati (per esempio
  # seguendo un file spostato su main nel frattempo)
  controlla "$main_ora" HEAD || errore "applicato sul main di adesso, il commit toccherebbe file che non sono dati"
  if git push -q origin HEAD:main; then
    echo "Dati salvati nel progetto: $(git log -1 --format='%h %s')"
    exit 0
  fi
  echo "Il main è cambiato mentre salvavo, riprovo ($tentativo/3)"
  sleep 5
done
errore "non riesco a salvare i dati nel progetto dopo 3 tentativi"
