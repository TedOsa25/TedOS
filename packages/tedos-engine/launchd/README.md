# Automatischer Betrieb

Zwei `launchd`-Agents fahren den Outbound-Kanal ohne Zutun. Die Dateien hier
sind die versionierte Fassung; im Betrieb liegen sie unter
`~/Library/LaunchAgents/`.

| Agent | Wann | Was |
|---|---|---|
| `com.heycarbo.versand` | Mo–Fr **09:07**, nachholbar bis **11:00** | `taeglich.sh --geplant` — Posteingang, Erstkontakt (20), Nachfassen (20) |
| `com.heycarbo.recherche` | Mo–Fr **22:41** | `recherche.sh --limit 200` — Impressen lesen, CRM ergänzen, Pool neu bauen |

Die Reihenfolge ist der Punkt: der Poolbau läuft abends, der Versand liest den
Pool am nächsten Morgen. So kann sich ein Poolbau nie mit einem laufenden Batch
überschneiden.

Krumme Minuten (09:07, 22:41) statt voller Stunden — das verteilt die Last und
sieht weniger nach Maschine aus.

## Einrichten

```bash
cp launchd/*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.heycarbo.versand.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.heycarbo.recherche.plist
```

## Prüfen, anhalten, von Hand starten

```bash
launchctl print gui/$(id -u)/com.heycarbo.versand | grep -E "state|runs|last exit"
launchctl bootout   gui/$(id -u)/com.heycarbo.versand      # anhalten
launchctl kickstart -p gui/$(id -u)/com.heycarbo.recherche # sofort starten
```

`kickstart` auf `com.heycarbo.versand` **versendet echte Mails.** Zum Proben
stattdessen `./taeglich.sh --dry` — aber Achtung, ein Trockenlauf hinterlässt
20 freigegebene Leads, die beim nächsten scharfen Lauf mitfahren.

## Was passiert, wenn der Rechner aus war

**Versand: Nachhol-Fenster 09:07–11:00.** War der Rechner um 09:07 aus, fällt
der Kalender-Slot ersatzlos aus — eine frisch angemeldete `launchd`-Sitzung
weiß nichts von einem verpassten Termin. Genau so ging der 21.08.2026 verloren
(Boot 09:58, kein Versand, kein Alarm). Deshalb startet der Agent zusätzlich
beim Anmelden (`RunAtLoad`) und ruft `taeglich.sh --geplant`.

Der Torwächter sitzt im **Skript**, nicht in der Plist: `launchd` kann Werktag
und Uhrzeit prüfen, aber nicht „heute wurde schon versendet". Ohne Versand
beendet sich der Lauf bei

- Wochenende
- vor 09:07 (der Kalender-Slot feuert gleich selbst)
- ab 11:00 — Kaltakquise um 23 Uhr ist schlimmer als ein ausgefallener Tag
- `.revenue-state/letzter-versandtag` trägt bereits das heutige Datum

Jeder übersprungene Lauf schreibt seinen Grund nach
`.revenue-reports/uebersprungen.log`. **`./taeglich.sh` von Hand kennt weder
Fenster noch Stempel** — wer tippt, hat sich etwas dabei gedacht.

Der Stempel wird *vor* dem Versand gesetzt: ein Absturz mitten im Batch löst
dadurch keinen zweiten aus. Der Preis ist, dass eine SMTP-Störung den Tag
kostet, obwohl nichts rausging — dann von Hand nachfahren.

Frühere Fassungen begründeten `RunAtLoad=false` damit, es verhindere einen
Versand zur Unzeit. Das hat es nie getan: `RunAtLoad` steuert nur den Start
beim Laden — einen verpassten Kalender-Slot spielt `launchd` beim Aufwachen aus
dem Schlaf trotzdem nach. Erst der Wächter im Skript deckt beide Wege ab.

**Recherche: nichts wird nachgeholt** (`RunAtLoad` bleibt `false`). Folgenlos —
der Pool von gestern bleibt stehen und wird beim nächsten Lauf neu gebaut.

## Voraussetzungen

- **Angemeldete Sitzung mit entsperrtem Schlüsselbund.** Beide Agents laufen im
  Benutzerkontext (`gui/$(id -u)`), deshalb kommt `security find-generic-password`
  ohne Rückfrage an `heycarbo-smtp` und `supabase-service-key`. Geprüft am
  20.08.2026 mit einem Probe-Agent.
- Ist der Schlüsselbund gesperrt, bricht `taeglich.sh` in Schritt 1 ab und
  versendet **nichts** — gewollt, statt auf halber Strecke loszulaufen.
- `recherche.sh` braucht weder Keychain noch SMTP; es verschickt nichts.

## Protokolle

```
.revenue-reports/launchd-versand.log      # stdout/stderr des Agents
.revenue-reports/launchd-recherche.log
.revenue-reports/uebersprungen.log        # Laeufe, die der Waechter gestoppt hat — mit Grund
.revenue-reports/taeglich-JJJJ-MM-TT.log  # der eigentliche Ablauf
.revenue-reports/recherche-JJJJ-MM-TT.log
```
