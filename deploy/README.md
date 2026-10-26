# GoldRegenDB – Synology-Deployment

Quellen der Release-Assets: `docker-compose.yml`, `.env.example`, `install.sh` (hier) sowie
`init.sql`, `backup.sh`, `restore.sh` (aus `db/`). Jedes GitHub-Release hängt sie flach an.

## Voraussetzungen

- Synology NAS mit Container Manager (DSM 7+), SSH-Zugang, root (`sudo`)

## Installation und Update

```bash
curl -fsSL https://github.com/Revilo91/GoldRegenDB_Web/releases/latest/download/install.sh | sudo bash
```

Weitere Aufrufe (als Datei, `install.sh` aus dem Release herunterladen):

```bash
sudo bash install.sh v1.2.3         # bestimmte Version
sudo bash install.sh --rollback     # zurück auf die Version vor dem letzten Update
sudo INSTALL_DIR=/volume1/docker/x bash install.sh
```

Ablauf: Release laden und Image ziehen (noch nichts verändert), dann
1. Datenbank sichern nach `backups/pre-update_*.sql.gz` (letzte 10 bleiben),
2. Ordner anlegen, 3. Stack stoppen, `:previous` merken, alte Images löschen,
4. Release-Dateien einspielen, `.env` anlegen bzw. um neue Variablen ergänzen
(`POSTGRES_PASSWORD`, `JWT_SECRET`, `BESTELLUNG_ENCRYPTION_KEY` erzeugt das Skript selbst),
5. starten, Health-Check, bei Fehler automatischer Rollback.

Bestehende `.env`-Werte werden nie überschrieben. Aufrufen: `http://<synology-ip>:3000`,
erster Login `admin` / `admin` (Passwort danach ändern).

## Ordner (relativ zu `/volume1/docker/goldregendb`)

| Pfad | Inhalt |
|------|--------|
| `data/postgres` | Datenbank |
| `backups` | tägliche/wöchentliche Backups, `pre-update_*.sql.gz`, `migrations/` |
| `db` | `init.sql`, `backup.sh`, `restore.sh` |

Fotos liegen in der Datenbank. Für den Bestandsimport (`scripts/import-fotos.js`) wird ein
beliebiger Ordner beim Aufruf eingebunden, siehe README.md im Repository.

## Update von älteren Installationen

Lag die Datenbank bisher direkt in `data/` (alter PGDATA-Pfad), übernimmt `install.sh` sie per
Dump nach `data/postgres`; das alte Verzeichnis bleibt unverändert liegen. Die Variablen
`IMAGE_TAG` heißt jetzt `APP_VERSION` (setzt das Skript), `APP_HOST_PORT` heißt `APP_PORT` (Wert wird übernommen).
Ein `DATA_DIR` in der `.env`, das nicht dem Installationsordner entspricht, bricht das Skript ab.

## Backup

`install.sh` sichert nur vor einem Update (`backups/pre-update_*.sql.gz`, die letzten 10).
Den laufenden Plan übernimmt `db/backup.sh`: täglich (7 Tage) und wöchentlich (4 Wochen),
mit geprüftem Dump. Ablage unter `backups/daily/` und `backups/weekly/` im Installationsordner.
Es läuft nichts von allein, der Aufruf kommt vom DSM-Aufgabenplaner:

1. DSM: Systemsteuerung → Aufgabenplaner → Erstellen → Geplante Aufgabe → Benutzerdefiniertes Skript.
2. Benutzer `root`, Zeitplan täglich 02:00 Uhr.
3. Befehl (Pfad = `INSTALL_DIR`):
   ```bash
   cd /volume1/docker/goldregendb && docker compose exec -T db /backup.sh >> backups/backup.log 2>&1
   ```

Einmal manuell: `docker compose exec db /backup.sh`.

Wiederherstellen (ersetzt die komplette Datenbank, vorher die App stoppen):

```bash
cd /volume1/docker/goldregendb
docker compose stop app
docker compose exec db /restore.sh /backups/daily/goldregendb_<zeitstempel>.sql.gz
docker compose start app
```

## Backup-Status und Fehlermeldung

Teil 1 von #289 (Teil 2 „Jetzt sichern“ und Teil 3 „Restore-Test“ folgen separat).

`db/backup.sh` schreibt nach **jedem** Lauf, auch nach Fehler oder Abbruch, atomar die Datei
`backups/backup-status.json` (im Container `/backups/backup-status.json`):

| Feld | Inhalt |
|---|---|
| `zeitpunkt` | Ende des Laufs, ISO-8601 UTC |
| `ergebnis` | `ok` oder `fehler` |
| `datei` | Dateiname des zuletzt erzeugten Dumps, bei Fehler leer |
| `groesse_bytes` | Größe dieses Dumps, bei Fehler `0` |
| `dauer_sekunden` | Laufzeit |
| `art` | `daily`, an Sonntagen `weekly` (Art des zuletzt erzeugten Dumps) |
| `fehler` | Kurztext, nur bei Fehler |

