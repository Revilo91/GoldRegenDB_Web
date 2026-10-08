# Arbeitsweise

Gilt in jeder Session und für alle Dateien. Der allgemeine Teil ist in allen Projekten gleich.

## Arbeitsablauf (immer in dieser Reihenfolge)

1. **Verstehen**: Bei unklarer Anforderung genau EINE Rückfrage stellen.
2. **Planen**: Bei mehr als 2 Dateien oder neuer Architektur zuerst einen kurzen Plan zeigen und auf OK warten.
3. **Test zuerst**: Erst fehlschlagenden Test schreiben, dann Implementierung (TDD), wo sinnvoll.
4. **Klein umsetzen**: Ein Schritt = ein Commit. Keine Sammel-Änderungen.
5. **Prüfen**: Tests/Linter/Build wirklich ausführen, bevor "fertig" gesagt wird. Ausgabe zeigen.
6. **Zusammenfassen**: 2–3 Zeilen: was geht jetzt, wie ausprobieren, was ist offen.

## Grenzen (nicht ohne Rückfrage)

- Keine Änderungen außerhalb des besprochenen Umfangs (kein "nebenbei" Refactoring).
- Keine neuen Abhängigkeiten ohne Begründung (Standardbibliothek zuerst).
- Keine destruktiven Aktionen: `rm -rf`, `git push --force`, `git reset --hard`, DB-Migrationen, Löschen von Dateien.
- Keine Secrets, Passwörter, Tokens im Code oder in Commits. Immer `.env` / Secret-Store, `.env` in `.gitignore`.
- Keine Netzwerk-/Systemänderungen an Proxmox, Home Assistant oder NAS ohne ausdrückliches OK.

Technisch abgesichert durch `.claude/hooks/validate-bash.sh` (eingetragen in `.claude/settings.json`): blockt Pushes auf `main`, fragt nach bei `rm -rf`, `git reset --hard`, `git clean -f`, `git push --force` und `docker compose down -v`.

## Git

- Commits nach Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Eine logische Änderung pro Commit, Betreff maximal 72 Zeichen, Imperativ.
- Feature-Arbeit auf eigenem Branch, nie direkt auf `main`.
- Vor Commit: `git diff` prüfen, keine Debug-Reste, keine Secrets.

## Debugging

- Erst reproduzieren, dann Ursache finden, dann fixen. Kein Raten und Herumprobieren.
- Nach 3 erfolglosen Versuchen: stoppen, Annahme benennen, die vermutlich falsch ist, EINE Diagnosefrage stellen.
- Root Cause beheben, nicht das Symptom.

## Arbeiten mit KI (Vibe-Coding-Regeln für mich)

- Ich bleibe verantwortlich: jeden KI-Diff lesen, bevor er committet wird.
- Kleine, klar beschriebene Aufgaben statt "bau mir alles".
- Kontext geben: Ziel, Randbedingungen, Beispiel für erwartetes Verhalten.
- Bei langem Chat mit Drift: neue Session starten, Stand in 5 Zeilen zusammenfassen.
- Wiederkehrende Fehler der KI hier in die Datei eintragen (Abschnitt „Gelernte Korrekturen“).
- Sessionende: Wurde ich korrigiert oder ist derselbe Fehler zweimal passiert, schlage genau EINE Zeile für den Abschnitt „Gelernte Korrekturen“ vor (Datum, Fehler → Regel). Nur nach meinem OK eintragen, als eigener Commit `docs:`.

## Gelernte Korrekturen (laufend ergänzen)

- _(noch leer)_

## Delegation & Modellwahl (nur Claude Code)

- Hauptagent: plant, delegiert, prüft, spricht mit mir. Umfangreiche oder parallele Arbeit macht ein Subagent.
- Selbst erledigen (kein Subagent): Rückfragen an mich, Pläne, Einzeiler, eine einzelne Datei lesen, Commit, Endkontrolle.
- Parallel nur bei unabhängigen Aufgaben (keine gemeinsamen Dateien).
- Auftrag an Subagenten immer vollständig: Ziel, betroffene Dateien, erwartetes Ergebnisformat, Grenzen aus dem Abschnitt „Grenzen“.
- Ergebnis nie ungeprüft übernehmen: Diff lesen, Tests selbst ausführen (Abschnitt „Arbeitsablauf“, Schritt 5).
- Haupt-KI hat immer das letzte Wort: Subagenten ändern nur Dateien und committen nie; den Commit für ihre Änderungen macht die Haupt-KI nach Diff-Prüfung und Tests.

Modellwahl (Aliase `haiku`, `sonnet`, `opus` nutzen, keine Versionsnummern):
- **haiku**: Dateien suchen/lesen, Logs zusammenfassen, Formatierung, Doku-Kleinkram.
- **sonnet** (Standard): Implementieren, Tests schreiben, Refactoring, Code-Review.
- **opus**: Architektur, schwieriges Debugging, Security-Review, oder wenn sonnet nach 3 Versuchen scheitert (Abschnitt „Debugging“).
- Im Zweifel eine Stufe niedriger starten, bei Misserfolg hochstufen.

## Git in diesem Projekt

**Commit-Stil (bisect-freundlich):**
- Kleine, atomare Commits: eine logische Änderung pro Commit
- Jeder Commit ist für sich lauffähig (Tests grün, App startet), damit `git bisect` eindeutig gut/schlecht liefert
- Code, zugehörige Tests und Doku einer Änderung gehören in denselben Commit; unabhängige Änderungen in eigene Commits
- Regeländerungen (CLAUDE.md, `.claude/rules/`) vorab und getrennt von der Code-Änderung committen

**Branches:**
- Nach GitHub wird **nur über eigene Branches** gepusht (`feat/…`, `fix/…`, `docs/…`), nie direkt auf `main`
- `main` ändert sich ausschließlich über Pull Requests; lokale Commits auf `main` vor dem Push auf einen Branch verschieben
