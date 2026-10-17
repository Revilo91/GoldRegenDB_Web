#!/usr/bin/env bash
# PreToolUse-Hook für das Bash-Tool, eingetragen in .claude/settings.json.
# Setzt die Grenzen aus .claude/rules/arbeitsweise.md technisch durch:
#   blockt       Push auf main/master
#   fragt nach   rm -rf, git reset --hard, git clean -f, git push --force,
#                docker compose down -v
# Eingabe: Hook-JSON auf stdin (Feld tool_input.command).
# Ausgabe: Exit 2 + stderr blockt; JSON mit permissionDecision "ask" fragt nach.
# In allen Projekten identisch. Test: backend/__tests__/claudeHook.test.js

set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "validate-bash.sh: node fehlt, Befehl wurde nicht geprüft" >&2
  exit 1
fi

befehl=$(node -e '
let eingabe = "";
process.stdin.on("data", (teil) => { eingabe += teil; }).on("end", () => {
  try {
    process.stdout.write(String(JSON.parse(eingabe).tool_input?.command ?? ""));
  } catch {
    process.exit(3);
  }
});') || {
  echo "validate-bash.sh: Hook-Eingabe ist kein gültiges JSON" >&2
  exit 1
}
[ -z "$befehl" ] && exit 0

blockgrund=""
fragegrund=""

merke_frage() {
  [ -z "$fragegrund" ] && fragegrund="$1"
  return 0
}

aktueller_branch() {
  git ${1:+-C "$1"} symbolic-ref --quiet --short HEAD 2>/dev/null
}

ist_hauptbranch() {
  [ "$1" = "main" ] || [ "$1" = "master" ]
}

pruefe_git_push() {
  local verzeichnis="$1"
  shift
  local wort ziel erzwungen="" nur_tags="" positionsargumente=0
  for wort in "$@"; do
    case "$wort" in
      --force | -f | --force-with-lease* | --force-if-includes) erzwungen=1 ;;
      --tags) nur_tags=1 ;;
      -*) ;;
      *)
        positionsargumente=$((positionsargumente + 1))
        # Erstes Positionsargument ist das Remote, alle weiteren sind Refspecs.
        if [ "$positionsargumente" -gt 1 ]; then
          [ "${wort#+}" != "$wort" ] && erzwungen=1
          ziel="${wort##*:}"
          ziel="${ziel#+}"
          ziel="${ziel#refs/heads/}"
          if ist_hauptbranch "$ziel"; then
            blockgrund="Push auf '$ziel' ist gesperrt. Eigenen Branch pushen und Pull Request öffnen."
          fi
        fi
        ;;
    esac
  done
  if [ "$positionsargumente" -le 1 ] && [ -z "$nur_tags" ]; then
    ziel=$(aktueller_branch "$verzeichnis")
    if ist_hauptbranch "$ziel"; then
      blockgrund="Der aktuelle Branch ist '$ziel': Push ist gesperrt. Eigenen Branch anlegen und Pull Request öffnen."
    fi
  fi
  [ -n "$erzwungen" ] && merke_frage "git push --force überschreibt die Historie auf dem Remote."
  return 0
}

pruefe_git() {
  local verzeichnis=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -C) verzeichnis="${2:-}"; shift 2 || return 0 ;;
      -c) shift 2 || return 0 ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  local unterbefehl="${1:-}"
  [ $# -gt 0 ] && shift
  local wort
  case "$unterbefehl" in
    push) pruefe_git_push "$verzeichnis" "$@" ;;
    reset)
      for wort in "$@"; do
        [ "$wort" = "--hard" ] && merke_frage "git reset --hard verwirft nicht committete Änderungen."
      done
      ;;
    clean)
      for wort in "$@"; do
        case "$wort" in
          --force) merke_frage "git clean -f löscht nicht versionierte Dateien." ;;
          --*) ;;
          -*f*) merke_frage "git clean -f löscht nicht versionierte Dateien." ;;
        esac
      done
      ;;
  esac
  return 0
}

pruefe_rm() {
  local wort rekursiv="" erzwungen=""
  for wort in "$@"; do
    case "$wort" in
      --recursive) rekursiv=1 ;;
      --force) erzwungen=1 ;;
      --*) ;;
      -*)
        case "$wort" in *[rR]*) rekursiv=1 ;; esac
        case "$wort" in *f*) erzwungen=1 ;; esac
        ;;
    esac
  done
  [ -n "$rekursiv" ] && [ -n "$erzwungen" ] && merke_frage "rm -rf löscht rekursiv ohne Rückfrage."
  return 0
}

pruefe_compose() {
  local wort herunterfahren="" volumes=""
  for wort in "$@"; do
    case "$wort" in
      down) herunterfahren=1 ;;
      -v | --volumes) volumes=1 ;;
    esac
  done
  [ -n "$herunterfahren" ] && [ -n "$volumes" ] && merke_frage "docker compose down -v löscht die Volumes samt Datenbank."
  return 0
}

pruefe_teilbefehl() {
  local -a worte
  read -ra worte <<<"$1"
  # Vorangestellte Klammern, sudo und Variablenzuweisungen überspringen.
  while [ ${#worte[@]} -gt 0 ]; do
    case "${worte[0]}" in
      sudo | "(" | "{" | *=*) worte=("${worte[@]:1}") ;;
      *) break ;;
    esac
  done
  [ ${#worte[@]} -eq 0 ] && return 0
  local programm="${worte[0]#(}"
  local -a rest=("${worte[@]:1}")
  case "$programm" in
    rm) pruefe_rm "${rest[@]}" ;;
    git) pruefe_git "${rest[@]}" ;;
    docker-compose) pruefe_compose "${rest[@]}" ;;
    docker) [ "${rest[0]:-}" = "compose" ] && pruefe_compose "${rest[@]:1}" ;;
  esac
  return 0
}

# Verkettete Befehle (&&, ||, ;, |, Zeilenumbruch) einzeln prüfen.
teilbefehle=${befehl//&&/$'\n'}
teilbefehle=${teilbefehle//||/$'\n'}
teilbefehle=${teilbefehle//;/$'\n'}
teilbefehle=${teilbefehle//|/$'\n'}
while IFS= read -r teilbefehl; do
  pruefe_teilbefehl "$teilbefehl"
done <<<"$teilbefehle"

if [ -n "$blockgrund" ]; then
  echo "Blockiert: $blockgrund" >&2
  exit 2
fi

if [ -n "$fragegrund" ]; then
  GRUND="$fragegrund" node -e '
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: process.env.GRUND,
  },
}));'
fi
exit 0
