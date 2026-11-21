#!/usr/bin/env bash
# Mette su main il commit dei dati preparato da un job senza permesso di scrittura ("scarica" in catalogo.yml e
# foto.yml, dove girano gli script del catalogo e sharp). Questo script gira nel job "pubblica", l'unico che può
# scrivere nel progetto, e accetta il commit solo se:
#  - è UN solo commit, figlio diretto di quello da cui è partito il giro ($GITHUB_SHA);
#  - tocca SOLO i file dei dati (cache delle risposte, stato Numista, catalogo e foto in www/data);
#  - contiene solo file normali: niente link simbolici, file eseguibili o submodule.
# Poi lo applica sopra il main di adesso (se nel frattempo è cambiato, vincono i dati, come prima con
# "git pull --rebase -X theirs") e lo spinge.
# Uso: bash scripts/applica-dati.sh <file .bundle>
set -euo pipefail

bundle="${1:?manca il file del bundle}"
base="${GITHUB_SHA:?manca GITHUB_SHA}"
errore() { echo "::error title=Dati dal job scarica::$1"; exit 1; }

[ -s "$bundle" ] || errore "il bundle non c'è o è vuoto"
git bundle verify -q "$bundle" >/dev/null 2>&1 || errore "il bundle non è valido (o non parte da $base)"
git fetch -q "$bundle" HEAD
nuovo="$(git rev-parse FETCH_HEAD)"
[ "$(git rev-list --parents -n 1 "$nuovo")" = "$nuovo $base" ] || errore "il bundle non è un solo commit sopra $base"

python3 - "$base" "$nuovo" <<'PY'
import re
import subprocess
import sys

base, nuovo = sys.argv[1:3]
uscita = subprocess.run(['git', 'diff', '--raw', '--no-renames', '-z', base, nuovo], capture_output=True, check=True).stdout
pezzi = uscita.split(b'\0')
PERMESSI = re.compile(rb'(scripts/cache/|scripts/ecb-cache/|www/data/)[^\0]+|scripts/(numista-state\.json|first-seen\.json|esclusi\.txt)')
errori, n = [], 0
for i in range(0, len(pezzi) - 1, 2):
    info, percorso = pezzi[i], pezzi[i + 1]
    modo_nuovo = info[1:].split(b' ')[1]
    nome = percorso.decode('utf-8', 'replace')
    if not PERMESSI.fullmatch(percorso) or b'/../' in b'/' + percorso + b'/':
        errori.append(f'fuori dai file dei dati: {nome}')
    elif modo_nuovo not in (b'100644', b'000000'):
        errori.append(f'tipo di file non ammesso ({modo_nuovo.decode()}): {nome}')
    n += 1
if errori:
    for e in errori[:20]:
        print(f'::error title=Dati dal job scarica::{e}')
    sys.exit(f'commit rifiutato: {len(errori)} file non ammessi su {n}')
print(f'commit dei dati controllato: {n} file, tutti nei percorsi dei dati')
PY

git config user.name "github-actions[bot]"
git config user.email "41898099+github-actions[bot]@users.noreply.github.com"
for tentativo in 1 2 3; do
  git fetch -q origin main
  git checkout -q -B main FETCH_HEAD
  if ! git cherry-pick --no-commit -X theirs "$nuovo" >/dev/null; then
    git cherry-pick --abort || git reset -q --hard
    errore "il commit dei dati non si applica sopra il main di adesso"
  fi
  if git diff --cached --quiet; then
    echo "Niente di nuovo da salvare: i dati sono già nel progetto"
    exit 0
  fi
  git commit -q -C "$nuovo"
  if git push -q origin HEAD:main; then
    echo "Dati salvati nel progetto: $(git log -1 --format='%h %s')"
    exit 0
  fi
  echo "Il main è cambiato mentre salvavo, riprovo ($tentativo/3)"
  sleep 5
done
errore "non riesco a salvare i dati nel progetto dopo 3 tentativi"
