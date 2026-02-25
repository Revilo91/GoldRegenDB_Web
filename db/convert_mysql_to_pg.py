#!/usr/bin/env python3
"""Convert MySQL/MariaDB dump to PostgreSQL-compatible seed.sql"""

import re
import sys

def convert_mysql_to_pg(input_file, output_file):
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove MySQL-specific comments and settings
    content = re.sub(r'/\*!.*?\*/;?\n?', '', content)
    content = re.sub(r'SET SQL_MODE.*?;\n', '', content)
    content = re.sub(r'START TRANSACTION;\n', '', content)
    content = re.sub(r'SET time_zone.*?;\n', '', content)
    content = re.sub(r'COMMIT;\n?', '', content)

    # Remove CREATE TABLE blocks (we have them in init.sql)
    content = re.sub(r'CREATE TABLE `.*?;', '', content, flags=re.DOTALL)

    # Remove ALTER TABLE, INDEX blocks
    content = re.sub(r'ALTER TABLE.*?;', '', content, flags=re.DOTALL)
    content = re.sub(r'--\s*\n--\s*Indizes.*?--\s*\n', '', content, flags=re.DOTALL)
    content = re.sub(r'--\s*\n--\s*AUTO_INCREMENT.*?--\s*\n', '', content, flags=re.DOTALL)
    content = re.sub(r'--\s*\n--\s*Constraints.*?--\s*\n', '', content, flags=re.DOTALL)

    # Convert backticks to double quotes
    content = content.replace('`', '"')

    # Remove MySQL-specific table comments
    content = re.sub(r'-- phpMyAdmin SQL Dump.*?\n', '', content)
    content = re.sub(r'-- version.*?\n', '', content)
    content = re.sub(r'-- https://www.phpmyadmin.net/.*?\n', '', content)
    content = re.sub(r'-- Host:.*?\n', '', content)
    content = re.sub(r'-- Erstellungszeit:.*?\n', '', content)
    content = re.sub(r'-- Server-Version:.*?\n', '', content)
    content = re.sub(r'-- PHP-Version:.*?\n', '', content)

    # Convert \' escaping to '' (PostgreSQL standard)
    content = content.replace("\\'", "''")

    # Convert \" to "
    content = content.replace('\\"', '"')

    # Convert \r\n in strings
    content = content.replace('\\r\\n', '\r\n')
    content = content.replace('\\n', '\n')

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
    content = re.sub(r'\n{4,}', '\n\n', content)

    # Remove section comment blocks that are now empty
    content = re.sub(r'-- -+\n\n-- -+', '', content)
    content = re.sub(r'--\s*\n--\s*Datenbank:.*?\n--\s*\n', '', content)

    content = content.strip() + '\n' + seq_resets

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

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Conversion complete: {output_file}")

if __name__ == '__main__':
    input_file = sys.argv[1] if len(sys.argv) > 1 else 'GoldRegenDB_data.sql'
    output_file = sys.argv[2] if len(sys.argv) > 2 else 'db/seed.sql'
    convert_mysql_to_pg(input_file, output_file)
