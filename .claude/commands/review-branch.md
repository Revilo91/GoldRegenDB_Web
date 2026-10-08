---
description: Prüft die Änderungen des aktuellen Branches gegen main anhand der Projektregeln
argument-hint: "[basis-branch]"
allowed-tools: Bash(git status*), Bash(git log*), Bash(git diff*), Bash(git merge-base*)
---

Prüfe die Änderungen des aktuellen Branches. Basis-Branch: `$ARGUMENTS` (leer = `origin/main`).

1. Umfang ermitteln: `git status`, `git log --oneline <basis>..HEAD`, `git diff <basis>...HEAD`.
2. Review an den Subagenten `code-reviewer` geben. Auftrag vollständig: Ziel, geänderte Dateien, erwartetes Ergebnisformat.
3. Berührt der Diff Auth, SQL, Uploads, Secrets, Backup/Restore oder öffentliche Endpunkte: zusätzlich `security-auditor`, parallel.
4. Ergebnisse nicht ungeprüft übernehmen: Diff selbst lesen, Befunde zusammenführen, Doppelte streichen.

Ausgabe:

- Befunde nach Schwere: **Blocker**, **Sollte**, **Hinweis**. Jeweils `datei:zeile`, Begründung, konkreter Vorschlag.
- Zum Schluss die Prüfbefehle, die vor dem Merge grün sein müssen: `cd backend && npm test && npm run lint && npm run typecheck`, `cd frontend && npm test && npm run lint`

Nichts ändern, nichts committen.
