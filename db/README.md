---

# Datenbank-Backup & Wiederherstellung

Dieses Dokument beschreibt den Backup-Plan für die GoldRegenDB PostgreSQL-Datenbank.

---

## Übersicht

| Attribut          | Wert                                      |
|-------------------|-------------------------------------------|
| Datenbank         | PostgreSQL 16 (Docker-Volume `pgdata`)    |
| Backup-Methode    | `pg_dump` (SQL-Dump, komprimiert mit gzip)|
| Backup-Typen      | Täglich (7 Tage) + Wöchentlich (4 Wochen)|
| Speicherort       | Docker-Volume `pgbackups` (`/backups`)    |
| Skripte           | `db/backup.sh`, `db/restore.sh`           |

---

## Backup-Skript (`db/backup.sh`)

Das Skript erstellt einen komprimierten `pg_dump`-Dump und speichert ihn im
Verzeichnis `/backups` innerhalb des Datenbank-Containers.
Die Dateinamen enthalten einen Zeitstempel (`YYYYMMDD_HHMMSS`).

### Verzeichnisstruktur nach dem Backup

```
/backups/
├── daily/
│   ├── goldregendb_20240101_020000.sql.gz
│   ├── goldregendb_20240102_020000.sql.gz
│   └── ...   (max. 7 tägliche Backups)
└── weekly/
    ├── goldregendb_weekly_20231231_020000.sql.gz
    └── ...   (max. 4 wöchentliche Backups, jeden Sonntag)
```

### Konfiguration (Umgebungsvariablen)

| Variable       | Standardwert    | Beschreibung                               |
|----------------|-----------------|-------------------------------------------|
| `POSTGRES_DB`  | `goldregendb`   | Datenbankname                              |
| `POSTGRES_USER`| `goldregen`     | Datenbankbenutzer                          |
| `BACKUP_DIR`   | `/backups`      | Zielverzeichnis im Container               |
| `KEEP_DAILY`   | `7`             | Aufbewahrung täglicher Backups in **Tagen**|
| `KEEP_WEEKLY`  | `4`             | Aufbewahrung wöchentlicher Backups in **Wochen**|
| `MIN_BACKUP_BYTES` | `1024`      | Mindestgröße, unter der ein Dump verworfen wird|

> `KEEP_DAILY`/`KEEP_WEEKLY` sind **Zeiträume, keine Dateizahlen.** Die
> Rotation läuft über `find -mtime`, löscht also nach Alter. Vorher behielt sie
> die *N neuesten Dateien* — sieben manuelle Läufe an einem Vormittag
> verkürzten das Aufbewahrungsfenster damit von einer Woche auf zwei Stunden.

### Prüfung, bevor ein Dump ein Backup wird

`backup.sh` schreibt nie direkt auf den Zieldateinamen. Der Ablauf:

1. `pg_dump` schreibt in eine Temporärdatei `<ziel>.tmp.<pid>`.
2. Die Datei wird geprüft: `gzip -t` (lesbares Archiv), Mindestgröße
   (`MIN_BACKUP_BYTES`) und das Vorhandensein der Haupttabellen
   (`Schmuckstück`, `Kunde`, `Rechnung`, `Lieferschein`, `audit_log`,
   `app_users`) im Dump.
3. Erst danach wird sie per `mv` (atomar innerhalb desselben Verzeichnisses) an
   den endgültigen Namen verschoben.
4. Scheitert eine Prüfung, wird die Temporärdatei gelöscht (`trap` auf `EXIT`)
   und **bestehende Backups bleiben unangetastet**.

Vorher legte die Shell die Zieldatei an, *bevor* `pg_dump` startete. Ein
fehlgeschlagener Dump hinterließ damit eine unbrauchbare `.sql.gz`, die beim
nächsten Lauf als gültiges Backup zählte und ein funktionierendes verdrängte.

Das Wochen-Backup ist ein **eigener `pg_dump`** mit eigener Prüfung, keine
Kopie des Tages-Backups — sonst wurde aus einem korrupten Daily ein korruptes
Weekly.

---

## Backup manuell ausführen

```bash
# Einzelnes Backup sofort erstellen (Produktion)
docker compose exec db /backup.sh

# Einzelnes Backup sofort erstellen (Entwicklung)
docker compose -f docker-compose.dev.yml exec db /backup.sh
```

---

## Automatisches Backup via Cron (Host-Crontab)

Um täglich um 02:00 Uhr ein automatisches Backup zu erstellen, folgenden
Eintrag in die **Host-Crontab** eintragen (`crontab -e`):

```cron
# GoldRegenDB – tägliches Backup um 02:00 Uhr
0 2 * * * docker compose -f /pfad/zu/GoldRegenDB_Web_new/docker-compose.yml exec -T db /backup.sh >> /var/log/goldregendb_backup.log 2>&1
```

> **Hinweis:** `/pfad/zu/GoldRegenDB_Web_new` muss durch den tatsächlichen
> Pfad zum Projektverzeichnis ersetzt werden.

