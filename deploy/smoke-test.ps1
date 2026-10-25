# =============================================================================
# smoke-test.ps1 – Windows-Pendant zu smoke-test.sh: startet die Release-Assets mit einem Image und prüft /api/health
#
# Verwendung: powershell -ExecutionPolicy Bypass -File deploy\smoke-test.ps1 <assets-dir> <image-ref>
#   <assets-dir>  Ordner mit docker-compose.yml, .env.example und ggf. weiteren Release-Assets
#   <image-ref>   komplette Image-Referenz, z. B. ghcr.io/revilo91/beispiel:ci-123
#
# Optionale Umgebung:
#   SMOKE_TIMEOUT_S  Sekunden bis /api/health 200 liefern muss (Default 120)
#   SMOKE_POLL_S     Pause zwischen den Versuchen (Default 3)
#   SMOKE_APP_PORT   Host-Port der App (Default 18080)
#
# Läuft unter Windows PowerShell 5.1 und PowerShell 7+ mit Docker Desktop (Linux-Container).
# Das App-Image muss lokal vorliegen (docker load / docker build) – es wird nie aus der Registry gezogen.
# Alles läuft in einem eigenen, temporären Compose-Projekt; aufgeräumt wird immer,
# `down -v` trifft nur dieses Projekt. Exit 0 = gesund, 1 = Fehler.
# =============================================================================
#Requires -Version 5.1
param(
  [Parameter(Position = 0)][string]$AssetsDir,
  [Parameter(Position = 1)][string]$ImageRef
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($AssetsDir) -or [string]::IsNullOrEmpty($ImageRef)) {
  [Console]::Error.WriteLine('FEHLER: Verwendung: smoke-test.ps1 <assets-dir> <image-ref>')
  exit 1
}

# Zahl aus Umgebungsvariable; leer = Default (wie ${VAR:-Default} in der Shell-Version).
function Get-ZahlAusEnv([string]$Name, [string]$Default) {
  $wert = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrEmpty($wert)) { $wert = $Default }
  if ($wert -notmatch '^[0-9]+$') { throw "$Name muss eine Zahl sein." }
  return [int]$wert
}

# Führt einen nativen Befehl aus und liefert $true bei Exit 0; stderr bleibt ohne Fehlerabbruch.
function Test-Befehl([scriptblock]$Befehl) {
  $vorher = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Befehl *> $null } finally { $ErrorActionPreference = $vorher }
  return ($LASTEXITCODE -eq 0)
}

# UTF-8 ohne BOM, Zeilenende LF wie bei den Compose-/Env-Dateien aus dem Release.
function Write-Utf8([string]$Pfad, [string[]]$Zeilen) {
  [System.IO.File]::WriteAllLines($Pfad, $Zeilen, (New-Object System.Text.UTF8Encoding $false))
}

# Ersetzt KEY=... oder hängt KEY=WERT an.
function Set-EnvWert([string]$Datei, [string]$Key, [string]$Wert) {
  $gefunden = $false
  $zeilen = @(Get-Content -LiteralPath $Datei -Encoding UTF8)
  $neu = @(foreach ($zeile in $zeilen) {
    if ($zeile -match "^$Key=") { $gefunden = $true; "$Key=$Wert" } else { $zeile }
  })
  if (-not $gefunden) { $neu += "$Key=$Wert" }
  Write-Utf8 $Datei $neu
}

