# Output templates (German)

Read only the section for the active mode. Placeholders are in `<…>`. Omit sections that do not apply instead of filling them with "n/a". Default scales are replaced by entries in `conventions.md`.

## Contents

1. Testentwurf (Mode 1)
2. Fehlerbericht (Mode 2)
3. Rückverfolgbarkeitsmatrix (Mode 3)
4. Produktrisikoanalyse (Mode 3)
5. Testschätzung (Mode 3)
6. Testfortschrittsbericht (Mode 3)
7. Testabschlussbericht (Mode 3)
8. Teststrategie / Testkonzept (Mode 3)
9. Testautomatisierung (Mode 4)

## Default scales

- **Priorität (Testfall / Fehlerbehebung):** Hoch / Mittel / Niedrig
- **Schweregrad:** Blockierend / Kritisch / Schwerwiegend / Gering
- **Fehlerstatus (CTFL 4.0):** offen, zurückgestellt, doppelt, auf Behebung wartend, auf Fehlernachtest wartend, wiedereröffnet, geschlossen, zurückgewiesen
- **Ampelstatus:** Grün = im Plan, Endekriterien erreichbar, keine offenen blockierenden/kritischen Fehler · Gelb = Abweichung mit wirksamer Gegenmaßnahme, Termin oder Endekriterien gefährdet · Rot = Endekriterien ohne Eskalation nicht erreichbar oder blockierende Fehler offen

---

## 1. Testentwurf

````markdown
## Review der Testbasis
| # | Fundstelle | Befund | Offene Frage |
|---|---|---|---|
| 1 | <AK-2> | <mehrdeutig / fehlt / widersprüchlich> | <Frage an PO> |

## Testbedingungen
| TB-ID | Testbedingung | Anforderung | Risikostufe |
|---|---|---|---|
| TB-01 | <was geprüft wird> | <US-123 / AK-1> | Hoch |

## Ableitung
### Äquivalenzklassen – <Datenelement>
| ÄK-ID | Klasse | gültig/ungültig | Repräsentant |
|---|---|---|---|

### Grenzwertanalyse (<2-Wert|3-Wert>) – <Datenelement>
| Grenze | Testwerte |
|---|---|

### Entscheidungstabelle – <Geschäftsregel>
| | R1 | R2 | R3 |
|---|---|---|---|
| **Bedingung:** <…> | J | J | N |
| **Aktion:** <…> | X | – | – |

### Zustandsübergänge – <Objekt>
| Ausgangszustand | Ereignis [Bedingung] | Aktion | Folgezustand |
|---|---|---|---|

## Testfälle
| Test-ID | Titel | TB / Anforderung | Vorbedingungen & Testdaten | Testschritte | Erwartetes Ergebnis | Priorität | Testverfahren |
|---|---|---|---|---|---|---|---|
| TC-001 | <…> | TB-01 / AK-1 | <…> | 1) <…> 2) <…> | <…> | Hoch | Grenzwertanalyse (3-Wert) |

## Gherkin (nur für Regeln/Abläufe, die nicht schon vollständig in der Tabelle stehen)
```gherkin
Feature: Anmeldung

  Scenario Outline: Passwortlänge wird geprüft
    Given der Benutzer ist auf der Anmeldeseite
    When er das Passwort "<passwort>" eingibt
    Then wird "<meldung>" angezeigt

    Examples:
      | passwort | meldung |
```

## Überdeckung
<z. B. 100 % Äquivalenzklassenüberdeckung; 3-Wert-Grenzwertanalyse für Feld X; alle Regeln der Entscheidungstabelle>

## Annahmen & offene Fragen
- **Annahme:** <…>
````

## 2. Fehlerbericht

````markdown
### [<Komponente>] <kurze Zusammenfassung der Anomalie>

| Feld | Inhalt |
|---|---|
| Kennung | [offen] |
| Datum / Autor (Rolle) | [offen] |
| Testobjekt (Version/Build) | <…> |
| Testumgebung | <OS, Browser/Gerät, Umgebung> |
| Kontext | <Testfall-ID, Testaktivität, Teststufe, Testdaten> |
| Schweregrad | <Stufe> – <Begründung: Auswirkung> |
| Priorität | <Stufe> – <Begründung: Dringlichkeit> |
| Status | offen |
| Referenzen | <Testfall, Anforderung, verwandte Fehlerberichte> |

**Schritte zur Reproduktion**
1. <…>
2. <…>

**Erwartetes Ergebnis** (Quelle: <Anforderung/Spezifikation>)
<…>

**Tatsächliches Ergebnis**
<…>

**Nachweise**
```text
<relevanter Log-Auszug, gekürzt>
```

**Vermuteter Fehlerzustand** (Vermutung)
<nur wenn durch Input gestützt>

**Fehlernachtest / Regressionstest**
<Nachtest: TC-…; Regressionsumfang: …>
````

## 3. Rückverfolgbarkeitsmatrix

````markdown
| Anf.-ID | Anforderung (kurz) | Testfall-IDs | Ergebnis | Fehlerberichte | Status Überdeckung |
|---|---|---|---|---|---|
| US-123 | <…> | TC-001, TC-002 | 1 bestanden, 1 fehlgeschlagen | DEF-45 | überdeckt |

**Lücken**
- Anforderungen ohne Testfall: <…>
- Testfälle ohne Anforderung: <…>

**Anforderungsüberdeckung:** <überdeckte Anforderungen> / <Anforderungen gesamt> = <x> %
````

## 4. Produktrisikoanalyse

Default quantitative scale: Eintrittswahrscheinlichkeit (E) 1–5, Schadensausmaß (S) 1–5, Risikostufe = E × S → 1–6 niedrig, 8–12 mittel, 15–25 hoch.