---

## Backup-Dateien auf den Host kopieren

Backups liegen im Docker-Volume `pgbackups`. Um sie auf den Host zu kopieren:

```bash
# Alle Backups auflisten
docker compose exec db ls -lh /backups/daily/ /backups/weekly/

# Einzelne Datei auf den Host kopieren
docker compose cp db:/backups/daily/goldregendb_20240101_020000.sql.gz ./

# Alle täglichen Backups auf den Host kopieren
docker compose cp db:/backups/daily ./backups_export/
```

---

## Wiederherstellung (`db/restore.sh`)

> ⚠️ **Achtung:** Die Wiederherstellung löscht alle aktuellen Daten und
> ersetzt sie durch den Stand des Backups.

> ⚠️ **Vorher den `app`-Container stoppen:**
>
> ```bash
> docker compose stop app
> ```
>
> `restore.sh` trennt per `pg_terminate_backend` alle Verbindungen zur
> Datenbank. Läuft das Backend weiter, reißt das seine Verbindung ab; es
> startet wegen `restart: always` neu und legt seine `ensureX`-Tabellen
> **parallel zum laufenden Restore** an. Die `CREATE TABLE` aus dem Dump
> treffen dann auf bereits existierende Tabellen, `ON_ERROR_STOP=1` bricht ab,
> und das Ergebnis ist eine **teilweise** wiederhergestellte Datenbank. Nach
> dem Restore wieder starten mit `docker compose start app`.

```bash
# Verfügbare Backups anzeigen
docker compose exec db /restore.sh

# Datenbank aus einem täglichen Backup wiederherstellen
docker compose exec db /restore.sh /backups/daily/goldregendb_20240101_020000.sql.gz

# Datenbank aus einem wöchentlichen Backup wiederherstellen
docker compose exec db /restore.sh /backups/weekly/goldregendb_weekly_20231231_020000.sql.gz
```

### Wiederherstellungs-Ablauf

1. **Das Archiv wird geprüft** (`gunzip -t` plus mindestens ein
   `CREATE TABLE` im Dump) — noch bevor irgendetwas gelöscht wird. Ist das
   Archiv unbrauchbar, bricht das Skript mit Exit ≠ 0 ab und die Datenbank
   bleibt **unangetastet**.
2. **Rückfrage** `Datenbank '…' wirklich ersetzen? [j/N]`. Für Skripte und
   Cronjobs mit `--yes` überspringbar; ohne Terminal und ohne `--yes` bricht
   das Skript ab statt blind zu löschen.
3. **Sicherheits-Dump** des aktuellen Stands nach `/backups/vor-restore/`
   (Verzeichnis über `SICHERUNG_DIR` konfigurierbar). Erweist sich das
   eingespielte Backup als das falsche, ist der bisherige Stand nicht verloren.
4. Alle bestehenden Verbindungen zur Datenbank werden getrennt.
5. Die Datenbank wird gelöscht (`DROP DATABASE`).
6. Eine neue, leere Datenbank wird angelegt (`CREATE DATABASE`).
7. Der SQL-Dump wird eingespielt (`psql -v ON_ERROR_STOP=1`).

Vorher wurde ausschließlich geprüft, ob die Datei *existiert*. Bei einem
korrupten Archiv war die Datenbank danach weg und der Restore scheiterte —
Ergebnis: eine **leere** Datenbank.

---

## Tamper-Schutz für audit_log (Issue #139)

`audit_log` protokolliert sicherheitsrelevante Änderungen an Schmuckstücken
(Verkauft, Ausgelagert, Ausschuss, …). Damit niemand mit DB-Zugriff Einträge
nachträglich löschen oder ändern kann, ohne Spuren zu hinterlassen:

- **Immutable-Trigger** (`trg_audit_log_immutable`): blockiert jedes UPDATE
  und DELETE auf `audit_log` mit einer Exception – unabhängig davon, welche
  Rolle den Befehl ausführt (auch der App-User selbst). Nur INSERT ist
  erlaubt.
- **Hash-Kette** (`trg_audit_log_hash_chain`): jede Zeile bekommt beim INSERT
  einen SHA-256-Hash über ihren Inhalt + den Hash der Vorgängerzeile
  (`previous_hash`). Wird die Immutabilität doch umgangen (z.B. weil ein
  Superuser den Trigger per `ALTER TABLE ... DISABLE TRIGGER` deaktiviert),
  bricht die Kette – das lässt sich erkennen, auch wenn der Trigger selbst
  ausgehebelt wurde.

**Kette prüfen** (als Admin, meldet leere Liste = intakt):

```sql
SELECT * FROM verify_audit_chain();
```

oder über die Admin-API: `GET /api/audit-log/verify` →
`{ "valid": true, "brokenEntries": [] }`. Ein Eintrag mit `problem:
"hash_mismatch"` bedeutet, die Zeile wurde nachträglich verändert; `problem:
"chain_broken"` bedeutet, eine Zeile fehlt (gelöscht) oder die Kette wurde an
dieser Stelle neu begonnen.

