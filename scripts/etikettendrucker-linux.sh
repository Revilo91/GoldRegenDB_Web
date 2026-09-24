#!/usr/bin/env bash
# Richtet den Phomemo M220 (CUPS) für die GoldRegenDB-Etiketten ein.
# Aufruf: sudo ./etikettendrucker-linux.sh [Druckername]   (Standard: M220)
set -euo pipefail

DRUCKER="${1:-M220}"
PPD="/etc/cups/ppd/${DRUCKER}.ppd"

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo ausführen." >&2
  exit 1
fi
[ -f "$PPD" ] || { echo "PPD nicht gefunden: $PPD (Druckername prüfen)" >&2; exit 1; }

cp -n "$PPD" "${PPD}.bak-vor-etiketten"

# Groß hochkant 40x45 (Chrome dreht Querformat-Seiten sonst über CUPS und schneidet ab),
# Klein 30x20 quer. Vorlage ist das mitgelieferte Format w136h85 (48x30mm)
python3 - "$PPD" <<'PY'
import re, sys

ppd = sys.argv[1]
zeilen = open(ppd, encoding="latin-1").read().split("\n")
ziele = [
    ("w113h128", "Etikett Gross 40x30mm", "113 128"),
    ("w85h57", "Etikett Klein 30x20mm", "85 57"),
]
quelle = "w136h85"

for name, bezeichnung, mass in ziele:
    if any(re.match(rf"\*(PageSize|PageRegion|ImageableArea|PaperDimension) {name}[/:]", z) for z in zeilen):
        print(f"{name}: schon vorhanden")
        continue
    neu, angelegt = [], 0
    for z in zeilen:
        neu.append(z)
        if re.match(rf"\*(PageSize|PageRegion|ImageableArea|PaperDimension) {quelle}[/:]", z):
            kopie = re.sub(rf"{quelle}(/[^:]*)?:", f"{name}/{bezeichnung}:", z, count=1)
            neu.append(kopie.replace("136 85", mass))
            angelegt += 1
    if angelegt != 4:
        sys.exit(f"{name}: erwartet 4 Vorlagenzeilen ({quelle}), gefunden {angelegt} - abgebrochen")
    zeilen = neu
    print(f"{name}: angelegt")

open(ppd, "w", encoding="latin-1").write("\n".join(zeilen))
PY

systemctl restart cups

# Einzeletiketten mit Lücke, keine 180°-Drehung im Treiber
lpoptions -p "$DRUCKER" -o zeMediaTracking=Gap -o Rotate=0

echo
echo "Papierformate:"
lpoptions -p "$DRUCKER" -l | grep PageSize
echo
echo "Fertig. Chrome komplett neu starten und im Druckdialog"
echo "'Etikett Gross 40x30mm' (bzw. 'Etikett Klein 30x20mm') wählen,"
echo "Ränder: Keine, Skalierung: An Seite anpassen."
