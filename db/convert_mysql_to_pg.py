#!/usr/bin/env python3
"""Convert MySQL/MariaDB dump to PostgreSQL-compatible seed.sql"""

import re
import sys


def convert_mysql_to_pg(input_file, output_file):
    with open(input_file, "r", encoding="utf-8") as f:
        content = f.read()

    # Remove MySQL-specific comments and settings
    content = re.sub(r"/\*!.*?\*/;?\n?", "", content)
    content = re.sub(r"SET SQL_MODE.*?;\n", "", content)
    content = re.sub(r"START TRANSACTION;\n", "", content)
    content = re.sub(r"SET time_zone.*?;\n", "", content)
    content = re.sub(r"COMMIT;\n?", "", content)

    # Remove MySQL DELIMITER statements and their associated TRIGGER blocks
    # Pattern: DELIMITER $$ ... CREATE TRIGGER ... $$ ... DELIMITER ;
    content = re.sub(
        r"DELIMITER\s+\$\$\s*\n.*?DELIMITER\s+;",
        "",
        content,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Clean up any remaining loose DELIMITER statements
    content = re.sub(r"DELIMITER\s+\$\$\s*\n?", "", content, flags=re.IGNORECASE)
    content = re.sub(r"DELIMITER\s+;\s*\n?", "", content, flags=re.IGNORECASE)

    # Remove CREATE TABLE blocks (we have them in init.sql)
    content = re.sub(r"CREATE TABLE `.*?;", "", content, flags=re.DOTALL)

    # Remove ALTER TABLE, INDEX blocks
    content = re.sub(r"ALTER TABLE.*?;", "", content, flags=re.DOTALL)
    content = re.sub(r"--\s*\n--\s*Indizes.*?--\s*\n", "", content, flags=re.DOTALL)
    content = re.sub(
        r"--\s*\n--\s*AUTO_INCREMENT.*?--\s*\n", "", content, flags=re.DOTALL
    )
    content = re.sub(r"--\s*\n--\s*Constraints.*?--\s*\n", "", content, flags=re.DOTALL)

    # Convert backticks to double quotes
    content = content.replace("`", '"')

    # Remove MySQL-specific table comments
    content = re.sub(r"-- phpMyAdmin SQL Dump.*?\n", "", content)
    content = re.sub(r"-- version.*?\n", "", content)
    content = re.sub(r"-- https://www.phpmyadmin.net/.*?\n", "", content)
    content = re.sub(r"-- Host:.*?\n", "", content)
    content = re.sub(r"-- Erstellungszeit:.*?\n", "", content)
    content = re.sub(r"-- Server-Version:.*?\n", "", content)
    content = re.sub(r"-- PHP-Version:.*?\n", "", content)

    # Convert \' escaping to '' (PostgreSQL standard)
    content = content.replace("\\'", "''")

    # Convert \" to "
    content = content.replace('\\"', '"')

    # Convert \r\n in strings
    content = content.replace("\\r\\n", "\r\n")
    # Convert \n in strings
    content = content.replace("\\n", "\n")

    # Remove "Artikelnummern" column from Lieferschein and Rechnung tables
    # Step 1: Fix the column list in INSERT statements
    content = re.sub(
        r'INSERT INTO "(Lieferschein|Rechnung)" \("ID", "Nummer", "Artikelnummern", "Kundennummer"',
        r'INSERT INTO "\1" ("ID", "Nummer", "Kundennummer"',
        content,
    )

    # Step 2: Remove the third value from each tuple in VALUES for these tables
    # Pattern: (number, 'string', 'string_to_remove', number, ...) -> (number, 'string', number, ...)
    # We need to handle: ID is a number, Nummer is a quoted string, Artikelnummern is a quoted string

    # Find all Lieferschein and Rechnung INSERT blocks and process them
    def fix_values_block(match):
        prefix = match.group(1)  # Everything before VALUES
        values_section = match.group(2)  # Everything after VALUES

        # Remove third field (Artikelnummern) from each tuple
        # Match pattern: (ID, 'Nummer', 'Artikelnummern', Rest...)
        # We look for: (\d+, '[^']*', '[^']*',  and remove the third quoted string plus comma
        fixed_values = re.sub(
            r"\((\d+),\s*('(?:[^']|'{2})*'),\s*(?:NULL|'(?:[^']|'{2})*'),\s*",
            r"(\1, \2, ",
            values_section,
            flags=re.IGNORECASE,
        )

        return prefix + fixed_values

    content = re.sub(
        r'(INSERT INTO "(?:Lieferschein|Rechnung)" \("ID", "Nummer", "Kundennummer", "Datum", "Datei"\) VALUES)\s*(.*?;)',
        fix_values_block,
        content,
        flags=re.DOTALL,
    )

    # Fix boolean values for the Kunde table (Aktiv, Artikelnummern_Erforderlich)
    # The Kunde table ends with `Provision, Aktiv, Artikelnummern_Erforderlich)`
    # Since MariaDB dumps them as 1 and 0, we change them to true and false.
    # We specifically target the Kunde insert block by finding it.
    if 'INSERT INTO "Kunde"' in content:
        parts = content.split('INSERT INTO "Kunde"')
        pre = parts[0]
        post_parts = parts[1].split("INSERT INTO", 1)
        kunde_block = post_parts[0]
        rest = "INSERT INTO" + post_parts[1] if len(post_parts) > 1 else ""

        # Replace the 1/0 at the end of the tuples
        kunde_block = re.sub(
            r",\s*([01]),\s*([01])\s*(\)[,;])",
            lambda m: (
                f", {'true' if m.group(1) == '1' else 'false'}, {'true' if m.group(2) == '1' else 'false'}{m.group(3)}"
            ),
            kunde_block,
        )

        content = pre + 'INSERT INTO "Kunde"' + kunde_block + rest

    # Fix incomplete INSERT statements - replace trailing comma before blank line or comment with semicolon
    content = re.sub(r",(\s*\n\s*\n)", r";\1", content)
    content = re.sub(r",(\s*\n\s*--)", r";\1", content)

    # Add SERIAL sequence reset at end
    # Fix: SERIAL IDs need their sequences updated after bulk inserts
    seq_resets = """
-- Reset sequences after data import
SELECT setval(pg_get_serial_sequence('"Kunde"', 'ID'), COALESCE(MAX("ID"), 0) + 1, false) FROM "Kunde";
SELECT setval(pg_get_serial_sequence('"Lieferschein"', 'ID'), COALESCE(MAX("ID"), 0) + 1, false) FROM "Lieferschein";
SELECT setval(pg_get_serial_sequence('"Rechnung"', 'ID'), COALESCE(MAX("ID"), 0) + 1, false) FROM "Rechnung";
SELECT setval(pg_get_serial_sequence('audit_log', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM audit_log;
"""

    # Remove excessive blank lines
    content = re.sub(r"\n{4,}", "\n\n", content)

    # Remove section comment blocks that are now empty
    content = re.sub(r"-- -+\n\n-- -+", "", content)
    content = re.sub(r"--\s*\n--\s*Datenbank:.*?\n--\s*\n", "", content)

    content = content.strip() + "\n" + seq_resets

    # Disable audit trigger during import
    header = """-- GoldRegenDB Seed Data (PostgreSQL)
-- Converted from MariaDB/MySQL dump

-- Disable triggers during bulk import
ALTER TABLE "Schmuckstück" DISABLE TRIGGER ALL;

"""

    footer = """

-- Re-enable triggers
ALTER TABLE "Schmuckstück" ENABLE TRIGGER ALL;
"""

    content = header + content + footer

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"Conversion complete: {output_file}")


if __name__ == "__main__":
    input_file = sys.argv[1] if len(sys.argv) > 1 else "GoldRegenDB.sql"
    output_file = sys.argv[2] if len(sys.argv) > 2 else "db/seed.sql"
    convert_mysql_to_pg(input_file, output_file)
