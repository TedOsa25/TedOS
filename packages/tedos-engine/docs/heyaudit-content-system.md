# HeyAudit Content-System — Architektur und Runbook

Stand 2026-11-22 · Code `src/content/` · Zustand `~/dev/tedos-runtime/heyaudit-content` (außerhalb von Git, 0700)

Das Content-System recherchiert Wettbewerber und Content-Vorbilder und macht daraus eigene Ideen und Skriptgerüste. Es plant eine Redaktionswoche über mehrere Plattformen und macht die Wirkung im **bestehenden** Sales-System sichtbar.

Es ist **kein** CRM und hat keine eigene Lead-Datenbank. Leads, Kontakte, Aufgaben und Follow-ups bleiben in `src/sales`. Die Lead-Wahrheit ist `heyaudit-sales/events.json`.

## Datenfluss

```
Öffentliche Recherche ─► recherche/accounts.json ─► rangliste ─► Apify (nur mit Budget) ─► recherche/videos.json (Score je Plattform)
                                                                                                        │ Muster (P-…)
Faktenkatalog (fakten.ts, aus app/llms.txt + plans.ts) ─► Ideen-Generator ─► ideen/ideen.{json,md}  ◄───┘
                                                                  │
                                       content -- plan ─► plaene/content-JJJJ-kwNN.{json,md}
                                                                  │  1 Freigabe je Woche: content:woche:<kampagne>
                                                                  ▼  (Sales-Freigabe, `sales -- freigeben` nur auf Teds Wort)
            launchd com.heyaudit.sales ─► Job "instagram" (15 min) ─► contentLoopSchritt: intern_pruefen → freigegeben, fällige IG-Posts melden
                                                                  │
                     IG-Runde (Chrome, Skill ig-runde) ─► manuell posten ─► content -- veroeffentlicht <pubId> --url
                     Metricool (wenn verbunden)         ─► content -- uebergabe --schreiben (Entwurf; Auto-Publish nur mit Schalter)
                                                                  │
   Interessent ─► heyaudit.de/<seite>?utm_campaign=ig-2026-kw48-cv2 ─► Demo-/Registrierungsformular der App
             ─► Benachrichtigung „Kampagne: instagram / ig-2026-kw48-cv2“ ─► Sales inbound (IMAP) ─► Lead + Aufgaben (bestehend)
   DM mit ausdrücklicher Anfrage ─► sales -- ig-antwort … --content ig-2026-kw48-cv2 ─► Lead (bestehend)
                                                                  │
                     content -- bericht ─► berichte/JJJJ-KWnn-content.md (liest Sales nur)
```

## IDs und UTM

| Objekt | Beispiel | Bedeutung |
|---|---|---|
| Kampagne | `content-2026-kw48` | eine Redaktionswoche |
| Content-ID | `cv-2026kw48-2` | Kernvideo, Slot 2 (Di) |
| Veröffentlichung | `cv-2026kw48-2.ig` | Kernvideo × Plattform |
| utm_campaign | `ig-2026-kw48-cv2` | trägt die Content-ID; Kürzel ig/tt/yt/fb/li |
| utm_content | `idee-m-qr-objekt` | Idee. Die App speichert **nur** source + campaign, deshalb steht die Content-ID in `utm_campaign`. |

Die Growth-OS-Motivkampagnen (`ig-2026-kw47-planung`) sind bewusst nicht als Content-Kampagne lesbar.

## Statusfluss je Veröffentlichung

`entwurf → intern_pruefen → freigegeben → (geplant | manuell_veroeffentlichen) → veroeffentlicht`

- Seitenzweige: `fehlgeschlagen` (→ geplant/manuell/verworfen) und `verworfen`.
- `nicht_vorgesehen` steht für ein fehlendes Konto oder fehlenden Formatfit. Solche Varianten zählen nicht als Veröffentlichung.
- Ein unerlaubter Wechsel wirft einen Fehler.
- Eine zweite URL für eine bereits veröffentlichte Variante wird abgewiesen (Doppelpost-Sperre).

## Befehle

Alle Befehle laufen aus `packages/tedos-engine`. `./content.sh …` liest die Zugänge aus dem Keychain, `npm run content -- …` liest sie nur aus der Umgebung.

| Zweck | Befehl |
|---|---|
| Zustand und Zugänge (nur „gesetzt/nicht gesetzt“) | `./content.sh status` |
| Recherche-Kandidaten übernehmen | `./content.sh recherche-import <kandidaten.json>` |
| Transparente Rangliste | `./content.sh rangliste` → `recherche/rangliste.md` |
| Erhebungsplan + Kostenschätzung | `./content.sh apify-plan --ziel 300` |
| Erhebung (Pilot 300, Ausbau bis 1.000) | `CONTENT_APIFY_BUDGET_USD=2 ./content.sh apify-lauf --batches 1` |
| Videos manuell/aus Export | `./content.sh video-import <videos.json>` |
| Ideenvorrat | `./content.sh ideen` |
| Redaktionsplan + Wochenfreigabe | `./content.sh plan [--woche 2026-KW49]` |
| Freigaben übernehmen (macht der Loop) | `./content.sh loop` |
| Heute fällige IG-Posts | `./content.sh ig-faellig` |
| Veröffentlichung zurückmelden | `./content.sh veroeffentlicht cv-2026kw48-2.ig --url https://www.instagram.com/reel/…` |
| Kennzahlen eintragen | `./content.sh kennzahlen cv-2026kw48-2.ig --views 812 --likes 40 --linkklicks 3 --quelle "IG Insights 2026-11-30"` |
| Metricool-Übergabe | `./content.sh uebergabe` (Trockenlauf) · `--schreiben` |
| Notion | `./content.sh notion` (Trockenlauf bzw. Export) · `--schreiben` |
| Wochenbericht Content → Sales | `./content.sh bericht [--woche 2026-KW48]` |

