import { STATUS } from "./status";

export const STATUS_ALLE = "alle";

// Übersetzt einen Status-Chip in die bestehenden Listen-Parameter von
// GET /schmuckstuecke (verkauft, ausschuss, ausgelagert). "ausgelagert=0" prüft
// im Backend nur den Standort, deshalb braucht "Im Lager" verkauft/ausschuss=0.
// "ausgelagert=kunden" heißt im Backend "Ausgelagert > 0" (bei irgendeinem Kunden).
export function statusListenParams(status) {
  switch (status) {
    case STATUS.LAGER:
      return { ausgelagert: "0", verkauft: "0", ausschuss: "0" };
    case STATUS.AUSGELAGERT:
      return { ausgelagert: "kunden", verkauft: "0", ausschuss: "0" };
    case STATUS.VERKAUFT:
      return { verkauft: "1" };
    case STATUS.AUSSCHUSS:
      return { ausschuss: "1" };
    default:
      return {};
  }
}
