---
name: deploy
description: Release bauen und auf der Synology NAS installieren, aktualisieren oder zurückrollen (Tag vX.Y.Z, GitHub-Release, install.sh). Verwenden bei Fragen zu Release, Deployment, Update, Rollback oder neuen Produktions-Variablen.
---

# Deploy (Release → Synology)

Der Ablauf ist in allen Projekten gleich. Die Projektwerte (Image, Port, Ordner, Secrets, Prüfbefehle, Doku) stehen in [deploy-config.md](deploy-config.md). Diese Datei zuerst lesen.

## Grenzen

- Tag pushen und alles auf der NAS nur nach ausdrücklichem OK.
- Claude führt nichts auf der NAS aus. NAS-Befehle gibt Claude zum Kopieren aus.
- Secrets nie ausgeben und nie committen. `.env` nicht lesen.

## Release bauen

1. Stand prüfen: `main` ist aktuell, das Arbeitsverzeichnis sauber, die CI auf `main` grün (`gh run list --branch main --limit 3`).
2. Prüfbefehle aus deploy-config.md ausführen und die Ausgabe zeigen.
3. Neue Produktions-Variablen? Die Regel dazu steht in deploy-config.md.
4. Version nach SemVer vorschlagen (letzter Tag: `git describe --tags --abbrev=0`) und auf OK warten.
5. Nach OK: `git tag vX.Y.Z` und `git push origin vX.Y.Z`. Der Tag startet `.github/workflows/release.yml`.
6. Lauf verfolgen (`gh run watch`) und das Release prüfen (`gh release view vX.Y.Z`): alle Release-Dateien aus deploy-config.md müssen angehängt sein.

## Installation und Update auf der NAS

Per SSH auf der NAS. Den Befehl für dieses Projekt aus deploy-config.md ausgeben. Der Installer sichert vorher die Datenbank, behält das laufende Image als `:previous` und rollt bei fehlgeschlagenem Health-Check automatisch zurück.

## Rollback

`sudo bash install.sh --rollback` (zurück auf die Version vor dem letzten Update). Eine bestimmte Version: `sudo bash install.sh vX.Y.Z`.

## Wenn etwas schiefgeht

- Release-Workflow rot: fehlgeschlagenen Job lesen (`gh run view --log-failed`), Ursache auf einem Branch beheben, neuen Tag vergeben. Bestehende Tags nicht verschieben.
- Health-Check auf der NAS schlägt fehl: Der Installer hat zurückgerollt. Logs im Installationsordner: `docker compose logs app`.
- `install.sh` ist in allen Projekten identisch bis auf den Konfigurationskopf. Änderungen am Ablauf deshalb in allen Projekten nachziehen.