`GET /api/health` (öffentlich) enthält daraus nur ein Wort: `"backup": { "status": "ok" }`.
Der HTTP-Status von `/api/health` ändert sich dadurch nicht, der Docker-Healthcheck bleibt unberührt.

| `backup.status` | Bedeutung |
|---|---|
| `ok` | letzter Lauf erfolgreich und nicht älter als `BACKUP_MAX_ALTER_STUNDEN` (Standard 26) |
| `veraltet` | letzter Lauf erfolgreich, aber älter (Aufgabenplaner lief nicht) |
| `fehler` | letzter Lauf fehlgeschlagen |
| `unbekannt` | Status-Datei fehlt oder ist unlesbar (z. B. noch nie gelaufen) |

**Fehlermeldung (optional, Kanal frei wählbar):** Ist `BACKUP_WEBHOOK_URL` in der `.env` gesetzt,
sendet `backup.sh` bei einem Fehler einen HTTP-POST mit kurzem Klartext-Body an diese URL.
Das passt zu jedem Dienst, der einen Webhook annimmt (z. B. ntfy oder ein Home-Assistant-Webhook).
Welcher Kanal genutzt wird, ist nicht festgelegt; leer = aus. Die URL kann ein Token enthalten,
sie steht nur in der `.env` und wird nie geloggt. Scheitert der Aufruf, steht eine Warnung im Log;
Exit-Code und Status-Datei bleiben unverändert. Nach einer Änderung der `.env`:
`docker compose up -d`, damit der `db`-Container die Variable bekommt. `backup.sh` nutzt `curl`,
sonst `wget` aus dem `db`-Image (kein Paket wird nachinstalliert).

**„Kein Backup seit mehr als 26 Stunden“ ist passiv:** `/api/health` meldet dann `veraltet`, schickt
aber selbst nichts (das Backend hat keinen eigenen Scheduler). Wer dafür eine Benachrichtigung will,
lässt `/api/health` von DSM-Aufgabenplaner, einem Uptime-Monitor oder Home Assistant regelmäßig
abfragen und auf `backup.status` ungleich `ok` prüfen. Ein Lauf, der gar nicht startet, meldet sich
nie von selbst; genau diesen Fall deckt nur die Abfrage von `/api/health` ab.

**Zielwerte (Vorschlag, noch zu bestätigen):** RPO 1 Tag (maximaler Datenverlust), RTO 1 Stunde
(Zeit bis zur wiederhergestellten Anwendung).

## Offsite-Backup (3-2-1)

Die Dumps unter `backups/` liegen auf derselben NAS wie die Datenbank. Fällt die NAS aus
(Defekt, Diebstahl, Feuer, Verschlüsselungstrojaner), sind Datenbank und Backups zusammen weg.
Deshalb gilt 3-2-1: **3** Kopien, auf **2** verschiedenen Medien, davon **1** an einem anderen Standort.
Umsetzung mit Synology Hyper Backup (kein neuer Code, keine zusätzliche Software):

| Kopie | Ort | Zweck |
|-------|-----|-------|
| 1 | NAS, Ordner `backups/` (erzeugt von `db/backup.sh`) | schnelle Wiederherstellung |
| 2 | Externes USB-Laufwerk an der NAS (Hyper Backup) | NAS-Defekt, versehentliches Löschen |
| 3 | NAS bei Bekannten, anderer Standort (Hyper Backup) | Brand, Diebstahl, Einbruch |

### Was gesichert wird

Den Ordner `backups/` im Installationsordner (Standard `/volume1/docker/goldregendb/backups`),
**nicht** das laufende Datenbank-Volume `data/postgres`: Ein Dateikopie-Backup einer laufenden
PostgreSQL ist nicht konsistent, die geprüften Dumps schon. Der Ordner enthält:

- `daily/`, `weekly/`: Dumps von `db/backup.sh`
- `pre-update_*.sql.gz`: Sicherung vor jedem Update durch `install.sh`
- `migrations/`: Dumps vor Schema-Migrationen (`MIGRATION_BACKUP_DIR`)
- `backup.log` (Log des Aufgabenplaners)

Fotos (ca. 1,6 GB) stecken in den Dumps, ein separater Foto-Ordner entfällt. Unterordner nicht
einzeln abwählen: `migrations/` und `pre-update_*` sind bei einem fehlgeschlagenen Update die
Rückfallebene. Ob `vor-restore/` (Sicherheits-Dump von `restore.sh`) vorhanden ist, hängt davon ab,
ob schon einmal wiederhergestellt wurde; der Ordner liegt ebenfalls unter `backups/` und wird
mitgesichert.

