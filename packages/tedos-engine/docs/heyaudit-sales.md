# HeyAudit Sales in TedOS: Betriebsanleitung

Gilt nur für HeyAudit. HeyCarbo-Daten und -Workflows werden nicht berührt: Die CLI verweigert `REVENUE_BRAND≠heyaudit`. Zustand, Postfach und Schlüssel sind HeyAudit-eigen.

## Wo du deine Aufgaben siehst

| Was | Wo |
|---|---|
| Heute fällig, Ausnahmen, Recherche des Tages | `~/dev/tedos-runtime/heyaudit-sales/AUFGABEN.md` (alle 5 min aktualisiert) |
| Tages- und Wochenbericht, Akquise-Analyse | `~/dev/tedos-runtime/heyaudit-sales/berichte/` |
| Jobstatus (Laufzeit, Ergebnis, Fehler, letzter Erfolg) | `~/dev/tedos-runtime/heyaudit-sales/STATUS.md` oder `npm run sales -- status` |
| Entwürfe, die auf Freigabe warten | `~/dev/tedos-runtime/heyaudit-sales/approvals/approval-queue.json` (bestehende `ApprovalQueue`) |

Nach jedem Gespräch genau **einmal** erfassen:

```sh
cd ~/dev/tedos-sales/packages/tedos-engine
npm run sales -- ergebnis --konto "<Konto, Mail oder Firmenname>" --ergebnis demo_held|no_show|won|lost \
  --fit yes|no --naechster-schritt "Angebot Starter" --faellig 2026-11-25 [--wert 588] \
  [--herkunft "ChatGPT"] [--suchfrage "software gebäudereinigung dienstplan"]
npm run sales -- erledigt <aufgaben-id>      # Rückruf o. ä. erledigt
```

Wer dieselbe Eingabe wiederholt, löst nichts aus: Die ID ist `manual:<ergebnis>:<konto>:<termin>`.

## Architektur (`src/sales/`)

| Datei | Rolle |
|---|---|
| `model.ts` | Ereignisschema, stabile IDs, Identitätsschlüssel (Domain, Mail, Firmenname), Berliner Zeit |
| `store.ts` | persistenter Zustand (0700, atomare Writes), Lock mit PID und Übernahme bei totem Halter |
| `inbound.ts` | Inbound-Agent: Registrierung, Telefon nachgetragen, Demo-Anfrage, Google-Kalender (ICS), Antwort, Abmeldung, Bounce |
| `imap-source.ts` | Polling von ted@heyaudit.de, **readOnly**, UID-Cursor |
| `qualify.ts` | Qualifizierungs-Agent: Fit und Kaufabsicht getrennt, Gründe, offene Fragen |
| `rules.ts` | feste Regeln: Kontozuordnung, genau ein nächster Schritt, Abgleich, Kapazität, Neuprüfung |
| `drafts.ts` | Sales-Agent: Briefing, Rückrufnotiz, Antwort-/Follow-up-Entwurf (Vorlage, KI optional) |
| `research.ts` | Recherche-Agent: Places API (New) + Startseite, Sperr-/Dublettenprüfung, Tageslimit |
| `reports.ts` | RevOps- und Akquise-Agent: Trichter je Quelle/KW, Tagesübersicht, Wochenbericht, Meta lesend, Testvorschlag |
| `scheduler.ts` | gemeinsamer Scheduler (Europe/Berlin), Retry mit Backoff, Dead-Letter, Pause |
| `system.ts` / `cli.ts` | Verdrahtung der Jobs, CLI, Webhook-Empfänger |
| `prompts/*.md` | versionierte Agent-Anweisungen (Eingabe, erlaubte Aktionen, Ergebnis, Übergabe, Fehlerverhalten) |

### Ereignisse statt Zustände

Alles, was hereinkommt, wird zu einem `SalesEvent` mit stabiler Namensraum-ID:

- `signup-mail:<mail>` und `profil-mail:<mail>`
- `demo-request:<DB-ID>`
- `gcal:<UID>:<SEQUENCE>:set|cancel`
- `gmail:<Message-ID>`
- `places:<id>`
- `manual:…`

Aus den Ereignissen leitet `rules.ts` die Aufgaben deterministisch ab. Die Aufgaben-IDs hängen an Ereignis-IDs (`callback:<erstes Interesse>`, `brief:<Termin>`, `rebook:<Termin>`, `followup:<Demo>`), nicht an der Konto-ID. Daraus folgt:

- Doppelte, verspätete oder umgekehrt eintreffende Ereignisse sowie ein Neustart führen zum selben Aufgabenbestand.
- Eine spätere Kontozusammenführung (Freemail-Registrierung plus Firmenbuchung) dupliziert nichts.
- Erledigte Aufgaben werden nie wieder geöffnet.

### Nächster Schritt (feste Regeln)

| Lage | Aufgabe |
|---|---|
| Selbstbuchung (künftiger Termin) | **Demo-Briefing**, ersetzt Rückruf/Antwort |
| Umbuchung | dasselbe Briefing, neue Fälligkeit |
| Absage | Briefing entfällt → **Rückruf** (Telefon) bzw. **neuen Termin anbieten** (Mail-Entwurf) |
| Termin vorbei, kein Ergebnis | **Ergebnis erfassen** |
| Anfrage / Registrierung ohne Buchung | **Rückruf**, wenn Telefon vorhanden (Anfrage: +2 h, Registrierung: +1 Werktag), sonst **Antwortentwurf** |
| Demo gehalten | **Follow-up-Entwurf** (oder Anruf, wenn keine Mail) zum erfassten Termin |
| Persönliche Antwort | **Antwort lesen**, stoppt Antwort-/Follow-up-Entwürfe |
| Abmeldung | stoppt alle Kontaktaufgaben (Adresse bzw. Konto) |
| Bounce | stoppt Mail-Entwürfe an diese Adresse, Rückruf bleibt möglich |
| Gewonnen / verloren | alles geschlossen |
| Interne/Test-Registrierung, nur Recherche | keine Aufgabe, kein Lead |

