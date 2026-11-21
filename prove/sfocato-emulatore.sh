#!/bin/bash
# Diagnosi dello sfocato sull'emulatore: installa l'app ispezionabile, la apre, chiude i fogli del primo avvio e
# lancia prove/sfocato-devtools.py. Le schermate di contorno vanno in sfocato/.
set -u
mkdir -p sfocato
adb install -r diagnosi.apk
adb shell pm grant it.collezione.euro android.permission.POST_NOTIFICATIONS || true
adb shell monkey -p it.collezione.euro -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 30
adb exec-out screencap -p > sfocato/0-dopo-avvio.png
# i fogli del primo avvio (benvenuto, accesso) si chiudono come farebbe una persona: indietro
for _ in 1 2 3; do adb shell input keyevent 4; sleep 2; done
adb shell monkey -p it.collezione.euro -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 5
adb exec-out screencap -p > sfocato/1-prima-della-diagnosi.png
python3 prove/sfocato-devtools.py --uscita sfocato
esito=$?
adb exec-out screencap -p > sfocato/2-dopo-la-diagnosi.png
exit $esito
