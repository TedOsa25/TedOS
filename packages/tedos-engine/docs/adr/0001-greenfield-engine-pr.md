# ADR 0001 — TedOS-Engine als zusammenhängender Greenfield-PR mergen

- **Status:** Accepted
- **Datum:** 2026-07-05
- **Betrifft:** `packages/tedos-engine` (gesamte Engine), Revenue-/Outreach-Schicht, Merge-Strategie nach `main`
- **Pull Request:** [#1 — feat(revenue): Outreach E-Mail-System](https://github.com/TedOsa25/TedOS/pull/1)

# Context

## Hintergrund
Der Branch `tedos/evidence-engine` führt die vollständige TedOS-Engine ein: Kernprimitive
(`storage`, `types`, `approval-gate`), Evidence Layer, Growth Loop, Connectors, Watchdogs
sowie die Revenue-/Outreach-E-Mail-Engine. Der zugehörige PR umfasst **18 Commits** und
**146 Dateien** (~13.822 Insertions, 34 Deletions).

## Problemstellung
Vor dem Merge stellte sich die Frage, ob der PR zu groß ist und ob sich insbesondere die
Revenue-/Outreach-Funktionen in einen eigenen, kleineren Pull Request auslagern lassen, um
Review und Auslieferung zu entkoppeln.

## Analyse
Die Untersuchung des Branch-Zustands und der Modul-Abhängigkeiten ergab:

1. **`origin/main` enthält keine TedOS-Engine.** Unter `packages/tedos-engine/src/` liegen
   auf `main` **0 Dateien**. Auch die Fundamentmodule `types.ts` und `storage.ts` sind neu in
   diesem Branch. Die Engine ist damit vollständig **greenfield**.

2. **Die Revenue-Engine hängt an gemeinsamen Kernmodulen.**
   `src/revenue/revenue-engine.ts` importiert:
   - `../storage.js`
   - `../brand-guardian.js` (eingeführt in Commit `683e4b5`)
   - `../distribution-queue.js` (eingeführt in Commit `173efe1`, zieht transitiv `approval-gate.js` nach)

   Alle diese Abhängigkeiten sind **neu in diesem Branch** und existieren nicht auf `main`.

3. **Die Revenue-Engine wird bereits vom zentralen Loop konsumiert.**
   `src/tedos-loop.ts` importiert `RevenueEngine`. Revenue ist somit **bidirektional**
   verwoben — es nutzt geteilte Primitive *und* wird vom Haupt-Loop eingebunden.

4. **Reverse-Dependency-Check:** Außerhalb von `src/revenue/` hängen `tedos-loop.ts`,
   `revenue-demo.ts` und `revenue-export.ts` am Revenue-Modul.

# Decision

Die komplette Engine wird als **ein zusammenhängender Greenfield-Pull-Request** nach `main`
gemergt. Es wird **kein** separater Revenue-only-PR erstellt.

## Begründung
Da `main` kein Engine-Fundament besitzt, könnte ein Revenue-only-PR nur bestehen, indem er
entweder große Teile des Fundaments dupliziert oder `revenue-engine.ts` künstlich von
`brand-guardian`/`distribution-queue` und den Haupt-Loop von der Revenue-Engine entkoppelt.
Beides erzeugt Nahtstellen, die es fachlich nicht gibt, und bringt keinen Mehrwert. Der PR ist
groß, weil er den **erstmaligen Aufbau einer kohärenten Engine** abbildet — nicht, weil
unzusammenhängende Änderungen gebündelt wurden.

# Consequences

## Auswirkungen
- Betroffen ist ausschließlich `packages/tedos-engine/` sowie drei Root-Dokumente
  (`BOOTSTRAP.md`, `DECISION_FRAMEWORK.md`, `RULES.md`).
- Nach dem Merge steht die vollständige Engine als Basis auf `main` bereit.
- Zukünftige Features können auf diesem Fundament in kleinen, separaten PRs iterieren.

## Risiken
- **Keine Breaking Changes** gegenüber `main` möglich — es existiert kein Engine-Code, der
  brechen könnte. Der Merge ist rein additiv (34 Deletions, ausschließlich in Root-Markdown).
- **Kein externer Runtime-Konsument** wird beeinflusst. Der Produktivversand bleibt hart
  deaktiviert (`REVENUE_SEND_ENABLED=0`), die Sending-Layer ist standardmäßig disarmed, der
  Testversand ist auf einen einzelnen Empfänger begrenzt.
- **Restrisiko** ist rein intern: Code-Qualität und Testabdeckung der neuen Engine — es gibt
  keine Regressionsfläche gegenüber Bestehendem.
- Großer PR bedeutet höheren Review-Aufwand in einem Rutsch (bewusst akzeptiert).

## Vorteile
- Kohärente, atomare Basis: die Engine landet als konsistente Einheit auf `main`.
- Keine künstlichen Refactors oder Fundament-Duplikate.
- Keine gestapelten PRs mit gegenseitigen Merge-Abhängigkeiten.
- Klare, dokumentierte Ausgangslage für alle Folgearbeiten.

## Nachteile
- Ein einzelner, umfangreicher Review (146 Dateien).
- Feingranulares Cherry-Picking einzelner Bereiche zurück auf `main` ist nachträglich schwerer.

# Alternatives Considered

## Option A — Current PR beibehalten *(gewählt)*
Die gesamte Engine als ein Greenfield-PR mergen.
**Pro:** kohärent, atomar, kein künstlicher Schnitt. **Contra:** großer Einzel-Review.

## Option B — Revenue-only-PR abspalten *(verworfen)*
Nur die Revenue-/Outreach-Dateien in einen eigenen PR gegen `main`.
**Verworfen, weil** die dafür nötigen Kernmodule (`storage`, `brand-guardian`,
`distribution-queue`, `approval-gate`) auf `main` nicht existieren. Der PR müsste das Fundament
mitziehen (dann ist er nicht mehr „nur Revenue") oder `revenue-engine.ts` und `tedos-loop.ts`
per Refactor entkoppeln — Aufwand ohne fachlichen Mehrwert.

## Option C — Erst Core-Dependencies mergen, dann Revenue-PR *(verworfen)*
Zuerst das Fundament (11 untere Commits), danach die 7 Revenue-Commits als gestapelten
Folge-PR. Technisch möglich, da die Revenue-Commits zusammenhängend an der Branch-Spitze liegen.
**Verworfen, weil** `tedos-loop.ts` für die Trennung editiert werden müsste und kein Konsument
auf `main` von einer Zwischenstufe profitiert — reiner Prozess-Overhead ohne Nutzen.

# Future Direction

## Ausblick für zukünftige PRs
Sobald die Engine auf `main` steht, entfällt die Greenfield-Kopplung: Das Fundament ist dann
vorhanden, und einzelne Bereiche können unabhängig weiterentwickelt werden. Künftige Arbeiten
(z. B. Revenue, Evidence, Watchdogs, Connectors) sollen in **deutlich kleineren, thematisch
fokussierten Pull Requests** erfolgen, jeweils mit eigenem Review und eigener Testabdeckung.
Weitere Architekturentscheidungen werden als fortlaufende ADRs unter `docs/adr/` dokumentiert.