`konten.json` im Zustand legt fest, welche HeyAudit-Konten belegt sind. Standard ist nur Instagram (`@heyauditapp`). Beispiel:

```json
{ "konten": { "instagram": { "verbunden": true, "handle": "heyauditapp", "metricool": false },
              "linkedin":  { "verbunden": true, "belegt": "Unternehmensseite bestätigt am …" } },
  "wochenmix": { "TOFU": 3, "MOFU": 2, "BOFU": 2 } }
```

## Zugänge (nie im Repo, nie im Chat)

| Dienst | Keychain-Dienst / Variable | Ohne Zugang |
|---|---|---|
| Apify | `heyaudit-apify` → `APIFY_TOKEN`; Budget `CONTENT_APIFY_BUDGET_USD` | nur Plan + Kostenschätzung |
| Notion | `heyaudit-notion` → `NOTION_TOKEN`; `NOTION_PARENT_PAGE` (Seite, die mit der Integration geteilt ist) oder `NOTION_DB_*` für bestehende Datenbanken | CSV- und Schema-Export in `notion-export/` |
| Metricool | `heyaudit-metricool` → `METRICOOL_USER_TOKEN`; `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID`. API braucht den Advanced- oder Custom-Tarif. | freigegeben → `manuell_veroeffentlichen` |
| Auto-Publish | `CONTENT_AUTOPUBLISH=ja-auto-publish`, nur zusammen mit verbundenem Konto und gültiger Variante | Entwurf (`draft:true`) |

Anlegen ohne Anzeige: `read -rs T; security add-generic-password -s heyaudit-notion -a heyaudit -w "$(printf %s "$T" | base64)"; unset T`

## Scoring

**Video:** Perzentil **innerhalb der Plattform**. Komponenten und Gewichte:

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
| Formatqualität (`recherche/formatqualitaet.json`, 0–1, manuell) | .15 |

Jede Lücke steht in der Rangliste. Rohe Follower- oder View-Zahlen gehen nie direkt ein.

## Regeln, die der Code erzwingt (Tests in `src/content/content.test.ts`)

- Recherche-Accounts und Videos sind keine Leads. Das Content-Modul ruft weder `ingest` noch `validateEvent` auf und versendet keine Mails.
- Likes, Views und Kommentare erzeugen keine Kontakte. Eine DM wird nur dann zum Lead, wenn sie per `sales -- ig-antwort` als ausdrückliche Anfrage erfasst ist.
- **Faktenbindung:**
  - Produktaussagen kommen nur aus `fakten.ts`, sonst steht ein Platzhalter `[[…]]` da.
  - Vorher/Nachher und Kundengeschichten bleiben gesperrt, bis ein echter Fall mit Freigabe vorliegt.
- **Plattformgrenzen:**
  - Instagram: höchstens 5 Hashtags
  - TikTok: keine Zeilenumbrüche
  - YouTube: Titel höchstens 100 Zeichen
  - Markenprüfung aus `growth-os/content-plan.ts` (duzen, keine erfundenen Preise oder Wirkungszahlen)
- **Apify:**
  - Ohne Budget gibt es keinen Lauf.
  - Jeder Lauf hat `maxTotalChargeUsd`.
  - Captions und Videos werden nicht gespeichert, nur Kennzahlen und die eigene Analyse.
- **Notion:** Upsert über „Externe ID“. Das Journal macht Wiederholungen ohne Aufruf möglich und ermöglicht die Wiederaufnahme nach Teilfehlern. Bei 429/529 wird `Retry-After` beachtet.
- **Metricool:** Ein Journal und ein Abgleich gleicher Text/gleicher Tag verhindern Doppelposts. Die Tageslimits je Plattform werden geprüft.

## Bekannte Grenzen

- **Instagram-Link:** Die Bio hat nur einen Link. Für UTM je Post muss der Bio-Link am Veröffentlichungstag auf den Link aus `ig-faellig` gesetzt werden.
- **Opportunities:** Das Sales-System führt sie nicht als eigene Stufe. Der Bericht nimmt „gehaltene qualifizierte Demo“ als Näherung.
- **Datenaufbewahrung:** Rohdaten der Recherche bitte nach 12 Monaten neu erheben oder löschen (`recherche/*.json`). Sie enthalten nur öffentliche Business-Daten.
