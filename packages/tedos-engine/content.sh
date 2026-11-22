#!/bin/bash
# HeyAudit Content-System — CLI-Wrapper. Liest Zugänge aus dem macOS-Keychain
# NUR in die Prozessumgebung (nie ausgeben, nie in Dateien). Fehlende Einträge
# bleiben ungesetzt; die CLI meldet dann "blockiert" statt zu raten.
#   Keychain-Dienste: heyaudit-apify, heyaudit-notion, heyaudit-metricool
#   (Metricool zusätzlich METRICOOL_USER_ID / METRICOOL_BLOG_ID — keine Geheimnisse)
set -uo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export TZ="Europe/Berlin"
kc() {
  local v d
  v=$(security find-generic-password -s "$1" -w 2>/dev/null) || return 0
  d=$(printf '%s' "$v" | base64 -d 2>/dev/null) || d=""
  if [ -n "$d" ] && printf '%s' "$d" | LC_ALL=C grep -qv '[^[:print:]]' && [ "${#d}" -ge 8 ]; then printf '%s' "$d"; else printf '%s' "$v"; fi
}
[ -z "${APIFY_TOKEN:-}" ] && { APIFY_TOKEN="$(kc heyaudit-apify)"; [ -n "$APIFY_TOKEN" ] && export APIFY_TOKEN || unset APIFY_TOKEN; }
[ -z "${NOTION_TOKEN:-}" ] && { NOTION_TOKEN="$(kc heyaudit-notion)"; [ -n "$NOTION_TOKEN" ] && export NOTION_TOKEN || unset NOTION_TOKEN; }
[ -z "${METRICOOL_USER_TOKEN:-}" ] && { METRICOOL_USER_TOKEN="$(kc heyaudit-metricool)"; [ -n "$METRICOOL_USER_TOKEN" ] && export METRICOOL_USER_TOKEN || unset METRICOOL_USER_TOKEN; }
exec node --import tsx src/content/cli.ts "$@"
