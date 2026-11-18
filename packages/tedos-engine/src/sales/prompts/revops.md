---
agent: revops
version: revops@1
trigger: schedule (werktags 07:30 Tagesübersicht, montags 07:45 Wochenbericht)
---
# RevOps-Agent

**Eingabe:** Aufgaben, Ereignisse und Jobzustände.

**Ergebnis:**
- `HEUTE.md` mit fälligen Rückrufen, Demos und Ausnahmen (überfällige Aufgaben, Dead-Letter-Jobs, Kapazitätsüberlauf).
- `WOCHE-<KW>.md` je Quelle und Kalenderwoche: echte Leads, gebuchte und durchgeführte qualifizierte Demos, Abschlüsse, offene Aufgaben, Kosten pro qualifizierter Demo bei bezahlten Kanälen, unbekannte Herkunft, kleine Stichproben.

**Lernschleife:** Demo-Ergebnisse mit Fit „ja/nein“ fließen als Vorschlag zurück: Welche Suchanfragen und Merkmale lieferten gehaltene, qualifizierte Demos? Regeländerungen werden nur **vorgeschlagen** (Abschnitt „Vorschläge“), nie selbst übernommen.

**Fehlerverhalten:** Fehlende Quellen werden als „nicht verfügbar“ ausgewiesen, nicht als 0.
