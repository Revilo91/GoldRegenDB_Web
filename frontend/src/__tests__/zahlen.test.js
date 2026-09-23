import { describe, it, expect } from "vitest";
import {
  parseZahl,
  parseZahlOderNull,
  zahlFuerEingabe,
  formatEur,
  formatZahl,
} from "../utils/zahlen";

describe("parseZahl", () => {
  it("liest deutsche Eingaben mit Komma", () => {
    expect(parseZahl("12,50")).toBe(12.5);
    expect(parseZahl("0,05")).toBe(0.05);
  });

  it("liest Eingaben mit Punkt weiterhin", () => {
    expect(parseZahl("12.50")).toBe(12.5);
    expect(parseZahl(12.5)).toBe(12.5);
  });

  it("gibt null statt NaN zurück – Befund D1", () => {
    // parseFloat("") war NaN, und JSON.stringify macht daraus null. Das landete
    // als explizites NULL in der Datenbank und löschte den Preis stillschweigend.
    expect(parseZahl("")).toBeNull();
    expect(parseZahl("   ")).toBeNull();
    expect(parseZahl("teuer")).toBeNull();
    expect(parseZahl(null)).toBeNull();
    expect(parseZahl(undefined)).toBeNull();
  });

  it("weist Unendlich ab", () => {
    expect(parseZahl("Infinity")).toBeNull();
  });

  it("behandelt die 0 als gültigen Wert, nicht als leer", () => {
    expect(parseZahl("0")).toBe(0);
    expect(parseZahl(0)).toBe(0);
  });
});

describe("parseZahlOderNull", () => {
  it("fällt auf den Ersatzwert zurück", () => {
    expect(parseZahlOderNull("", 0)).toBe(0);
    expect(parseZahlOderNull("teuer", 0)).toBe(0);
    expect(parseZahlOderNull("12,50", 0)).toBe(12.5);
  });

  it("überschreibt eine gültige 0 nicht", () => {
    expect(parseZahlOderNull("0", 99)).toBe(0);
  });
});

describe("zahlFuerEingabe", () => {
  it("macht aus null/undefined einen leeren String", () => {
    expect(zahlFuerEingabe(null)).toBe("");
    expect(zahlFuerEingabe(undefined)).toBe("");
    expect(zahlFuerEingabe(NaN)).toBe("");
  });

  it("zeigt Dezimalzahlen mit Komma", () => {
    expect(zahlFuerEingabe(12.5)).toBe("12,5");
    expect(zahlFuerEingabe(0)).toBe("0");
  });
});

describe("formatEur", () => {
  it("formatiert deutsch mit Währung", () => {
    // Nicht-brechendes Leerzeichen vor dem Euro-Zeichen, daher Regex.
    expect(formatEur(12.5)).toMatch(/^12,50\s?€$/);
    expect(formatEur(1234.5)).toMatch(/^1\.234,50\s?€$/);
  });

  it("behandelt null und undefined als 0", () => {
    expect(formatEur(null)).toMatch(/^0,00\s?€$/);
    expect(formatEur(undefined)).toMatch(/^0,00\s?€$/);
  });
});

describe("formatZahl", () => {
  it("formatiert ohne Währung", () => {
    expect(formatZahl(45)).toBe("45");
    expect(formatZahl(2.5)).toBe("2,5");
  });

  it("gibt für leere Werte einen leeren String zurück", () => {
    expect(formatZahl(null)).toBe("");
    expect(formatZahl("")).toBe("");
  });
});
