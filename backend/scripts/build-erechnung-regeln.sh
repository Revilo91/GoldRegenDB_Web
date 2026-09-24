#!/usr/bin/env bash
# Erzeugt die Prüfartefakte unter src/assets/erechnung/ neu (XSD + vorkompilierte Schematron-Regeln).
# Nachbau der Build-Schritte von itplr-kosit/xrechnung-schematron bzw. validator-configuration-xrechnung:
#   - EN-16931-Schematron (CII) aus ConnectingEurope/eInvoicing-EN16931 (fertiges XSLT)
#   - XRechnung-Schematron (CII) + übernommene Peppol-BIS-Regeln, kompiliert mit SchXslt
#   - beide XSLT → SaxonJS-SEF (gzip), damit die Prüfung ohne Java im Backend läuft
# Benötigt: git, curl, java (11+), node/npx. Versionen bei neuen Releases hier anpassen.
set -euo pipefail

EN16931_TAG=validation-1.3.16
XRECHNUNG_SCHEMATRON_TAG=v2.6.0
XRECHNUNG_VERSION=3.0.2
PEPPOL_BRANCH=2026-Q2-QA2          # Peppol BIS Billing 3.0.21 (so im xrechnung-schematron-Build referenziert)
SAXON_VERSION=12.5
XMLRESOLVER_VERSION=5.2.2
SCHXSLT_VERSION=1.10.1

ZIEL="$(cd "$(dirname "$0")/.." && pwd)/src/assets/erechnung"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
cd "$ARBEIT"

MAVEN=${MAVEN_MIRROR:-https://repo.maven.apache.org/maven2}
# Optional JAR_CACHE=<ordner> mit bereits geladenen Jars (gleiche Dateinamen) – spart Downloads
laden() {
  if [ -n "${JAR_CACHE:-}" ] && [ -f "$JAR_CACHE/$1" ]; then cp "$JAR_CACHE/$1" "$1"; return; fi
  curl -sSfL --retry 6 --retry-delay 10 --retry-all-errors -o "$1" "$2"
}
laden saxon.jar "$MAVEN/net/sf/saxon/Saxon-HE/$SAXON_VERSION/Saxon-HE-$SAXON_VERSION.jar"
laden xmlresolver.jar "$MAVEN/org/xmlresolver/xmlresolver/$XMLRESOLVER_VERSION/xmlresolver-$XMLRESOLVER_VERSION.jar"
laden schxslt.jar "$MAVEN/name/dmaus/schxslt/schxslt/$SCHXSLT_VERSION/schxslt-$SCHXSLT_VERSION.jar"
mkdir schxslt && (cd schxslt && unzip -q ../schxslt.jar)
saxon() { java -cp saxon.jar:xmlresolver.jar net.sf.saxon.Transform "$@"; }

git clone -q --depth 1 -b "$EN16931_TAG" https://github.com/ConnectingEurope/eInvoicing-EN16931.git en16931
git clone -q --depth 1 -b "$XRECHNUNG_SCHEMATRON_TAG" https://github.com/itplr-kosit/xrechnung-schematron.git xr
git clone -q --depth 1 -b "$PEPPOL_BRANCH" https://github.com/OpenPEPPOL/peppol-bis-invoice-3.git peppol

# XRechnung: Platzhalter ersetzen, Peppol-Regeln einmischen (src/xsl/peppol-into-xr.xsl erwartet build/bis/)
mkdir -p xr/build/bis xr/build/schematron/tmp xr/build/schematron/cii
cp peppol/rules/sch/PEPPOL-EN16931-*.sch xr/build/bis/
cp xr/src/validation/schematron/common.sch xr/build/schematron/
sed -e "s/@xr-schematron.version.full@/${XRECHNUNG_SCHEMATRON_TAG#v}/g" -e "s/@xrechnung.version@/$XRECHNUNG_VERSION/g" \
  xr/src/validation/schematron/cii/XRechnung-CII-validation.sch > xr/build/schematron/tmp/XRechnung-CII-validation.sch
saxon -s:xr/build/schematron/tmp/XRechnung-CII-validation.sch -xsl:xr/src/xsl/peppol-into-xr.xsl \
  -o:xr/build/schematron/cii/XRechnung-CII-validation.sch syntax=CII
saxon -s:xr/build/schematron/cii/XRechnung-CII-validation.sch -xsl:schxslt/xslt/2.0/pipeline-for-svrl.xsl \
  -o:XRechnung-CII-validation.xsl

cp en16931/cii/xslt/EN16931-CII-validation.xslt EN16931-CII-validation.xsl
for name in EN16931-CII-validation XRechnung-CII-validation; do
  npx --yes xslt3 -xsl:"$name.xsl" -export:"$name.sef.json" -nogo
  gzip -9 -c "$name.sef.json" > "$ZIEL/schematron/$name.sef.json.gz"
done

cp "en16931/cii/schema/D16B SCRDM (Subset)/uncoupled clm/CII/uncefact/data/standard/"*.xsd "$ZIEL/xsd/"
echo "Prüfartefakte aktualisiert: $ZIEL"