````markdown
| R-ID | Risiko | Art | Qualitätsmerkmal | E | S | Risikostufe | Reaktion | Maßnahme (Teststufe, Testart, Testverfahren, Überdeckung) |
|---|---|---|---|---|---|---|---|---|
| R-01 | <…> | Produktrisiko | <z. B. Sicherheit> | 4 | 5 | 20 – hoch | Risikominderung durch Testen | <Systemtest, Sicherheitstest, Entscheidungstabellentest, alle Regeln> |

**Projektrisiken**
| R-ID | Risiko | E | S | Risikostufe | Maßnahme | Verantwortlich |
|---|---|---|---|---|---|---|

**Vorgehen:** <leichtgewichtig (z. B. PRISMA) / schwergewichtig (z. B. FMEA)> – <Begründung>
````

## 5. Testschätzung

````markdown
**Verfahren:** Drei-Punkt-Schätzung (Einheit: <Personentage>)

| Aufgabe | a (optimistisch) | m (wahrscheinlich) | b (pessimistisch) | E = (a+4m+b)/6 | SD = (b−a)/6 |
|---|---|---|---|---|---|
| <…> | | | | | |
| **Summe** | | | | **ΣE** | **√(ΣSD²)** |

**Ergebnis:** <ΣE> ± <SD gesamt> <Einheit> (Aufgaben als unabhängig angenommen)

**Einflussfaktoren:** <Produkt, Prozess, Personen, Testergebnisse>
**Annahmen:** <…>
````

For Verhältniszahlen, Extrapolation or Breitband-Delphi, replace the table with the input data, the calculation and the result.

## 6. Testfortschrittsbericht

````markdown
## Testfortschrittsbericht <Projekt> – <Testzeitraum>

**Ampelstatus:** <Grün|Gelb|Rot> – <eine Zeile Begründung>

**Testfortschritt:** <vor/im/hinter Plan>; Abweichungen: <…>

| Metrik | Wert |
|---|---|
| Testfälle geplant / durchgeführt | <…> / <…> (<x> %) |
| bestanden / fehlgeschlagen / blockiert | <…> / <…> / <…> |
| offene Fehlerberichte nach Schweregrad | Blockierend <n>, Kritisch <n>, Schwerwiegend <n>, Gering <n> |

**Hindernisse & Umgehungen:** <…>
**Neue oder veränderte Risiken:** <…>
**Geplante Tests im nächsten Zeitraum:** <…>

**Entscheidungsbedarf** (bei Management-Zielgruppe)
| # | Entscheidung | Entscheider | bis | Folge ohne Entscheidung |
|---|---|---|---|---|
````

## 7. Testabschlussbericht

````markdown
## Testabschlussbericht <Projekt> – <Teststufe / Zyklus / Iteration>

**Ampelstatus:** <Grün|Gelb|Rot> – <Begründung>

**Zusammenfassung der durchgeführten Tests:** <…>

**Bewertung gegen Testziele und Endekriterien**
| Endekriterium | Ziel | Ist | erfüllt |
|---|---|---|---|
| <z. B. Anforderungsüberdeckung> | 100 % | 97 % | nein |

**Abweichungen vom Testkonzept:** <Zeitplan, Dauer, Aufwand>
**Hindernisse & Umgehungen:** <…>
**Testmetriken:** <aus den Testfortschrittsberichten>
**Restrisiken & nicht behobene Fehlerzustände:** <…>
**Lessons Learned:** <…>
**Freigabeempfehlung:** <ja / nein / unter Auflagen: …>

**Entscheidungsbedarf** (bei Management-Zielgruppe)
| # | Entscheidung | Entscheider | bis | Folge ohne Entscheidung |
|---|---|---|---|---|
````

## 8. Teststrategie / Testkonzept

````markdown
## Testziele
## Testumfang
- Im Umfang: <…>
- Nicht im Umfang: <…>

## Teststufen, Testarten und Testverfahren
| Teststufe | Testarten | Testverfahren | Verantwortlich | Automatisierung |
|---|---|---|---|---|

## Eingangs- und Endekriterien
| Teststufe | Eingangskriterien | Endekriterien |
|---|---|---|

## Testumgebung & Testdaten
## Automatisierung (Testpyramide)
## Risiken
<Verweis auf Produktrisikoanalyse>
## Werkzeuge
## Rollen & Verantwortlichkeiten
## Berichtswesen
<Testfortschrittsbericht: Frequenz, Zielgruppe; Testabschlussbericht: Zeitpunkt>
````

## 9. Testautomatisierung

````markdown
## Rahmenbedingungen
<Sprache, Framework, SUT-Schnittstelle; bei Unklarheit: Annahme markieren>

## Architektur (TAF-Schichten)
| Schicht | Komponenten | Verantwortung |
|---|---|---|
| Testskripte | <Testfälle> | Testlogik und Assertions |
| Geschäftslogik | <Page Objects, Flows, API-Clients> | SUT-spezifische Abstraktion |
| Kernbibliotheken | <Driver, Logging, Config, Reporting> | SUT-unabhängig, wiederverwendbar |

```text
tests/        # Testskripte
business/     # Geschäftslogik
  pages/
  flows/
core/         # Kernbibliotheken
testdata/     # externe Testdaten
```

## Skripterstellungsansatz
<Ansatz> – <Begründung>

## Entwurfsmuster
<Muster> – <wo und warum>

## Code
```<sprache>
<…>
```

## CI/CD & Berichterstattung
<Pipeline-Stufe, Reports, Umgang mit instabilen Tests>
````