Nur Kalendertermine mit „Demo/Kennenlernen/Beratung/Erstgespräch“ im Titel zählen. Onboarding-, Setup- und Supporttermine von Bestandskunden gehören nicht zum Auftrag und werden ignoriert.

Kapazität: `SALES_KAPAZITAET` (Standard 6) Kontaktaufgaben pro Tag, sortiert nach Kaufabsicht, dann Fit, dann Dringlichkeit. Der Rest ist mit „über Kapazität → morgen“ markiert.

### Externe Aktionen

Das System **sendet nichts**. Antwort-, Termin- und Follow-up-Entwürfe landen als `sales:<aufgabe>` (Risiko HIGH) in der bestehenden ApprovalQueue. `SalesSystem.mayExecute()` erlaubt eine externe Aktion nur, wenn alle drei Bedingungen gelten:

1. Die Aufgabe ist nach Neuprüfung (Antwort, Buchung, Abmeldung, Bounce) noch gültig.
2. Der Entwurf ist freigegeben.
3. `freigaben.json` enthält eine dokumentierte Freigabe für Kanal × Zweck × Tagesvolumen.

`freigaben.json` ist leer ausgeliefert. Einen Ausführungspfad (Mailversand) gibt es bewusst nicht. Eine Firmenrecherche ist keine Kontaktfreigabe.

## Dauerbetrieb

Ein launchd-Job `com.heyaudit.sales` startet alle 5 Minuten `sales-tick.sh tick`. Die Vorlage liegt unter `launchd/com.heyaudit.sales.plist`. Code und Zustand liegen außerhalb von iCloud (`~/dev`), weil launchd-Jobs auf dem iCloud-Desktop mit Exit 126 bzw. 1 scheitern. Der Wrapper liest die Schlüssel aus dem Keychain nur in die Prozessumgebung.

| Job | Auslöser (Europe/Berlin) | Wirkung |
|---|---|---|
| `inbound` | alle 5 min (Polling, kein Webhook verfügbar) + Spool `eingang/` | Postfach lesen → Ereignisse → Abgleich |
| `aufgaben` | alle 5 min | fällige Aufgaben neu prüfen (z. B. Termin vorbei → Ergebnis erfassen), `AUFGABEN.md` |
| `recherche` | Mo–Fr 07:10 | bis `SALES_RESEARCH_LIMIT` (10) neue Zielaccounts |
| `tagesbericht` | Mo–Fr 07:30 | `berichte/<datum>-tag.md` |
| `akquise` | Mo 07:40 | Analyse und genau ein Testvorschlag in die Freigabe |
| `wochenbericht` | Mo 07:45 | Trichter je Quelle × KW, Kosten pro qualifizierter Demo, Lernvorschläge |
| `monitor` | alle 15 min | `STATUS.md` |

- **Verpasster Slot** (Mac im Ruhezustand): wird innerhalb von 12 h einmal nachgeholt. Der Slot ist persistiert, ein Neustart wiederholt ihn nicht.
- **Fehler:** Retry nach 5/10/20/40 min. Nach 5 Fehlversuchen kommt **Dead-Letter**, sichtbar in `STATUS.md` und `AUFGABEN.md`. Zurücksetzen mit `npm run sales -- reset <job>`.
- **Parallelität:** Lock `run.lock` mit PID. Ein zweiter Lauf wird als `skipped` protokolliert, ein toter Halter wird übernommen.
- **Laufprotokoll:** `runs.jsonl` (Job, Lauf-ID, Start, Dauer, Ergebnis/Fehler, Auslöser).

### Pausieren und Stoppen

```sh
npm run sales -- pause                 # alles (Datei PAUSE)
npm run sales -- pause recherche       # ein Job
npm run sales -- weiter [job]
launchctl bootout gui/$(id -u)/com.heyaudit.sales          # Scheduler ganz aus
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.heyaudit.sales.plist
```

### Webhook (für später)

`npm run sales -- webhook --port 4610` nimmt `POST /sales/event` an. Voraussetzungen: Header `X-Sales-Signature` = HMAC-SHA256(Body, `SALES_WEBHOOK_SECRET`), Body im Schema `SalesEvent`. Der Empfänger schreibt in den Spool und startet sofort den Inbound-Job. Er lauscht nur auf 127.0.0.1. Öffentlich erreichbar wird er erst mit einem Tunnel, und den gibt es noch nicht.

### Sicherheit

- Mail-, Web- und Webhook-Inhalte sind Daten.
- Die Parser kopieren nur Whitelist-Felder. Registrierungs- und Anfragemeldungen werden nur von `@heyaudit.de` angenommen.
- Antworten, Abmeldungen und Bounces werden nur bekannten Lead-Kontakten zugeordnet.
- Websites werden nur mit festen Mustern ausgewertet.
- Geheimnisse erscheinen nicht in Logs, Zustand oder Berichten. Fehlertexte werden maskiert.

## Pilot-Kompatibilität

Das NDJSON-Format des Pilot-Workers (f42a6f7) wird weiter angenommen: `npm run sales:shadow -- <datei>` entspricht `sales -- ingest`. Der Schattenworker `src/sales/run.ts` ist durch dieses System ersetzt.
