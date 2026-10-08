---
description: Behebt ein GitHub-Issue nach dem Projekt-Arbeitsablauf (Test zuerst, eigener Branch)
argument-hint: "<issue-nummer>"
disable-model-invocation: true
---

Behebe GitHub-Issue #$ARGUMENTS im Repository `Revilo91/GoldRegenDB_Web`.

1. Issue lesen: `gh issue view $ARGUMENTS --comments`. Bei unklarer Anforderung genau EINE Rückfrage stellen.
2. Fehler reproduzieren und Ursache benennen (Root Cause, nicht das Symptom). Bei mehr als 2 betroffenen Dateien kurzen Plan zeigen und auf OK warten.
3. Branch `fix/$ARGUMENTS-<kurzname>` von `main` anlegen.
4. Test schreiben, der den Fehler reproduziert und fehlschlägt (Backend: `backend/__tests__/`, Frontend: `frontend/src/__tests__/`).
5. Kleinste Änderung umsetzen, die den Test grün macht. Kein Refactoring nebenbei.
6. Prüfen und Ausgabe zeigen: `cd backend && npm test && npm run lint && npm run typecheck`, `cd frontend && npm test && npm run lint`
7. Commit `fix: <Betreff> (#$ARGUMENTS)` mit Code und Test im selben Commit. Push und Pull Request erst nach OK.

Zum Schluss in 2–3 Zeilen: was jetzt geht, wie ausprobieren, was offen ist.
