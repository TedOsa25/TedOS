#!/usr/bin/env bash
# Nachfass-Versand mit Geheimnissen aus dem Keychain — analog send-batch.sh.
#   ./followup.sh          # Vorschau
#   ./followup.sh --apply  # versenden
set -euo pipefail
cd "$(dirname "$0")"
kc() { security find-generic-password -s "$1" -w 2>/dev/null | base64 -d 2>/dev/null || true; }
SMTP_PASS="$(kc heycarbo-smtp)"
[[ -z "$SMTP_PASS" ]] && { echo "⛔ Kein SMTP-Passwort im Keychain." >&2; exit 1; }
export TEDOS_STORAGE_PATH=./.revenue-state
export REVENUE_EMAIL_PROVIDER=smtp SMTP_HOST=smtp.ionos.de SMTP_PORT=465 SMTP_SECURE=1
export SMTP_USER=ted@heycarbo.com SMTP_PASS
export SUPABASE_SERVICE_ROLE_KEY="$(kc supabase-service-key)"
export REVENUE_FOLLOWUP_SIZE="${REVENUE_FOLLOWUP_SIZE:-20}"
# Master-Switch nur bei --apply; ohne ihn ist jeder Dispatch ein Dry-Run.
[[ "${1:-}" == "--apply" ]] && export REVENUE_SEND_ENABLED=1 || export REVENUE_SEND_ENABLED=0
exec npm run followup:send -- "$@"
