# Automatischer Betrieb

Zwei `launchd`-Agents fahren den Outbound-Kanal ohne Zutun. Die Dateien hier
sind die versionierte Fassung; im Betrieb liegen sie unter
`~/Library/LaunchAgents/`.

| Agent | Wann | Was |
|---|---|---|
| `com.heycarbo.versand` | Mo–Fr **09:07** | `taeglich.sh` — Posteingang, Erstkontakt (20), Nachfassen (20) |
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

Nichts wird nachgeholt (`RunAtLoad` ist `false`, kein `StartInterval`-Nachzug).
Beim Versand ist das Absicht: ein verpasster Lauf, der um 23 Uhr oder am
Samstag nachgezogen wird, ist schlimmer als ein ausgefallener Tag. Der Pool
altert derweil nicht — er wird beim nächsten Recherche-Lauf ohnehin neu gebaut.

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
.revenue-reports/taeglich-JJJJ-MM-TT.log  # der eigentliche Ablauf
.revenue-reports/recherche-JJJJ-MM-TT.log
```
