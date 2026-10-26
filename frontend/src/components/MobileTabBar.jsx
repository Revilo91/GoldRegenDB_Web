import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEllipsis,
  faFileInvoice,
  faSignOutAlt,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { MOBILE_QUERY } from "../utils/breakpoints";

const BELEGE_PFADE = ["/lieferscheine", "/rechnungen"];
// Feste Tabs in Reihenfolge; der Rest der Navigation landet in "Mehr".
const FESTE_TABS = [
  { to: "/schmuckstuecke", label: "Stücke" },
  { to: "/inventur", label: "Inventur" },
  { to: "/kunden", label: "Kunden" },
];
const TAB_PFADE = [...FESTE_TABS.map((tab) => tab.to), ...BELEGE_PFADE];

const ART_BELEGE = "belege";
const ART_MEHR = "mehr";

const istAktiv = (pathname, { to, end }) =>
  end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

function tabKlasse(aktiv) {
  return `mobile-tabbar-tab${aktiv ? " mobile-tabbar-tab-aktiv" : ""}`;
}

// groups: sichtbare Navigationsgruppen (utils/navGroups.js), dieselben wie in der Seitenleiste.
export default function MobileTabBar({ groups, username, onAccount, onLogout }) {
  const istHandy = useMediaQuery(MOBILE_QUERY);
  const { pathname } = useLocation();
  // Pfad wird mitgespeichert: ein Routenwechsel (auch Zurück-Taste) schließt Popup und Sheet.
  const [offen, setOffen] = useState({ art: null, pfad: pathname });
  const art = offen.pfad === pathname ? offen.art : null;
  const mehrRef = useRef(null);
  const belegeRef = useRef(null);
  const sheetRef = useRef(null);

  const schliesse = () => setOffen({ art: null, pfad: pathname });
  const schalte = (neu) => setOffen({ art: art === neu ? null : neu, pfad: pathname });

  useEffect(() => {
    if (!art) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setOffen({ art: null, pfad: pathname });
      (art === ART_MEHR ? mehrRef : belegeRef).current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [art, pathname]);

  useEffect(() => {
    if (art === ART_MEHR) sheetRef.current?.focus();
  }, [art]);

  if (!istHandy) return null;

  const links = groups.flatMap((gruppe) => gruppe.links);
  const sichtbareTabs = FESTE_TABS.filter((tab) => links.some((link) => link.to === tab.to));
  const belegeLinks = links.filter((link) => BELEGE_PFADE.includes(link.to));
  const belegeAktiv = belegeLinks.some((link) => istAktiv(pathname, link));
  const mehrGruppen = groups
    .map((gruppe) => ({
      ...gruppe,
      links: gruppe.links.filter((link) => !TAB_PFADE.includes(link.to)),
    }))
    .filter((gruppe) => gruppe.links.length > 0);
  const mehrAktiv = mehrGruppen.some((gruppe) =>
    gruppe.links.some((link) => istAktiv(pathname, link)),
  );

  const renderLink = (link, extraKlasse) => (
    <NavLink
      key={link.to}
      to={link.to}
      end={link.end}
      className={({ isActive }) => `${extraKlasse}${isActive ? ` ${extraKlasse}-aktiv` : ""}`}
      onClick={schliesse}
    >
      <FontAwesomeIcon icon={link.icon} />
      <span>{link.label}</span>
    </NavLink>
  );

  return (
    <>
      {art && (
        <div
          className={`mobile-tabbar-backdrop${art === ART_MEHR ? " mobile-tabbar-backdrop-dunkel" : ""}`}
          data-testid="mobile-tabbar-backdrop"
          onClick={schliesse}
        />
      )}

      {art === ART_BELEGE && (
        <div className="mobile-tabbar-popup" role="group" aria-label="Belege">
          {belegeLinks.map((link) => renderLink(link, "mobile-tabbar-popup-link"))}
        </div>
      )}

      {art === ART_MEHR && (
        <div
          className="mobile-tabbar-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Mehr"
          tabIndex={-1}
          ref={sheetRef}
        >
          {mehrGruppen.map((gruppe, index) => (
            <div className="mobile-tabbar-sheet-gruppe" key={gruppe.label || `gruppe-${index}`}>
              {gruppe.label && <div className="mobile-tabbar-sheet-titel">{gruppe.label}</div>}
              {gruppe.links.map((link) => renderLink(link, "mobile-tabbar-sheet-eintrag"))}
            </div>
          ))}
          <div className="mobile-tabbar-sheet-gruppe">
            <div className="mobile-tabbar-sheet-titel">Konto</div>
            <button
              type="button"
              className="mobile-tabbar-sheet-eintrag"
              onClick={() => {
                schliesse();
                onAccount();
              }}
            >
              <FontAwesomeIcon icon={faUser} />
              <span>Benutzerkonto{username ? ` (${username})` : ""}</span>
            </button>
            <button
              type="button"
              className="mobile-tabbar-sheet-eintrag mobile-tabbar-sheet-abmelden"
              onClick={() => {
                schliesse();
                onLogout();
              }}
            >
              <FontAwesomeIcon icon={faSignOutAlt} />
              <span>Abmelden</span>
            </button>
          </div>
        </div>
      )}

      <nav className="mobile-tabbar" aria-label="Hauptnavigation mobil">
        {sichtbareTabs.map((tab) => {
          const link = links.find((eintrag) => eintrag.to === tab.to);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => tabKlasse(isActive)}
              onClick={schliesse}
            >
              <FontAwesomeIcon icon={link.icon} />
              <span>{tab.label}</span>
            </NavLink>
          );
        })}
        {belegeLinks.length > 0 && (
          <button
            type="button"
            ref={belegeRef}
            className={tabKlasse(belegeAktiv)}
            aria-expanded={art === ART_BELEGE}
            aria-current={belegeAktiv ? "page" : undefined}
            onClick={() => schalte(ART_BELEGE)}
          >
            <FontAwesomeIcon icon={faFileInvoice} />
            <span>Belege</span>
          </button>
        )}
        <button
          type="button"
          ref={mehrRef}
          className={tabKlasse(mehrAktiv)}
          aria-haspopup="dialog"
          aria-expanded={art === ART_MEHR}
          aria-current={mehrAktiv ? "page" : undefined}
          onClick={() => schalte(ART_MEHR)}
        >
          <FontAwesomeIcon icon={faEllipsis} />
          <span>Mehr</span>
        </button>
      </nav>
    </>
  );
}
