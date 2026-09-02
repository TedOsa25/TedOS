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
# 40 statt 20 seit 02.09.2026 — der Rueckstau lief sonst aus dem Fenster.
#
# Gemessen an dem Tag: 1.517 faellige Nachfassmails, davon 710 zwischen 41 und
# 60 Werktagen. Ueber REVENUE_FOLLOWUP_MAX=60 fallen sie ersatzlos aus der
# Sequenz. Bei 20/Tag waeren in vier Wochen 400 davon erreicht worden, die
# restlichen ~310 waeren verfallen — an genau der Stufe, aus der beide
# Rueckmeldungen kamen (Bcomp einen Werktag nach der Nachfassmail, SK Schmidt
# drei). Mit 40/Tag sind es 800 in vier Wochen: keiner laeuft aus.
#
# Das Tagesvolumen steigt damit auf 60 (40 Nachfass + 20 Erstkontakt). Der
# Kanal hat am 07.07.2026 schon 565 Erstkontakte an einem Tag getragen, und
# eine Nachfassmail geht an eine Adresse, die bereits eine Mail OHNE Bounce
# erhalten hat — sie traegt damit weniger Zustellrisiko als ein Erstkontakt.
#
# Weiterhin ueberschreibbar: REVENUE_FOLLOWUP_SIZE=100 ./followup.sh --apply
export REVENUE_FOLLOWUP_SIZE="${REVENUE_FOLLOWUP_SIZE:-40}"
# Master-Switch nur bei --apply; ohne ihn ist jeder Dispatch ein Dry-Run.
[[ "${1:-}" == "--apply" ]] && export REVENUE_SEND_ENABLED=1 || export REVENUE_SEND_ENABLED=0
exec npm run followup:send -- "$@"
