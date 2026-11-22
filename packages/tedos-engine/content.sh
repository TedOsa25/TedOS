#!/bin/bash
# HeyAudit Content-System — CLI-Wrapper. Lädt Zugänge aus dem macOS-Schlüsselbund
# NUR in die Prozessumgebung (nie ausgeben, nie in Dateien). Welche Einträge
# gelesen werden, steht NICHT im Repo: die Dienstnamen kommen aus
# CONTENT_KC_APIFY / CONTENT_KC_NOTION / CONTENT_KC_METRICOOL (lokale Betriebsnotiz).
# Fehlt ein Name oder Eintrag, bleibt die Variable ungesetzt; die CLI meldet "blockiert".
set -uo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export TZ="Europe/Berlin"
kc() {
  [ -n "$1" ] || return 0
  local v d
  v=$(security find-generic-password -s "$1" -w 2>/dev/null) || return 0
  d=$(printf '%s' "$v" | base64 -d 2>/dev/null) || d=""
  if [ -n "$d" ] && printf '%s' "$d" | LC_ALL=C grep -qv '[^[:print:]]' && [ "${#d}" -ge 8 ]; then printf '%s' "$d"; else printf '%s' "$v"; fi
}
lade() { # lade <VARIABLE> <Dienstname>
  [ -n "${!1:-}" ] && return 0
  local w; w="$(kc "${2:-}")"
  if [ -n "$w" ]; then export "$1=$w"; fi
}
lade APIFY_TOKEN "${CONTENT_KC_APIFY:-}"
lade NOTION_TOKEN "${CONTENT_KC_NOTION:-}"
lade METRICOOL_USER_TOKEN "${CONTENT_KC_METRICOOL:-}"
exec node --import tsx src/content/cli.ts "$@"
