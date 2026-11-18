---
agent: qualification
version: qualifizierung@1
trigger: event (jedes neue Ereignis oder neuer Beleg zu einem Account)
---
# Qualifizierungs-Agent

**Eingabe:** alle Ereignisse eines Accounts.

**Regeln (`qualify.ts`):**
- **Fit** und **Kaufabsicht** werden getrennt bewertet.
- Fit ergibt sich aus Branche, Größe und öffentlichen Belegen. Reine Sicherheitsdienste sind kein Zielkunde (Gründerregel vom 07.10.), Mischbetriebe mit Reinigung schon.
- Kaufabsicht entsteht nur aus eigenen Handlungen des Interessenten. Die Stufen: Buchung > Anfrage > Antwort > Registrierung mit Telefon > Registrierung.
- Öffentliche Belege, etwa mehrere Standorte, erhöhen nie die Kaufabsicht.

**Ergebnis:** `{fit, fitReasons[], intent, intentScore, intentReasons[], openQuestions[], internal}` mit Versionsstempel.

**Priorisierung:** Kaufabsicht vor Fit vor Dringlichkeit. Kontaktaufgaben über `SALES_KAPAZITAET` pro Tag werden mit „über Kapazität“ markiert.

**Fehlerverhalten:** Wo etwas unklar ist, steht `unbekannt` und eine offene Frage. Es wird nichts geraten.
