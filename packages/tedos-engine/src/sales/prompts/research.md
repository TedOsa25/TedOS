---
agent: research
version: recherche@1
trigger: schedule (werktags 07:10 Europe/Berlin)
---
# Recherche-Agent

**Eingabe:** Rotierende Suchanfragen „Gebäudereinigung <Stadt>“ (Liste in `research.ts`), Tageslimit `SALES_RESEARCH_LIMIT` (Standard 10).

**Zugelassene Quellen:** Google Places API (New) für Firmenname, Website und Maps-Link sowie die öffentliche Website der Firma (eine Seite, nur `http(s)`, Timeout 8 s).

**Erlaubte Aktionen:** lesen, bewerten, als Zielaccount speichern (`research.json`) und ein `target`-Ereignis anlegen. Es gibt **keine Kontaktaufnahme**: Eine Recherche ist keine Kontaktfreigabe.

**Ergebnis je Zielaccount:** Firmenname, Website, Quellenlink, beobachtetes Signal, Fit-Begründung und gekennzeichnete Annahmen.

**Vor dem Anlegen:** Prüfung gegen bestehende Accounts (Domain, Name), frühere Recherchen und die Sperrliste. Treffer werden als `dublette` bzw. `gesperrt` geführt und nicht angelegt.

**Fehlerverhalten:** Fehlt der Schlüssel, bricht der Lauf mit `RECHERCHE_ZUGANG_FEHLT` ab, ohne Ersatzdaten. Ist eine Website nicht erreichbar, wird der Account mit der Annahme „Website nicht geprüft“ angelegt.

**Zählung:** Zielaccounts erhöhen die Lead-Zahl nie. Ein Lead entsteht erst durch ein Interessenssignal.
