#!/usr/bin/env bash
# Startet einen Produktions-Batch, ohne dass ein Passwort in die Kommandozeile
# oder die Shell-History gerät. Alle Geheimnisse kommen aus dem macOS-Keychain.
#
#   ./send-batch.sh rollout-batch-88-icp        # Versand (Preflight entscheidet)
#   ./send-batch.sh rollout-batch-88-icp --dry  # ohne Master-Switch, reiner Dry-Run
#
# Einmalig anzulegen:
#   security add-generic-password -a ted@heycarbo.com -s heycarbo-smtp        -w '…' -U
#   security add-generic-password -a ted@heycarbo.com -s heycarbo-imap        -w '…' -U
#   security add-generic-password -a heycarbo         -s supabase-service-key -w '…' -U
#
# Warum es dieses Skript gibt: der zuletzt von Hand getippte Aufruf zeigte gleich
# vier Fallen — TEDOS_STORAGE_PATH=.tedos (leerer Store → "0 approved"),
# fehlendes SMTP_SECURE=1 (Pflicht bei Port 465), falsches Arbeitsverzeichnis
# und ein Passwort im Klartext in der History. Hier sind alle vier festgezurrt.

set -euo pipefail
cd "$(dirname "$0")"

CAMPAIGN="${1:-}"
if [[ -z "$CAMPAIGN" ]]; then
  echo "Nutzung: $0 <kampagnen-label> [--dry]" >&2
  echo "Beispiel: $0 rollout-batch-88-icp" >&2
  exit 1
fi

# Werte liegen base64-kodiert im Keychain und werden hier dekodiert.
#
# Grund: `security … -w` gibt Passwörter mit Nicht-ASCII-Zeichen HEX-kodiert
# zurück. Das SMTP-Passwort enthält ein "§" — direkt gelesen kam es doppelt so
# lang heraus und der IONOS-Login scheiterte mit "535 Authentication
# credentials invalid", obwohl derselbe Wert auf der Kommandozeile funktioniert
# hatte. base64 macht den Wert ASCII-sicher und den Weg eindeutig.
kc() { security find-generic-password -s "$1" -w 2>/dev/null | base64 -d 2>/dev/null || true; }

SMTP_PASS="$(kc heycarbo-smtp)"
if [[ -z "$SMTP_PASS" ]]; then
  echo "⛔ Kein SMTP-Passwort im Keychain (Dienst 'heycarbo-smtp')." >&2
  exit 1
fi
SUPABASE_SERVICE_ROLE_KEY="$(kc supabase-service-key)"
if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  # Kein harter Abbruch: der Preflight meldet das selbst und blockiert sauber —
  # so steht der Grund im Batch-Report und nicht nur hier im Terminal.
  echo "⚠ Kein Service-Role-Key im Keychain — der Preflight wird das Abmelde-Register nicht prüfen können."
fi

# --dry lässt den Master-Switch aus: der Lauf baut alles, sendet aber nichts.
ARMED=1
[[ "${2:-}" == "--dry" ]] && ARMED=0

export TEDOS_STORAGE_PATH=./.revenue-state   # NICHT .tedos — der ist leer
export REVENUE_SEND_ENABLED="$ARMED"
export REVENUE_EMAIL_PROVIDER=smtp
export SMTP_HOST=smtp.ionos.de
export SMTP_PORT=465
export SMTP_SECURE=1                          # Pflicht bei 465, sonst hängt der Login
export SMTP_USER=ted@heycarbo.com
export SMTP_PASS
export SUPABASE_SERVICE_ROLE_KEY
export REVENUE_BATCH_SIZE="${REVENUE_BATCH_SIZE:-20}"
# A/B: Tonalitaet auf E festgenagelt, nur der Betreff variiert (3 Arme statt 15).
#
# Der volle Test ueber 5 Tonalitaeten x 3 Betreffe braucht bei der aktuellen
# Antwortquote rund 23.000 Mails fuer 5 Antworten je Arm — so viele Adressen
# gibt der Bestand nicht her. Mit drei Armen reichen ~4.500. Der Betreff
# entscheidet ohnehin zuerst darueber, ob ueberhaupt geoeffnet wird.
#
# Ueberschreibbar: REVENUE_TEST_VARIANTS=A,B,C,D,E ./send-batch.sh …
export REVENUE_TEST_VARIANTS="${REVENUE_TEST_VARIANTS:-E}"
# Keine BCC-Kopie mehr an ted@heycarbo.com. Sie war als Sichtkontrolle beim
# Neustart gedacht; inzwischen liefern Batch-Report, inbox:scan und ab:report
# dieselbe Information, ohne das Postfach mit jeder ausgehenden Mail zu fluten.
# Wieder einschalten: REVENUE_BCC=ted@heycarbo.com ./send-batch.sh …
export REVENUE_BCC="${REVENUE_BCC:-off}"
export REVENUE_CAMPAIGN="$CAMPAIGN"

echo "A/B: Tonalität $REVENUE_TEST_VARIANTS · Betreff variiert über alle drei · BCC: $REVENUE_BCC"
echo "Kampagne: $CAMPAIGN · Batchgröße: $REVENUE_BATCH_SIZE · Master-Switch: $([[ $ARMED == 1 ]] && echo ARMED || echo 'OFF (Dry-Run)')"
exec npm run batch:send
