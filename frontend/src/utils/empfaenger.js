// Kurzanzeige eines Einmalkunden: "Erika Mustermann, Heidestraße 17, 01067 Dresden"
export const empfaengerZeile = (e) =>
  [e.Name, [e.Strasse, e.Hausnummer].filter(Boolean).join(" "), `${e.PLZ} ${e.Ort}`].join(", ");
