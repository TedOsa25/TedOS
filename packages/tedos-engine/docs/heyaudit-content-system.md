# HeyAudit Content-System — Architektur und Runbook

Code: `src/content/` · Zustand: Verzeichnis aus `CONTENT_STATE_DIR` (lokal, außerhalb des Repos, nur für den Betreiber lesbar)

Das Content-System recherchiert Wettbewerber und Content-Vorbilder und entwickelt daraus eigene Ideen und Skriptgerüste. Es plant eine Redaktionswoche über mehrere Plattformen und macht die Wirkung im **bestehenden** Sales-System sichtbar.

Es ist **kein** CRM und hat keine eigene Lead-Datenbank. Leads, Kontakte, Aufgaben und Follow-ups bleiben im Sales-Modul (`src/sales`).

Betriebsdetails stehen bewusst nicht in diesem öffentlichen Dokument, sondern in einer privaten Betriebsnotiz im Zustandsverzeichnis. Dazu gehören Pfade, Zugangsquellen, Zeitpläne und der Deploy-Stand.

## Datenfluss

```
Öffentliche Recherche ─► Accounts ─► Rangliste ─► Video-Erhebung (nur mit Budget) ─► Videos (Score je Plattform)
                                                                                         │ Muster (P-…)
Faktenkatalog (fakten.ts, aus der Produkt-Faktenquelle) ─► Ideen-Generator ─► Ideenvorrat ◄┘
                                                    │
                          content -- plan ─► Redaktionsplan je Woche
                                                    │  1 Freigabe je Woche: content:woche:<kampagne>
                                                    ▼  (bestehende Sales-Freigabe; nur der Inhaber gibt frei)
               Sales-Scheduler ─► Job "instagram" ─► contentLoopSchritt: intern_pruefen → freigegeben, fällige Posts melden
                                                    │
               IG-Runde (manuell) ─► posten ─► content -- veroeffentlicht <pubId> --url
               Metricool (wenn verbunden) ─► content -- uebergabe --schreiben (Entwurf; Auto-Publish nur mit Schalter)
                                                    │
   Interessent ─► Website mit utm_campaign=ig-2026-kw48-cv2 ─► Formular der App ─► Benachrichtigung
              ─► Sales-Eingang (bestehend) ─► Lead + Aufgaben (bestehend)
   DM mit ausdrücklicher Kontaktbitte ─► sales -- ig-antwort … --kontakt-erbeten [--content ig-2026-kw48-cv2] ─► Lead
   DM ohne Kontaktbitte              ─► sales -- ig-antwort …                                          ─► nur Antwort, kein Lead
                                                    │
               content -- bericht ─► Wochenbericht (liest Sales nur)
```

## Instagram-Antworten und Leads

| Erfassung | Ereignis | Lead? | Aufgaben / Entwurf |
|---|---|---|---|
| `sales -- ig-antwort --handle … --text …` | `reply`, `kontaktErbeten: false` | nein | keine; Hinweis im Kanal-Abschnitt |
| … `--kontakt-erbeten` | eigenes Ereignis `<id>:kontakt`, `kontaktErbeten: true` | ja | „Antwort lesen“ + ein DM-Entwurf in der Freigabe |
| … `--kontakt-erbeten --content ig-2026-kw49-cv3` | wie oben, Kampagne = Content-Kampagne | ja | wie oben; im Bericht beobachtete Attribution |
| `--content` ohne `--kontakt-erbeten` | — | Fehler | — |
| historische Antwort ohne Merkmal | `reply` | ja (unverändert) | unverändert |

- Ob jemand Kontakt erbeten hat, entscheidet ein Mensch beim Erfassen. Der Nachrichtentext wird nie automatisch gedeutet.
- Dieselbe Nachricht erst als Antwort und später als Kontaktanfrage zu erfassen ist möglich. Im Funnel zählt sie trotzdem nur einmal als Antwort.
- Eine bloße Antwort auf einem Account, der schon Lead ist, ändert nichts an Lead-Status, erster Herkunft oder Kaufabsicht. Sie erzeugt nur „Antwort lesen“ und stoppt automatische Folgeentwürfe, so wie es auch bei Mail-Antworten bisher läuft.
- Mail-Antworten sind von dem Merkmal nicht betroffen.

## IDs und UTM

| Objekt | Beispiel | Bedeutung |
|---|---|---|
| Kampagne | `content-2026-kw48` | eine Redaktionswoche |
| Content-ID | `cv-2026kw48-2` | Kernvideo, Slot 2 (Di) |
| Veröffentlichung | `cv-2026kw48-2.ig` | Kernvideo × Plattform |
| utm_campaign | `ig-2026-kw48-cv2` | trägt die Content-ID; Kürzel ig/tt/yt/fb/li |
| utm_content | `idee-m-qr-objekt` | Idee. Die App meldet **nur** source + campaign weiter, deshalb steht die Content-ID in `utm_campaign`. |

## Statusfluss je Veröffentlichung

`entwurf → intern_pruefen → freigegeben → (geplant | manuell_veroeffentlichen) → veroeffentlicht`

- Seitenzweige: `fehlgeschlagen` und `verworfen`.
- `nicht_vorgesehen` steht für ein fehlendes Konto oder fehlenden Formatfit. Solche Varianten zählen nicht als Veröffentlichung.
- Ein unerlaubter Wechsel wirft einen Fehler.
- Eine zweite URL für eine bereits veröffentlichte Variante wird abgewiesen (Doppelpost-Sperre).

## Befehle

Alle Befehle laufen aus `packages/tedos-engine`: `npm run content -- <befehl>`. Zugänge kommen ausschließlich aus Umgebungsvariablen.

