#!/usr/bin/env bash
# Nachschub fuer den Versandpool — laeuft nachts, beruehrt den Versand nicht.
#
# WARUM ES DIESES SKRIPT GIBT
# Am 20.08.2026 reichte der Pool noch drei Tage. Gleichzeitig lagen 919 Leads
# im CRM, die nur deshalb nicht versandfaehig waren, weil ihre Adresse fehlte
# oder unbelegt war — 558 ohne Adresse, 361 unbelegt. Das ist kein Mangel an
# Leads, sondern ein Mangel an nachgetragenen Adressen.
#
# DREI SCHRITTE, IN DIESER REIHENFOLGE
#   1. Impressen lesen   § 5 TMG verpflichtet zur Kontaktadresse; genau die
#                        wird gelesen, mit Domain-Abgleich. Keine geratenen
#                        "info@"+Domain — die waren nachweislich die Ursache
#                        der Bounces (Batch 98 mit belegten Adressen: 0 von 20).
#   2. Uebernehmen       fuellt NUR leere Felder, nie ueberschreiben, mit
#                        Backup und Herkunftsvermerk.
#   3. Pool neu bauen    rankt alle versandfaehigen Leads nach Aehnlichkeit zu
#                        den 41 belegten Kaeufern.
#
# Der Versand liest den Pool erst am naechsten Morgen — die beiden Laeufe
# koennen sich also nicht in die Quere kommen, solange dieses Skript nachts
# laeuft und taeglich.sh morgens.
#
#   ./recherche.sh            # scharf
#   ./recherche.sh --dry      # nur lesen und berichten, nichts schreiben
#   ./recherche.sh --limit 80 # kleinere Portion
#
# KEIN SMTP, KEIN VERSAND. Dieses Skript verschickt nichts. Es braucht weder
# Keychain noch Master-Switch; im schlimmsten Fall bleibt der Pool, wie er war.

set -uo pipefail
cd "$(dirname "$0")"

CRM_DIR="/Users/tedosammor/Desktop/TedOS/Sales/crm-heycarbo"
POOL_DIR="/Users/tedosammor/Desktop/TedOS/Sales/leads-zulieferer"
POOL="$POOL_DIR/versandpool-aktuell.csv"
DATUM="$(date +%Y-%m-%d)"
ENGINE="$(pwd)"
# Absolut, weil das Skript in andere Verzeichnisse wechselt.
PROTOKOLL="$ENGINE/.revenue-reports/recherche-${DATUM}.log"
mkdir -p .revenue-reports

DRY=""
LIMIT=150
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY="1"; shift ;;
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "Unbekannt: $1" >&2; exit 1 ;;
  esac
done

sagen() { echo -e "\n\033[1m$*\033[0m" | tee -a "$PROTOKOLL"; }
fehler() { echo "⛔ $*" | tee -a "$PROTOKOLL" >&2; exit 1; }

sagen "═══ Lead-Recherche $DATUM $( [[ -n "$DRY" ]] && echo '(Trockenlauf)' ) ═══"

# --- 1) Impressen lesen -----------------------------------------------------
sagen "1/3 · Adressen aus Impressen lesen (max. $LIMIT)"
cd "$CRM_DIR" || fehler "CRM-Verzeichnis fehlt"
node enrich-emails.mjs --limit "$LIMIT" 2>&1 | tee -a "$PROTOKOLL" | \
  grep -E "Ziele|gefunden|Dublette|keine Adresse|nicht erreichbar|TLS|📄"
[[ "${PIPESTATUS[0]}" -ne 0 ]] && fehler "enrich-emails fehlgeschlagen"

TREFFER="$POOL_DIR/email-anreicherung-${DATUM}.csv"
if [[ ! -f "$TREFFER" ]]; then
  echo "   Keine Ergebnisdatei — nichts gefunden." | tee -a "$PROTOKOLL"
  NEU=0
else
  # Kopfzeile zaehlt nicht mit.
  NEU=$(($(wc -l < "$TREFFER") - 1))
  echo "   $NEU neue Adressen" | tee -a "$PROTOKOLL"
fi

# --- 2) Uebernehmen ---------------------------------------------------------
sagen "2/3 · Ins CRM übernehmen"
if [[ "$NEU" -le 0 ]]; then
  echo "   Nichts zu übernehmen." | tee -a "$PROTOKOLL"
elif [[ -n "$DRY" ]]; then
  node apply-enrichment.mjs "$TREFFER" 2>&1 | tee -a "$PROTOKOLL" | tail -3
else
  node apply-enrichment.mjs "$TREFFER" --apply 2>&1 | tee -a "$PROTOKOLL" | tail -2
  [[ "${PIPESTATUS[0]}" -ne 0 ]] && fehler "Übernahme fehlgeschlagen — CRM unverändert (Backup liegt vor)"
fi

# --- 3) Versandpool neu bauen ----------------------------------------------
sagen "3/3 · Versandpool neu bauen"
if [[ -n "$DRY" ]]; then
  # In eine Nebendatei schreiben, damit der scharfe Pool unberuehrt bleibt.
  node lookalike.mjs --csv --min=0 --pool="/tmp/versandpool-probe.csv" 2>&1 | \
    tee -a "$PROTOKOLL" | grep -E "Offen im CRM|^    −|Kandidaten|📄|davon"
else
  # Vorherigen Pool sichern: faellt der Bau schief aus, laesst sich der Stand
  # von gestern zurueckholen, ohne ihn neu berechnen zu muessen.
  [[ -f "$POOL" ]] && cp "$POOL" "$POOL.bak-${DATUM}"
  node lookalike.mjs --csv --min=0 --pool="$POOL" 2>&1 | \
    tee -a "$PROTOKOLL" | grep -E "Offen im CRM|^    −|Kandidaten|📄|davon"
  [[ "${PIPESTATUS[0]}" -ne 0 ]] && fehler "Poolbau fehlgeschlagen — alter Pool liegt unter $POOL.bak-${DATUM}"
fi

if [[ -f "$POOL" ]]; then
  GESAMT=$(($(wc -l < "$POOL") - 1))
  sagen "Fertig. Pool: $GESAMT Leads (~$((GESAMT / 20)) Versandtage). Protokoll: $PROTOKOLL"
else
  sagen "Fertig. Protokoll: $PROTOKOLL"
fi
