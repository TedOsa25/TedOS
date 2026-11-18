# Alte launchd-Jobs vom iCloud-Desktop: Bestand, Umzug, Rückweg

Stand 18.11.2026. Der iCloud-Checkout `~/Desktop/TedOS/ai-os` ist ausgelagert. Jeder Lesezugriff endet mit „Operation timed out“, auch auf `.git/HEAD`, die Skripte und `runtime/`. Deshalb scheitern die Jobs. Geprüft wird mit `./altjobs-umzug.sh pruefen`.

| Job | Zeitplan | Skript / Checkout | Laufzeitpfad | Zustand | Im Git-Remote? |
|---|---|---|---|---|---|
| `com.heycarbo.recherche` | Mo–Fr 21:41 | `ai-os/packages/tedos-engine/recherche.sh --limit 200 --marke heycarbo` | `ai-os/…/runtime`, Log `ai-os/…/.revenue-reports/launchd-recherche.log` | geladen, exit 126 | ja: `recherche.sh` auf `tedos/evidence-engine` |
| `com.tedos.neue-leads` | täglich 19:13 | `ai-os/packages/tedos-engine/neue-leads.sh` (Places HeyCarbo + HeyAudit, je 200) | `ai-os/…/runtime/neue-leads`, Log `…/launchd-neue-leads.log` | geladen, exit 126 | **nein**, nur lokal im iCloud-Checkout |
| `com.heyaudit.growth-briefing` | täglich 08:00 | `~/dev/tedos-growth/packages/tedos-engine/growth-briefing.sh` | `RUNTIME=ai-os/…/runtime/heyaudit`, Log auf iCloud | geladen, exit 1 | **nein**: `src/growth-os` ist in keinem Remote. `~/dev/tedos-growth/.git` zeigt auf iCloud. Sicherung: `~/dev/tedos-runtime/backups/tedos-growth-arbeitsbaum-20261118.tgz` |
| `com.heyaudit.versand`, `com.heycarbo.versand` | — | — | — | entladen und deaktiviert seit 08.10. | **wird nicht angefasst** |

## Doppelungen und Risiken

- **HeyAudit-Places-Recherche läuft doppelt.**
  - `com.tedos.neue-leads` recherchiert 200 Firmen pro Tag und importiert sie mit `staging:import --schreiben --freigeben` automatisch in den Versandpool.
  - `com.heyaudit.sales` → `recherche` recherchiert 10 Firmen pro Tag als reine Zielaccounts, ohne Kontaktfreigabe.
  - Beide Jobs nutzen dasselbe GCP-Projekt, dessen Abrechnungskonto geschlossen ist.
  - Empfehlung: den HeyAudit-Teil von `neue-leads` **nicht** wieder aktivieren. Ein automatischer Import mit `--freigeben` widerspricht „Recherche ist keine Kontaktfreigabe“ und dem Versandstopp vom 08.10.
- `com.heycarbo.recherche` füllt nur den HeyCarbo-Versandpool. Der Versand ist gestoppt, der Job bringt also zurzeit keinen Nutzen.
- `growth-briefing` führt vor dem Bericht `growth:ausfuehren` aus. Das bleibt durch den Hauptschalter `ausfuehren.json {"scharf": true}` gesperrt. Der Schalter liegt ebenfalls auf iCloud und ist darum nicht prüfbar.

## Umzug (erst nach Freigabe)

1. **iCloud-Dateien zurückholen**: Im Finder `~/Desktop/TedOS/ai-os` → Rechtsklick → „Jetzt laden“, oder iCloud-Speicher prüfen. Danach muss `./altjobs-umzug.sh pruefen` überall „ok“ zeigen.
2. **Ungesicherten Code sichern**, bevor etwas umzieht:
   - `neue-leads.sh` und `src/growth-os/` auf je einen Feature-Branch committen und pushen. Das braucht deine Freigabe.
   - `runtime/` (Sperrlisten, Staging, Lead-Status) nach `~/dev/tedos-runtime/engine` kopieren.
3. **Checkouts in ~/dev anlegen**:
   - `git clone … ~/dev/tedos-heycarbo` (Branch `tedos/evidence-engine`)
   - `~/dev/tedos-neue-leads` vom neuen Branch
   - `~/dev/tedos-growth` als eigenständigen Klon statt als Worktree
4. Pro Job `./altjobs-umzug.sh umziehen <job>`. Das Skript:
   - sichert die Original-Plist nach `~/dev/tedos-runtime/launchd-sicherung/`
   - stellt die Pfade auf `~/dev` um
   - prüft die Plist mit `plutil -lint` und lädt den Job neu
5. Ersten Lauf manuell mit `launchctl kickstart gui/$(id -u)/<job>` anstoßen und Exitcode und Log prüfen.

**Rückweg:** `./altjobs-umzug.sh zurueck <job>` stellt die gesicherte Original-Plist wieder her und lädt sie neu.

**Abschalten ohne Umzug:** `launchctl bootout gui/$(id -u)/<job>`. Die Plist bleibt liegen, der Rückweg ist `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<job>.plist`.
