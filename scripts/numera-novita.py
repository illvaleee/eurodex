# Dà il numero di versione alle novità appena scritte in www/novita.json (quelle ancora senza "v").
# Uso: python3 scripts/numera-novita.py 48
import json, sys
p, n = 'www/novita.json', int(sys.argv[1])
l = json.load(open(p))
cambiate = [e for e in l if 'v' not in e]
for e in cambiate:
    e['v'] = n
if cambiate:
    json.dump(l, open(p, 'w'), ensure_ascii=False, indent=2)
    open(p, 'a').write('\n')
print(f'novità numerate con la versione 1.0.{n}: {len(cambiate)}')