**Backup/Restore bleibt unverändert funktionsfähig:** `pg_dump` legt Trigger
im „post-data“-Abschnitt an, also erst *nachdem* alle Zeilen per `COPY`
geladen wurden – der Immutable-Trigger existiert während des Datenimports
schlicht noch nicht und blockiert nichts. `restore.sh` löscht davor zusätzlich
die gesamte Datenbank samt aller Trigger. Dieses Verhalten wurde gegen einen
echten PostgreSQL-16-Dump/Restore-Zyklus verifiziert.

**Bekannte Grenze:** Da Backend und Restore-Skripte denselben DB-User
(`POSTGRES_USER`, faktisch Owner/Superuser der DB) verwenden, kann dieser
User den Trigger theoretisch deaktivieren und wieder aktivieren – das ist
architektonisch bedingt (ein einzelner DB-User für alles) und nicht
vollständig verhinderbar, ohne einen dedizierten, rechte-eingeschränkten
App-User samt eigener Anbindung einzuführen (nicht Teil dieses Issues). Die
Hash-Kette macht einen solchen Eingriff aber nachträglich sichtbar statt ihn
spurlos zuzulassen.

---

## Backup-Strategie im Überblick

```
Tag 1  ──► daily/goldregendb_<tag1>.sql.gz
Tag 2  ──► daily/goldregendb_<tag2>.sql.gz
...
Tag 7  ──► daily/goldregendb_<tag7>.sql.gz  (+ weekly wenn Sonntag)
Tag 9  ──► Rotation löscht das Backup von Tag 1 (älter als 7 volle Tage)
...
Woche 5 ──► weekly/…  → Rotation löscht das Weekly von Woche 1
```

Gelöscht wird nach **Alter**, nicht nach Anzahl: `find -mtime +7` trifft
Dateien, deren Änderungszeit mehr als sieben volle 24-Stunden-Zeiträume
zurückliegt. Im Verzeichnis liegen dadurch bis zu **acht** tägliche Dumps —
mehrere Läufe am selben Tag verkürzen das Fenster nicht mehr. Verwaiste
`.tmp.*`-Dateien abgebrochener Läufe (älter als ein Tag) räumt die Rotation
mit weg.

**Maximaler Datenverlust:** 1 Tag (bei täglichen Backups)
**Aufbewahrungszeitraum:** mindestens 7 Tage täglich + 4 Wochen wöchentlich

---

## Um auf die Datenbank zu kommen:
```
sudo docker exec -it goldregendb_web_db_1 psql -U goldregen -d goldregendb
```


## Befehle
Alle Tabellen anzeigen:
\dt

Tabellenstruktur anzeigen:
\d tabellenname

Alle Daten aus einer Tabelle anzeigen:
SELECT * FROM tabellenname;

Datenbank verlassen:
\q

Liste aller Datenbanken:
\l

Aktuelle Datenbank anzeigen:
\conninfo

Hilfe zu SQL-Befehlen:
\h



# oder `pgAdmin` nutzen

---

## JSON zu SQL konvertieren (`db/json_to_sql.py`)

Das Skript wandelt Backup-JSON-Dateien in PostgreSQL-`INSERT`-Statements um.
Es unterstützt:

- Standard-Backup-Format mit `tables`
- Array-Export-Format mit `type: "table"`
- direktes Tabellen-Dictionary

### Beispiele

```bash
# JSON automatisch nach <datei>.sql konvertieren
python3 db/json_to_sql.py /pfad/zum/backup.json

# Mit expliziter Zieldatei
python3 db/json_to_sql.py /pfad/zum/backup.json ./seed_from_backup.sql

# Nur bestimmte Tabelle konvertieren
python3 db/json_to_sql.py /pfad/zum/backup.json ./kunde.sql --table Kunde

# Tabelle ausschließen
python3 db/json_to_sql.py /pfad/zum/backup.json ./ohne_audit.sql --exclude-table audit_log

# Vor Import Zieltabellen leeren
python3 db/json_to_sql.py /pfad/zum/backup.json ./full.sql --truncate-first
```

### Nützliche Optionen

- `--batch-size 500` (Default): Anzahl Zeilen pro `INSERT`
- `--no-transaction`: erzeugt kein `BEGIN/COMMIT`
- `--no-header`: unterdrückt SQL-Kommentar-Header
- `--disable-triggers`: erzeugt bei Tabelle `Schmuckstück` vor dem Import `DISABLE TRIGGER ALL` und danach `ENABLE TRIGGER ALL`
- `--reset-sequences`: erzeugt am Ende `setval(...)` für bekannte `SERIAL`-Spalten (`Kunde`, `Lieferschein`, `Rechnung`, `audit_log`, `app_users`)

### Import-nahe Ausgabe wie in `seed_old.sql`

```bash
python3 db/json_to_sql.py /pfad/zum/backup.json ./seed_from_backup.sql \
  --truncate-first \
  --disable-triggers \
  --reset-sequences
```