# 32 Byte Zufall als 64 Hex-Zeichen (entspricht openssl rand -hex 32, ohne openssl).
function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# HTTP-Statuscode ohne Exception bei 4xx/5xx; 0 bei Verbindungsfehler.
function Get-HttpStatus([string]$Url) {
  try {
    $antwort = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return [int]$antwort.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

$TimeoutS = Get-ZahlAusEnv 'SMOKE_TIMEOUT_S' '120'
$PollS = Get-ZahlAusEnv 'SMOKE_POLL_S' '3'
$AppPort = Get-ZahlAusEnv 'SMOKE_APP_PORT' '18080'

if (-not (Test-Path -LiteralPath $AssetsDir -PathType Container)) {
  [Console]::Error.WriteLine("FEHLER: Assets-Ordner '$AssetsDir' existiert nicht.")
  exit 1
}
$Assets = (Resolve-Path -LiteralPath $AssetsDir).Path
foreach ($datei in 'docker-compose.yml', '.env.example') {
  if (-not (Test-Path -LiteralPath (Join-Path $Assets $datei))) {
    [Console]::Error.WriteLine("FEHLER: Release-Asset $datei fehlt in $Assets")
    exit 1
  }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  [Console]::Error.WriteLine('FEHLER: docker nicht gefunden.')
  exit 1
}

# Eindeutiger Projektname: `down -v` darf nie fremde Stacks treffen.
$Projekt = "smoke-$PID-$(Get-Random)"
$TempBasis = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$Arbeit = Join-Path $TempBasis ('smoke.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$Paket = Join-Path $Arbeit 'install'
$CompFile = Join-Path $Paket 'docker-compose.yml'
$OverrideFile = Join-Path $Paket 'override.yml'
$EnvFile = Join-Path $Paket '.env'
$Erfolg = $false
$Gestartet = $false
$Ergebnis = 1

# Alle Compose-Aufrufe laufen über das eigene Projekt und die Override-Datei.
function Invoke-Compose {
  & docker compose -f $CompFile -f $OverrideFile -p $Projekt @args
}

function Invoke-Aufraeumen {
  try {
    if ($Gestartet) {
      if (-not $Erfolg) {
        Write-Host '---- docker compose logs ----'
        Invoke-Compose 'logs' '--no-color'
      }
      Invoke-Compose 'down' '-v' '--remove-orphans'
      # data/postgres gehört dem postgres-Benutzer im Container – daher dort löschen.
      & docker run --rm -v "${Arbeit}:/arbeit" postgres:16-alpine rm -rf /arbeit/install *> $null
    }
  } catch {
    Write-Warning "Aufräumen unvollständig: $($_.Exception.Message)"
  }
  if (Test-Path -LiteralPath $Arbeit) {
    Remove-Item -LiteralPath $Arbeit -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  New-Item -ItemType Directory -Force -Path $Arbeit | Out-Null
  New-Item -ItemType Directory -Force -Path $Paket | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Paket 'data/postgres'), (Join-Path $Paket 'backups') | Out-Null

  # Alle Release-Assets übernehmen: Projekte binden weitere Dateien ein (z. B. ein Caddyfile).
  Copy-Item -Path (Join-Path $Assets '*') -Destination $Paket -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $Paket '.env.example') -Destination $EnvFile -Force

  # Image-Override statt Tag-Gefrickel: die Compose-Datei bleibt unverändert, wie im Release.
  Write-Utf8 $OverrideFile @('services:', '  app:', "    image: $ImageRef")

  # Leere Secrets wie install.sh erzeugen.
  $secretKeys = @(Get-Content -LiteralPath (Join-Path $Paket '.env.example') -Encoding UTF8 |
    Where-Object { $_ -cmatch '^[A-Z][A-Z0-9_]*(SECRET|PASSWORD|TOKEN|KEY)[A-Z0-9_]*=$' } |
    ForEach-Object { $_.Split('=')[0] })
  foreach ($key in $secretKeys) { Set-EnvWert $EnvFile $key (New-Secret) }
  # APP_VERSION ist in der Compose-Datei Pflicht (${APP_VERSION:?}), das Image kommt aus dem Override.
  Set-EnvWert $EnvFile 'APP_VERSION' 'smoke'
  Set-EnvWert $EnvFile 'APP_PORT' "$AppPort"
  $leer = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -match '^[^#]*=$' })
  if ($leer.Count -gt 0) {
    $leer | ForEach-Object { Write-Host $_ }
    Write-Host 'Hinweis: leere Variablen in der .env (siehe oben) – Pflichtwerte fehlen ggf. im Test.'
  }

  if (-not (Test-Befehl { docker image inspect $ImageRef })) {
    throw "$ImageRef liegt lokal nicht vor (docker load oder docker build)"
  }
  Write-Host "Teste $ImageRef mit den Release-Assets aus $Assets (Projekt $Projekt)"

  $Gestartet = $true
  # Alle Dienste außer der App aus der Registry ziehen (db, ggf. Proxy wie caddy); die App kommt lokal.
  $andereDienste = @(Invoke-Compose 'config' '--services' | Where-Object { $_ -and $_ -ne 'app' })
  if ($andereDienste.Count -gt 0) { Invoke-Compose 'pull' '--quiet' @andereDienste }
  Invoke-Compose 'up' '-d' '--pull' 'never'
  if ($LASTEXITCODE -ne 0) { throw 'docker compose up ist fehlgeschlagen.' }

  $url = "http://127.0.0.1:$AppPort/api/health"
  Write-Host "Warte auf $url (max. ${TimeoutS}s) ..."
  $verstrichen = 0
  while ((Get-HttpStatus $url) -ne 200) {
    if ($verstrichen -ge $TimeoutS) { throw "/api/health liefert nach ${TimeoutS}s kein 200" }
    Start-Sleep -Seconds $PollS
    $verstrichen += $PollS + 1
  }
  Write-Host 'ok   /api/health'

  $Erfolg = $true
  Write-Host 'Smoke-Test bestanden.'
  $Ergebnis = 0
} catch {
  [Console]::Error.WriteLine("FEHLER: $($_.Exception.Message)")
} finally {
  Invoke-Aufraeumen
}

exit $Ergebnis
