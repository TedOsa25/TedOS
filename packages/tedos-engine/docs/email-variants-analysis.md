# E-Mail-Varianten — Analyse & Standard

Fünf Copy-Varianten für die Cold-Outreach-Mail (gleiche Struktur, gleicher Banner/
CTA/Signatur — nur der personalisierte Text unterscheidet sich). Ziel: kurz,
vertrauenswürdig, neugierig machend, CTA früh. Generiert aus **realen** Account-
Daten (Firma, OEMs, Pain Points). Umsetzung: `src/revenue/email-copy.ts`.

## Die fünf Varianten (Beispiel: GRAFE GmbH, Zulieferer für BMW & Bosch)

| Var | Ton | Wörter | Kern |
|---|---|---|---|
| **A** | sehr kurz | ~54 | Zwei Sätze + eine Frage. Maximale Kürze, CTA sofort sichtbar. |
| **B** | beratend | ~84 | „Viele lösen das in Excel …" — Kontext + Einordnung, leicht länger. |
| **C** | problemorientiert | ~64 | Führt mit dem Risiko (Ausschreibungen) und schließt die Lücke. |
| **D** | ROI-orientiert | ~73 | „Statt Wochen in Excel …" — Zeit-/Aufwandsersparnis im Fokus. |
| **E** | persönlich / dialog | ~76 | „Mir ist aufgefallen … Wäre das für Sie gerade ein Thema?" |

## Erwartete Performance

| Kriterium | Beste Variante | Begründung |
|---|---|---|
| **Höchste Reply-Rate** | **E** (persönlich) | Eine einzige, niedrigschwellige Frage („Wäre das für Sie gerade ein Thema?") + persönlicher Ton senkt die Antwort-Hürde. Kurz + persönlich + eine Frage ist die Reply-Formel im Cold Outreach. |
| **Höchste Klickrate** | **A** (sehr kurz) | Wenig Text → der CTA-Button erscheint am frühesten und dominiert. Weniger Reibung bis zum Klick. (D dicht dahinter.) |
| **Für Geschäftsführer** | **D** (ROI) | Entscheider reagieren auf Zeit-/Kosten-/Aufwandsargumente; knapp und ergebnisorientiert. |
| **Für Nachhaltigkeitsverantwortliche** | **C** (problemorientiert) | Sie „besitzen" das Compliance-/PCF-Problem; die Problemrahmung zeigt Fachverständnis und trifft ihren Alltag. (B beratend als Alternative.) |

## Standard-Variante

**Variante E (persönlich / dialogorientiert)** ist als Standard gesetzt
(`DEFAULT_VARIANT = "E"` in `email-copy.ts`).

Begründung: Der Conversion-Event dieser Outreach-Mail ist primär eine **Antwort /
ein Gespräch** (der Abschluss fragt aktiv danach). E maximiert genau diese Reply-
Rate, bleibt dabei sehr kurz und wirkt am wenigsten wie Marketing — also die
höchste zu erwartende Gesamt-Conversion. A ist knapp dahinter (stärker auf Klicks).

**Segment-Empfehlung:** Für reine Geschäftsführer-Listen D, für Nachhaltigkeits-/
ESG-Rollen C. Umschaltbar pro E-Mail über den `variant`-Parameter von
`buildOpportunity(account, clock, variant)`; der Standard über `DEFAULT_VARIANT`.
