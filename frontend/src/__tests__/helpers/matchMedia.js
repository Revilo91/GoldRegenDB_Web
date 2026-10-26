// Ersetzt window.matchMedia für "(max-width: Npx)"- und "(min-width: Npx)"-Abfragen; setze() ändert die Breite und benachrichtigt Hörer.
export function mockeBreite(anfangsbreite) {
  let breite = anfangsbreite;
  const hoerer = new Set();
  const trifft = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    if (max) return breite <= Number(max[1]);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return min ? breite >= Number(min[1]) : false;
  };
  window.matchMedia = (query) => ({
    get matches() {
      return trifft(query);
    },
    media: query,
    addEventListener: (_art, fn) => hoerer.add(fn),
    removeEventListener: (_art, fn) => hoerer.delete(fn),
  });
  return {
    setze(neu) {
      breite = neu;
      hoerer.forEach((fn) => fn());
    },
  };
}