### Kopie 2: externes USB-Laufwerk

Das Laufwerk ist noch nicht vorhanden. Anschaffungsempfehlung:

- Extern per USB, vorgesehen für Dauerbetrieb bzw. regelmäßigen Anschluss (kein USB-Stick).
- Kapazität deutlich über dem Datenbestand: Jeder Stand enthält die Fotos (ca. 1,6 GB), dazu kommen
  die Dumps und die vorgehaltenen Versionen. Großzügig dimensionieren, Reserve für Wachstum einplanen.
- In DSM als Hyper-Backup-Ziel unterstützt (Dateisystem und Hinweise in der Hyper-Backup-Hilfe von
  DSM prüfen, bevor das Laufwerk gekauft wird).

Einrichtung in DSM: Paket-Zentrum → Hyper Backup installieren → Sicherungsaufgabe erstellen →
Ziel „Lokaler Ordner und USB“ bzw. gleichwertig (Bezeichnung je nach DSM-Version in DSM prüfen) →
Quelle: Ordner `backups` der Freigabe, in der der Installationsordner liegt.

### Kopie 3: Offsite bei Bekannten

Hyper Backup sichert auf ein entferntes Synology-NAS (Hyper Backup Vault) oder ein
rsync-Ziel. Die Aufgabe wird auf der eigenen NAS angelegt, die NAS der Bekannten ist nur das Ziel.

- **Verschlüsselung:** „Clientseitige Verschlüsselung“ aktivieren. Die Daten werden vor der
  Übertragung verschlüsselt und liegen bei den Bekannten nur verschlüsselt.
- **Versionierung/Aufbewahrung:** Versionsrotation aktivieren, **30 Tage** Aufbewahrung.
  Die genauen Optionen der Rotation in DSM prüfen.
- **Absprache mit den Bekannten:** Ziel-NAS mit Hyper Backup Vault bzw. rsync-Dienst, freier
  Speicherplatz, dauerhafte Erreichbarkeit (eingeschaltet, Updates) und wer Zugriff auf die NAS hat.
- **Erreichbarkeit:** über VPN (bevorzugt) oder eine Portfreigabe am Router der Bekannten. Die
  Freigabe nur für das nötige Protokoll und nach Möglichkeit eingeschränkt auf die eigene IP-Adresse;
  nichts ohne Absprache am fremden Router ändern. Die Verbindung in DSM testen, bevor der
  Zeitplan aktiviert wird.
- **Datenschutz:** Die Dumps enthalten Kundendaten (Bestellformular-Daten sind zusätzlich
  verschlüsselt, der Rest der Datenbank nicht) und alle Fotos. Auch bei clientseitiger
  Verschlüsselung ist der Standort ein weiterer Speicherort personenbezogener Daten; ob dafür eine
  Vereinbarung (AVV bzw. gleichwertig) nötig ist, vorab klären. Offsite nur mit
  clientseitiger Verschlüsselung betreiben.

### Zeitplan

Die Hyper-Backup-Aufgaben laufen **täglich nach** dem Dump von `db/backup.sh` (Aufgabenplaner
siehe Abschnitt „Backup“), damit stets der aktuelle Dump mitgesichert wird. Die genaue Uhrzeit
und der nötige Abstand richten sich nach der Laufzeit des Dumps; sie werden zusammen mit der
Überwachung der Backups in #289 festgelegt.

### Verschlüsselungs-Passwort

> **Verlust des Passworts = Offsite-Backup unbrauchbar.** Hyper Backup kann ohne das Passwort
> (bzw. den Schlüssel) nichts wiederherstellen, auch Synology nicht.

- Im Passwortmanager ablegen **und** eine Kopie bei einer zweiten Person hinterlegen
  (Marina bzw. Saskia), nie nur auf der NAS.
- Das Passwort steht nicht im Repository, nicht in der `.env` und nicht im Log.

### Wiederherstellung testen

Ein Backup gilt erst als sicher, wenn die Wiederherstellung einmal erfolgreich aus der
Offsite-Kopie geprüft wurde. Der Test (Ablauf, Erfolgskriterien, Turnus) ist in #289 vorgesehen und
hier noch nicht beschrieben. Das Zurückspielen eines Dumps selbst steht im Abschnitt „Backup“.

## Hinweise

- Backup und Wiederherstellen: siehe Abschnitt „Backup“; Kopien außerhalb der NAS:
  „Offsite-Backup (3-2-1)“.
- Ohne vorgeschalteten Reverse Proxy läuft alles über unverschlüsseltes HTTP.
  HTTPS-Einrichtung: README.md im Repository, Abschnitt „HTTPS auf Synology“.
