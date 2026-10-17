# Etikettendrucker Phomemo M220 einrichten

Anleitung für Windows und Linux. Die Skripte legen die beiden Papierformate an, die GoldRegenDB beim Etikettendruck aus Chrome verwendet:

| Format im Druckdialog | Größe | Ausrichtung |
|-----------------------|-------|-------------|
| Etikett Gross 40x30mm | 40 × 45 mm | hochkant |
| Etikett Klein 30x20mm | 30 × 20 mm | quer |

Hochkant, weil Chrome Querformat-Seiten sonst über CUPS dreht und abschneidet.

Skripte im Projektordner: `scripts/etikettendrucker-linux.sh` und `scripts/etikettendrucker-windows.ps1`

---

## Vorbereitung (beide Systeme)

1. Etikettenrolle einlegen (Einzeletiketten mit Lücke).
2. Drucker einschalten und per USB oder Bluetooth mit dem Rechner koppeln.
3. Phomemo-Treiber installieren (Download auf der Phomemo-Support-Seite, Modell M220). Danach muss der Drucker im System als **M220** erscheinen.

Ein anderer Druckername ist möglich, dann beim Linux-Skript als Argument übergeben.

---

## Linux (CUPS)

1. Drucker in CUPS einrichten (`http://localhost:631` → Drucker hinzufügen, Name **M220**). Prüfen: `lpstat -p`
2. Skript ausführen:
   ```bash
   sudo ./scripts/etikettendrucker-linux.sh          # Druckername M220
   sudo ./scripts/etikettendrucker-linux.sh MeinName # anderer Name
   ```
3. Das Skript
   - sichert die PPD als `/etc/cups/ppd/M220.ppd.bak-vor-etiketten`,
   - ergänzt die beiden Papierformate,
   - startet CUPS neu,
   - setzt `zeMediaTracking=Gap` (Etiketten mit Lücke) und `Rotate=0` (keine 180°-Drehung).
4. Prüfen: `lpoptions -p M220 -l | grep PageSize` zeigt beide „Etikett …“-Formate.

Das Skript ist wiederholbar: vorhandene Formate werden übersprungen.

Zurücksetzen: `sudo cp /etc/cups/ppd/M220.ppd.bak-vor-etiketten /etc/cups/ppd/M220.ppd && sudo systemctl restart cups`

---

## Windows

1. Treiber installieren, Drucker erscheint unter *Einstellungen → Drucker und Scanner* als **M220**.
2. PowerShell **als Administrator** öffnen und ausführen:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\etikettendrucker-windows.ps1
   ```
   Das legt die beiden Formulare im Druckserver an.
3. Einmalig manuell im Treiber (*Drucker und Scanner → M220 → Druckeinstellungen*):
   - Medientyp: **Etiketten mit Lücke (Gap)**
   - Drehung / Rotate: **aus (0°)**

---

## Drucken aus der Anwendung (Chrome)

1. Chrome **komplett neu starten** (alle Fenster schließen).
2. Etikett in GoldRegenDB öffnen, Druckdialog starten.
3. Ziel: **M220**, Papierformat: **Etikett Gross 40x30mm** oder **Etikett Klein 30x20mm**.
4. Ränder: **Keine**, Skalierung: **An Seite anpassen**.

---

## Fehlersuche

| Problem | Lösung |
|---------|--------|
| Format fehlt im Druckdialog | Chrome komplett neu starten; Linux: `lpoptions -p M220 -l \| grep PageSize` prüfen |
| Etikett abgeschnitten oder gedreht | Hochkant-Format gewählt? Ränder „Keine“, Skalierung „An Seite anpassen“ |
| Druck um 180° gedreht | Linux: `lpoptions -p M220 -o Rotate=0`; Windows: Drehung im Treiber aus |
| Papiervorschub falsch / Leeretiketten | Medientyp auf „Gap“ (Etiketten mit Lücke) stellen und Rolle kalibrieren (Feed-Taste lang drücken) |
| Linux: „PPD nicht gefunden“ | Druckername stimmt nicht mit dem CUPS-Namen überein (`lpstat -p`) |
| Windows: „Bitte PowerShell als Administrator starten“ | PowerShell per Rechtsklick als Administrator öffnen |
