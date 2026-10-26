import {
  faChartBar,
  faGem,
  faUsers,
  faBox,
  faFileInvoice,
  faCreditCard,
  faClipboardList,
  faWrench,
  faUserLock,
  faDatabase,
  faWarehouse,
  faTruck,
  faCircleQuestion,
} from "@fortawesome/free-solid-svg-icons";

// Eine Liste für Seitenleiste und Handy-Tab-Leiste: Sichtbarkeit nur über die show-Flags.
export function baueNavGruppen(user) {
  const isAdmin = user.role === "admin";
  const isBearbeiter = user.role === "admin" || user.role === "bearbeiter";

  const adminLinks = [
    { to: "/audit-log", icon: faClipboardList, label: "Audit Log" },
    { to: "/debug", icon: faWrench, label: "Debug" },
    { to: "/benutzerverwaltung", icon: faUserLock, label: "Benutzerverwaltung" },
    { to: "/datensicherung", icon: faDatabase, label: "Datensicherung" },
  ];

  // Navigation in dezente Gruppen geteilt – die Überschriften sind reine
  // Labels (keine Kästen), Administration ist einfach die letzte Gruppe.
  const navGroups = [
    {
      links: [
        { to: "/", end: true, icon: faChartBar, label: "Dashboard", show: isBearbeiter },
        { to: "/schmuckstuecke", icon: faGem, label: "Schmuckstücke", show: true },
        { to: "/inventur", icon: faWarehouse, label: "Inventur", show: isBearbeiter },
        { to: "/kunden", icon: faUsers, label: "Kunden", show: isBearbeiter },
      ],
    },
    {
      label: "Verkauf",
      links: [
        { to: "/lieferscheine", icon: faBox, label: "Lieferscheine", show: isBearbeiter },
        { to: "/rechnungen", icon: faFileInvoice, label: "Rechnungen", show: isBearbeiter },
        { to: "/bestelluebersicht", icon: faTruck, label: "Bestellübersicht", show: isBearbeiter },
        { to: "/sumup", icon: faCreditCard, label: "SumUp", show: isBearbeiter },
      ],
    },
    {
      links: [{ to: "/hilfe", icon: faCircleQuestion, label: "Hilfe", show: isBearbeiter }],
    },
  ];
  if (isAdmin) {
    navGroups.push({ label: "Administration", muted: true, links: adminLinks });
  }
  return navGroups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => link.show !== false),
    }))
    .filter((group) => group.links.length > 0);
}
