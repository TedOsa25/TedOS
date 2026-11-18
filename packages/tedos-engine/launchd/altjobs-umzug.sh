#!/bin/bash
# Umzug der alten launchd-Jobs vom iCloud-Desktop nach ~/dev — mit Rückweg.
#
#   ./altjobs-umzug.sh pruefen            # Standard: nur prüfen, nichts ändern
#   ./altjobs-umzug.sh umziehen <job>     # NUR nach Freigabe: Plist sichern, Pfade umstellen, neu laden
#   ./altjobs-umzug.sh zurueck  <job>     # Rückweg: gesicherte Original-Plist wiederherstellen
#
# Jobs: com.heycarbo.recherche | com.tedos.neue-leads | com.heyaudit.growth-briefing
# Versand-Jobs (com.heyaudit.versand, com.heycarbo.versand) werden NIE angefasst:
# Sie sind seit 08.10. entladen und deaktiviert und bleiben es.
set -uo pipefail

ICLOUD="$HOME/Desktop/TedOS/ai-os"
LA="$HOME/Library/LaunchAgents"
SICHERUNG="$HOME/dev/tedos-runtime/launchd-sicherung"
UID_="$(id -u)"

# Ziel je Job: Checkout in ~/dev, Laufzeitpfad in ~/dev/tedos-runtime.
ziel_checkout() {
  case "$1" in
    com.heycarbo.recherche) echo "$HOME/dev/tedos-heycarbo" ;;      # Branch tedos/evidence-engine (recherche.sh liegt dort im Remote)
    com.tedos.neue-leads) echo "$HOME/dev/tedos-neue-leads" ;;      # neue-leads.sh ist in KEINEM Remote → erst aus iCloud holen und committen
    com.heyaudit.growth-briefing) echo "$HOME/dev/tedos-growth" ;;  # Arbeitsbaum ok, aber .git zeigt auf iCloud
  esac
}
ziel_runtime() { echo "$HOME/dev/tedos-runtime/engine"; }   # ersetzt ai-os/packages/tedos-engine/runtime + .revenue-reports

lesbar() { perl -e 'alarm 8; open(my $f, "<", $ARGV[0]) or exit 1; my $n = sysread($f, my $b, 64); exit(defined($n) && $n > 0 ? 0 : 1)' "$1" 2>/dev/null; }

pruefen() {
  echo "== Doppelte oder verbotene Jobs"
  for j in com.heyaudit.versand com.heycarbo.versand; do
    launchctl print-disabled "gui/$UID_" | grep -q "\"$j\" => disabled" && echo "  $j: deaktiviert (bleibt so)" || echo "  WARNUNG $j: nicht deaktiviert"
  done
  echo "  Places-Recherche HeyAudit: com.tedos.neue-leads (200/Tag → Versandpool) UND com.heyaudit.sales/recherche (10/Tag → Zielaccounts) = DOPPELT"
  echo "== Lesbarkeit iCloud (ohne lesbare Dateien ist kein Umzug möglich)"
  for f in "$ICLOUD/.git/HEAD" "$ICLOUD/packages/tedos-engine/neue-leads.sh" "$ICLOUD/packages/tedos-engine/recherche.sh" \
           "$ICLOUD/packages/tedos-engine/runtime/suppression/cross-brand.json"; do
    lesbar "$f" && echo "  ok        $f" || echo "  NICHT LESBAR $f"
  done
  echo "== Jobs"
  for j in com.heycarbo.recherche com.tedos.neue-leads com.heyaudit.growth-briefing; do
    ex=$(launchctl print "gui/$UID_/$j" 2>/dev/null | awk -F'= ' '/last exit code/{print $2; exit}')
    echo "  $j  exit=${ex:-?}  ziel=$(ziel_checkout "$j")  sicherung=$([ -f "$SICHERUNG/$j.plist" ] && echo ja || echo nein)"
  done
}

umziehen() {
  local j="$1" co; co="$(ziel_checkout "$j")"
  [ -n "$co" ] || { echo "unbekannter Job $j"; exit 2; }
  [ -d "$co/packages/tedos-engine" ] || { echo "Checkout fehlt: $co (erst anlegen, siehe ALTJOBS.md)"; exit 3; }
  git -C "$co" rev-parse HEAD >/dev/null 2>&1 || { echo "Checkout $co hat kein lesbares .git"; exit 3; }
  mkdir -p "$SICHERUNG" "$(ziel_runtime)/.revenue-reports"
  [ -f "$SICHERUNG/$j.plist" ] || cp -p "$LA/$j.plist" "$SICHERUNG/$j.plist"
  launchctl bootout "gui/$UID_/$j" 2>/dev/null || true
  sed -e "s#$ICLOUD/packages/tedos-engine/.revenue-reports#$(ziel_runtime)/.revenue-reports#g" \
      -e "s#$ICLOUD/packages/tedos-engine#$co/packages/tedos-engine#g" "$SICHERUNG/$j.plist" > "$LA/$j.plist"
  plutil -lint "$LA/$j.plist" >/dev/null || { cp -p "$SICHERUNG/$j.plist" "$LA/$j.plist"; echo "Plist ungültig → Original zurück"; exit 4; }
  launchctl bootstrap "gui/$UID_" "$LA/$j.plist" && echo "$j umgezogen nach $co (Original: $SICHERUNG/$j.plist)"
}

zurueck() {
  local j="$1"
  [ -f "$SICHERUNG/$j.plist" ] || { echo "keine Sicherung für $j"; exit 2; }
  launchctl bootout "gui/$UID_/$j" 2>/dev/null || true
  cp -p "$SICHERUNG/$j.plist" "$LA/$j.plist"
  launchctl bootstrap "gui/$UID_" "$LA/$j.plist" && echo "$j: Original-Plist wiederhergestellt"
}

case "${1:-pruefen}" in
  pruefen) pruefen ;;
  umziehen) umziehen "${2:?job}" ;;
  zurueck) zurueck "${2:?job}" ;;
  *) echo "pruefen | umziehen <job> | zurueck <job>"; exit 2 ;;
esac
