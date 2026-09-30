-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Erstellungszeit: 25. Feb 2026 um 18:46
-- Server-Version: 10.11.11-MariaDB
-- PHP-Version: 8.2.28

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Datenbank: `GoldRegenDB`
--

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `Kunde`
--

CREATE TABLE `Kunde` (
  `ID` int(11) NOT NULL,
  `Name` varchar(100) NOT NULL,
  `Strasse` text NOT NULL,
  `Hausnummer` int(11) NOT NULL,
  `Ort` text NOT NULL,
  `PLZ` int(11) NOT NULL,
  `Email` text DEFAULT NULL,
  `Telefonnummer` text DEFAULT NULL,
  `Provision` int(11) NOT NULL,
  `Aktiv` tinyint(1) NOT NULL DEFAULT 0,
  `Artikelnummern_Erforderlich` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `Lieferschein`
--

CREATE TABLE `Lieferschein` (
  `ID` int(11) NOT NULL,
  `Nummer` varchar(20) NOT NULL,
  `Artikelnummern` text NOT NULL,
  `Kundennummer` int(11) NOT NULL,
  `Datum` datetime NOT NULL DEFAULT current_timestamp(),
  `Datei` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `Rechnung`
--

CREATE TABLE `Rechnung` (
  `ID` int(11) NOT NULL,
  `Nummer` varchar(20) NOT NULL,
  `Artikelnummern` text DEFAULT NULL,
  `Kundennummer` int(11) NOT NULL,
  `Datum` datetime NOT NULL DEFAULT current_timestamp(),
  `Datei` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Tabellenstruktur für Tabelle `Schmuckstück`
--

CREATE TABLE `Schmuckstück` (
  `Artikelnummer` varchar(20) NOT NULL,
  `Name` text DEFAULT NULL,
  `Foto` text DEFAULT NULL,
  `Art` text DEFAULT NULL,
  `Form` text DEFAULT NULL,
  `Länge` double DEFAULT 0,
  `Fassung` text DEFAULT NULL,
  `Farbe` text DEFAULT NULL,
  `Inhalt_Material` text DEFAULT NULL,
  `Inhalt_Farbe` text DEFAULT NULL,
  `Inhalt_Farbakzent` text DEFAULT NULL,
  `Inhalt_Zusatzmaterial` text DEFAULT NULL,
  `Anhänger_Fassung` text DEFAULT NULL,
  `Anhänger_Form` text DEFAULT NULL,
  `Anhänger_Farbe` text DEFAULT NULL,
  `Anhänger_Grösse` double DEFAULT 0,
  `Anhänger_Inhalt_Material` text DEFAULT NULL,
  `Anhänger_Inhalt_Farbe` text DEFAULT NULL,
  `Anhänger_Inhalt_Farbakzente` text DEFAULT NULL,
  `Anhänger_Inhalt_Zusatzmaterial` text DEFAULT NULL,
  `Material` text DEFAULT NULL,
  `Grösse` double DEFAULT 0,
  `Anhänger` text DEFAULT NULL,
  `Zwischenstück` text DEFAULT NULL,
  `Herstellungskosten` double DEFAULT 0,
  `Verkaufspreis` double DEFAULT 0,
  `Online` tinyint(1) DEFAULT 0,
  `Ausgelagert` int(11) DEFAULT 0,
  `Verkauft` tinyint(1) DEFAULT 0,
  `Ausschuss` tinyint(1) DEFAULT 0,
  `Lieferschein_ID` int(11) DEFAULT 0,
  `Rechnung_ID` int(11) DEFAULT 0,
  `Erstelldatum` datetime DEFAULT current_timestamp(),
  `Letzte_Änderung` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

--
-- Indizes der exportierten Tabellen
--

--
-- Indizes für die Tabelle `Kunde`
--
ALTER TABLE `Kunde`
  ADD PRIMARY KEY (`Name`),
  ADD UNIQUE KEY `ID` (`ID`);

--
-- Indizes für die Tabelle `Lieferschein`
--
ALTER TABLE `Lieferschein`
  ADD PRIMARY KEY (`Nummer`),
  ADD UNIQUE KEY `ID` (`ID`),
  ADD KEY `Kundennummer` (`Kundennummer`);

--
-- Indizes für die Tabelle `Rechnung`
--
ALTER TABLE `Rechnung`
  ADD PRIMARY KEY (`Nummer`),
  ADD KEY `ID` (`ID`),
  ADD KEY `Kundennummer` (`Kundennummer`);

--
-- Indizes für die Tabelle `Schmuckstück`
--
ALTER TABLE `Schmuckstück`
  ADD PRIMARY KEY (`Artikelnummer`),
  ADD KEY `Ausgelagert` (`Ausgelagert`),
  ADD KEY `Lieferschein_ID` (`Lieferschein_ID`),
  ADD KEY `Rechnung_ID` (`Rechnung_ID`);

--
-- AUTO_INCREMENT für exportierte Tabellen
--

--
-- AUTO_INCREMENT für Tabelle `Kunde`
--
ALTER TABLE `Kunde`
  MODIFY `ID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT für Tabelle `Lieferschein`
--
ALTER TABLE `Lieferschein`
  MODIFY `ID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT für Tabelle `Rechnung`
--
ALTER TABLE `Rechnung`
  MODIFY `ID` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints der exportierten Tabellen
--

--
-- Constraints der Tabelle `Lieferschein`
--
ALTER TABLE `Lieferschein`
  ADD CONSTRAINT `Lieferschein_ibfk_1` FOREIGN KEY (`Kundennummer`) REFERENCES `Kunde` (`ID`);

--
-- Constraints der Tabelle `Rechnung`
--
ALTER TABLE `Rechnung`
  ADD CONSTRAINT `Rechnung_ibfk_1` FOREIGN KEY (`Kundennummer`) REFERENCES `Kunde` (`ID`);

--
-- Constraints der Tabelle `Schmuckstück`
--
ALTER TABLE `Schmuckstück`
  ADD CONSTRAINT `Schmuckstück_ibfk_1` FOREIGN KEY (`Ausgelagert`) REFERENCES `Kunde` (`ID`),
  ADD CONSTRAINT `Schmuckstück_ibfk_2` FOREIGN KEY (`Lieferschein_ID`) REFERENCES `Lieferschein` (`ID`),
  ADD CONSTRAINT `Schmuckstück_ibfk_3` FOREIGN KEY (`Rechnung_ID`) REFERENCES `Rechnung` (`ID`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