| Zweck | Befehl |
|---|---|
| Zustand und Zugänge (nur „gesetzt/nicht gesetzt“) | `status` |
| Recherche-Kandidaten übernehmen | `recherche-import <kandidaten.json>` |
| Transparente Rangliste | `rangliste` |
| Erhebungsplan + Kostenschätzung | `apify-plan --ziel 300` |
| Erhebung (Pilot 300, Ausbau bis 1.000) | `apify-lauf --batches 1` (braucht Token + Budget) |
| Videos manuell oder aus einem Export | `video-import <videos.json>` |
| Ideenvorrat | `ideen` |
| Redaktionsplan + Wochenfreigabe | `plan [--woche 2026-KW49]` |
| Freigaben übernehmen (macht der Loop) | `loop` |
| Heute fällige Instagram-Posts | `ig-faellig` |
| Veröffentlichung zurückmelden | `veroeffentlicht <pubId> --url <Beitrags-URL>` |
| Kennzahlen eintragen | `kennzahlen <pubId> --views n --likes n --linkklicks n --quelle "…"` |
| Metricool-Übergabe | `uebergabe` (Trockenlauf) · `--schreiben` |
| Notion | `notion` (Trockenlauf bzw. Export) · `--schreiben` |
| Wochenbericht Content → Sales | `bericht [--woche 2026-KW48]` |

`konten.json` im Zustandsverzeichnis legt fest, welche HeyAudit-Konten bestätigt sind. Nicht bestätigte Plattformen stehen auf „nicht vorgesehen“. Beispiel:

```json
{ "konten": { "instagram": { "verbunden": true, "metricool": false },
              "linkedin":  { "verbunden": true, "belegt": "Unternehmensseite bestätigt am …" } },
  "wochenmix": { "TOFU": 3, "MOFU": 2, "BOFU": 2 } }
```

## Zugänge (nie im Repo, nie im Chat, nie im Log)

| Dienst | Variablen | Ohne Zugang |
|---|---|---|
| Apify | `APIFY_TOKEN`, Budget `CONTENT_APIFY_BUDGET_USD` | nur Plan + Kostenschätzung |
| Notion | `NOTION_TOKEN`; `NOTION_PARENT_PAGE` (mit der Integration geteilte Seite) oder `NOTION_DB_*` für bestehende Datenbanken | CSV- und Schema-Export |
| Metricool | `METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID`. Die API braucht den Advanced- oder Custom-Tarif. | freigegeben → `manuell_veroeffentlichen` |
| Auto-Publish | `CONTENT_AUTOPUBLISH=ja-auto-publish`, wirkt nur zusammen mit verbundenem Konto und gültiger Variante | Entwurf (`draft:true`) |

Werte bitte über einen lokalen Geheimnisspeicher in die Prozessumgebung laden, nie in Dateien im Repo.

## Scoring

**Video:** Perzentil **innerhalb der Plattform**.

| Komponente | Berechnung | Gewicht |
|---|---|---|
| Reichweite | Views/Follower | .40 |
| Interaktion | (Likes+Kommentare+Shares)/Views | .35 |
| Tempo | Views/√Alter in Tagen | .25 |

- Fehlende Komponenten fallen weg, die übrigen Gewichte werden neu normiert.
- Bei weniger als 2 Komponenten gibt es keinen Score.

**Account:**

| Komponente | Gewicht |
|---|---|
| Relevanz | .40 |
| Median-Videoscore | .30 |
| Aktualität | .15 |
| Formatqualität (manuell, 0–1) | .15 |

Jede Lücke steht in der Rangliste. Rohe Follower- oder View-Zahlen gehen nie direkt ein.

## Regeln, die der Code erzwingt (Tests: `src/content/content.test.ts`, `src/sales/kanaele.test.ts`)

- Recherche-Accounts und Videos sind keine Leads. Das Content-Modul legt keine Sales-Ereignisse an und versendet nichts.
- Likes, Views, Kommentare und unbestätigte DMs erzeugen keine Leads, keine Aufgaben und keine Entwürfe.
- **Faktenbindung:**
  - Produktaussagen kommen nur aus `fakten.ts`, sonst steht ein Platzhalter `[[…]]` da.
  - Vorher/Nachher und Kundengeschichten bleiben gesperrt, bis ein echter Fall mit Freigabe vorliegt.
- **Plattformgrenzen:**
  - Instagram: höchstens 5 Hashtags
  - TikTok: keine Zeilenumbrüche
  - YouTube: Titel höchstens 100 Zeichen
  - Markenprüfung aus `growth-os/content-plan.ts`
- **Apify:**
  - Ohne Budget gibt es keinen Lauf.
  - Jeder Lauf hat `maxTotalChargeUsd`.
  - Captions und Videos werden nicht gespeichert, nur Kennzahlen und die eigene Analyse.
- **Notion:** Upsert über „Externe ID“. Das Journal ermöglicht die Wiederaufnahme nach Teilfehlern. Bei 429/529 wird `Retry-After` beachtet.
- **Metricool:** Ein Journal und ein Abgleich gleicher Text/gleicher Tag verhindern Doppelposts. Die Tageslimits je Plattform werden geprüft.

## Bekannte Grenzen

- **Instagram-Link:** Die Bio hat nur einen Link. Für UTM je Post muss der Bio-Link am Veröffentlichungstag auf den Link aus `ig-faellig` gesetzt werden.
- **Opportunities:** Das Sales-System führt sie nicht als eigene Stufe. Der Bericht nimmt „gehaltene qualifizierte Demo“ als Näherung.
- **Datenaufbewahrung:** Recherche-Rohdaten nach 12 Monaten neu erheben oder löschen. Sie enthalten nur öffentliche Business-Daten.
