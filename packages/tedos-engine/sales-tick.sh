#!/bin/bash
# HeyAudit Sales — scheduler tick (launchd: com.heyaudit.sales, every 5 min).
# Reads secrets from the macOS keychain into the process environment only.
# Never echoes them. Read-only mailbox, no sending, HeyAudit only.
set -uo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export TZ="Europe/Berlin"
export REVENUE_BRAND="heyaudit"
SALES_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"; export SALES_COMMIT
export SALES_STATE_DIR="${SALES_STATE_DIR:-$HOME/dev/tedos-runtime/heyaudit-sales}"
# Outbound runtime: already-contacted leads + cross-brand suppression (read-only).
OUT="$HOME/Desktop/TedOS/ai-os/packages/tedos-engine/runtime"
export SALES_SPERRLISTEN="${SALES_SPERRLISTEN:-$OUT/suppression/cross-brand.json:$OUT/heyaudit/revenue-lead-status.json}"

# Keychain values are stored base64 (house rule); fall back to raw if not.
kc() {
  local v d
  v=$(security find-generic-password -s "$1" -w 2>/dev/null) || return 0
  d=$(printf '%s' "$v" | base64 -d 2>/dev/null) || d=""
  if [ -n "$d" ] && printf '%s' "$d" | LC_ALL=C grep -qv '[^[:print:]]' && [ "${#d}" -ge 8 ]; then printf '%s' "$d"; else printf '%s' "$v"; fi
}

export SALES_IMAP_USER="ted@heyaudit.de"
SALES_IMAP_PASS="$(kc heyaudit-google-smtp | tr -d ' ')"; export SALES_IMAP_PASS
SALES_PLACES_KEY="$(kc heyaudit-google-places)"; export SALES_PLACES_KEY
SALES_META_TOKEN="$(kc heyaudit-meta-ads-read)"; export SALES_META_TOKEN
[ -z "$SALES_IMAP_PASS" ] && unset SALES_IMAP_PASS
[ -z "$SALES_PLACES_KEY" ] && unset SALES_PLACES_KEY
[ -z "$SALES_META_TOKEN" ] && unset SALES_META_TOKEN

exec node --import tsx src/sales/cli.ts "${@:-tick}"
