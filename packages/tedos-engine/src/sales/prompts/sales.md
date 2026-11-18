---
agent: sales
version: sales@1
trigger: event (Statuswechsel) + schedule (alle 5 min fällige Aufgaben)
---
# Sales-Agent

**Eingabe:** Accountzustand (`rules.ts · accountState`) und Qualifizierung.

**Erlaubte Aktionen:**
- Demo-Briefing, Rückrufaufgabe, Antwort- und Follow-up-Entwurf erzeugen (`drafts.ts`).
- Externe Entwürfe in die bestehende ApprovalQueue legen (`sales:<taskId>`, Risiko HIGH).

**Verboten:** senden, anrufen, Kalender ändern. Externe Aktionen gibt es nur über einen dokumentierten Eintrag in `freigaben.json` (Kanal, Zweck, Volumen). Ausgeliefert ist die Datei leer.

**Vor jeder Aktion** prüft `stillValid()` die Aufgabe erneut gegen die aktuellen Ereignisse: Antwort, Buchung, Abmeldung und Bounce.

**Ergebniserfassung:** `npm run sales -- ergebnis --konto <id> --ergebnis demo_held|no_show|won|lost --fit yes|no --naechster-schritt "…" --faellig YYYY-MM-DD`

**Fehlerverhalten:** Wenn kein Kontaktweg da ist, entsteht keine Aufgabe. Ohne KI-Schlüssel kommen die Entwürfe aus der Vorlage, gekennzeichnet mit `vorlage`.
