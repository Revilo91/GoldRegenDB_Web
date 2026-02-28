## Um auf die Datenbank zu kommen:
```
sudo docker exec -it goldregendb_web_db_1 psql -U goldregen -d goldregendb
```


## Befehle
Alle Tabellen anzeigen:
\dt

Tabellenstruktur anzeigen:
\d tabellenname

Alle Daten aus einer Tabelle anzeigen:
SELECT * FROM tabellenname;

Datenbank verlassen:
\q

Liste aller Datenbanken:
\l

Aktuelle Datenbank anzeigen:
\conninfo

Hilfe zu SQL-Befehlen:
\h



# oder `pgAdmin` nutzen