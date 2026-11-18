#!/usr/bin/env bash
# Der komplette Tagesablauf in EINER Reihenfolge, die nicht vertauscht werden darf:
#
#   1. inbox:scan   misst Bounces/Abmeldungen/Antworten UND oeffnet das
#                   Nachfass-Gate (72 h). Ohne ihn bekaeme jemand, der geantwortet
#                   oder sich abgemeldet hat, ein "haben Sie meine Mail gesehen?".
#   2. Erstkontakt  ein Batch aus dem ICP-Pool (max. 20, Preflight entscheidet).
#   3. Nachfassen   ein Lauf (max. 20), erst NACH dem Scan.
#
# Jeder Schritt bricht den Ablauf ab, wenn er scheitert — ein Nachfasslauf auf
# veralteter Datenlage ist schlimmer als gar keiner.
#
#   ./taeglich.sh            # scharf, von Hand — laeuft immer
#   ./taeglich.sh --dry      # alles bauen, nichts senden
#   ./taeglich.sh --geplant  # aus launchd: laeuft nur im Nachhol-Fenster
#
# Voraussetzungen: Keychain entsperrt (heycarbo-smtp, supabase-service-key),
# Netzverbindung. Bei gesperrtem Keychain bricht Schritt 1 ab und es geht
# nichts raus — das ist gewollt.

set -uo pipefail
cd "$(dirname "$0")"

DRY=""
GEPLANT=""
for ARG in "$@"; do
  case "$ARG" in
    --dry)     DRY="--dry" ;;
    --geplant) GEPLANT="1" ;;
    *) echo "Unbekanntes Argument: $ARG" >&2
       echo "Nutzung: $0 [--dry] [--geplant]" >&2
       exit 2 ;;
  esac
done

DATUM="$(date +%Y-%m-%d)"
# Feststehender Name, taeglich von recherche.sh neu gebaut — nicht mehr
# "-icp-v3": eine durchnummerierte Datei zwingt dazu, hier mitzuziehen, und
# genau das wird vergessen. Der Vorgaenger v3 war am 20.08. auf 75 Leads
# abgeschmolzen, waehrend 919 Leads im CRM nur auf eine nachgetragene Adresse
# warteten.
POOL="/Users/tedosammor/Desktop/TedOS/Sales/leads-zulieferer/versandpool-aktuell.csv"
PROTOKOLL=".revenue-reports/taeglich-${DATUM}.log"
# Traegt das Datum des letzten SCHARFEN Laufs. Einzige Quelle fuer "heute ist
# schon versendet worden" — das Tagesprotokoll taugt dafuer nicht, ein
# Trockenlauf legt es genauso an.
STEMPEL=".revenue-state/letzter-versandtag"
mkdir -p .revenue-reports .revenue-state

kc() { security find-generic-password -s "$1" -w 2>/dev/null | base64 -d 2>/dev/null || true; }

sagen() { echo -e "\n\033[1m$*\033[0m" | tee -a "$PROTOKOLL"; }
fehler() { echo "⛔ $*" | tee -a "$PROTOKOLL" >&2; exit 1; }

# --- Nachhol-Fenster: 09:07 bis 11:00, werktags, hoechstens einmal -----------
#
# Der Regelfall ist der Kalender-Slot um 09:07. War der Rechner da aus, faellt
# er ersatzlos aus: eine frisch angemeldete launchd-Sitzung weiss nichts von
# einem verpassten Termin. Am 21.08.2026 bootete der Rechner 09:58 — es ging
# nichts raus und niemand hat es gemerkt.
#
# Deshalb startet launchd den Lauf jetzt ZUSAETZLICH beim Anmelden
# (RunAtLoad) und dieser Block entscheidet, ob das legitim ist. Er ist
# absichtlich hier und nicht in der Plist: launchd kann "Werktag" und
# "Uhrzeit" pruefen, aber nicht "heute ist schon versendet worden".
#
# Die Obergrenze 11:00 ist der eigentliche Zweck. Ohne sie liefe der Nachhol-
# Versand irgendwann — beim Aufwachen um 23 Uhr, beim Anmelden am Sonntag. Ein
# ausgefallener Tag ist billiger als eine Kaltakquise-Mail zur Unzeit.
#
# Gilt NUR fuer --geplant. Wer das Skript von Hand aufruft, hat sich etwas
# dabei gedacht und wird nicht ausgebremst.
if [[ -n "$GEPLANT" ]]; then
  # TAEGLICH_TEST_* nur fuer den Selbsttest weiter unten; im Betrieb ungesetzt.
  WOCHENTAG="${TAEGLICH_TEST_WOCHENTAG:-$(date +%u)}"   # 1=Mo … 7=So
  # 10# erzwingt Dezimal: "0907" waere sonst eine ungueltige Oktalzahl und der
  # Vergleich braeche mit "value too great for base" ab.
  JETZT=$((10#${TAEGLICH_TEST_ZEIT:-$(date +%H%M)}))
  LETZTER="$( [[ -f "$STEMPEL" ]] && cat "$STEMPEL" || echo "" )"

  GRUND=""
  if   [[ "$WOCHENTAG" -gt 5 ]];            then GRUND="Wochenende"
  elif [[ "$JETZT" -lt 907 ]];              then GRUND="zu frueh (Fenster ab 09:07)"
  elif [[ "$JETZT" -ge 1100 ]];             then GRUND="Fenster zu (Schluss 11:00)"
  elif [[ "$LETZTER" == "$DATUM" ]];        then GRUND="heute bereits versendet"
  fi

  if [[ -n "$GRUND" ]]; then
    printf '%s  uebersprungen — %s\n' "$(date '+%F %T')" "$GRUND" \
      | tee -a .revenue-reports/uebersprungen.log
    exit 0
  fi
fi

sagen "═══ Tagesablauf $DATUM $( [[ -n "$DRY" ]] && echo '(Trockenlauf)' ) ═══"

# --- 1) Posteingang ---------------------------------------------------------
sagen "1/3 · Posteingang auswerten"
SMTP_PASS="$(kc heycarbo-smtp)"
[[ -z "$SMTP_PASS" ]] && fehler "Kein SMTP/IMAP-Passwort im Keychain — ist er entsperrt?"

TEDOS_STORAGE_PATH=./.revenue-state \
IMAP_HOST=imap.ionos.de IMAP_PORT=993 IMAP_USER=ted@heycarbo.com IMAP_PASS="$SMTP_PASS" \
  npm run inbox:scan --silent -- --write-suppression 2>&1 | tee -a "$PROTOKOLL" | \
  grep -E "IMAP verbunden|insgesamt|Bounce-Rate|auf \"bounced\"|auf \"unsubscribed\"|Antwortende|BITTE PRÜFEN|✉|Scan-Zeitpunkt|⚠"
# PIPESTATUS[0] statt $? — sonst pruefen wir den Rueckgabewert von grep.
[[ "${PIPESTATUS[0]}" -ne 0 ]] && fehler "inbox:scan fehlgeschlagen — ohne frische Messung wird nichts versendet."

# --- 2) Erstkontakt ---------------------------------------------------------
sagen "2/3 · Erstkontakt-Batch"
# Ab hier gilt der Tag als verbraucht. Der Stempel steht bewusst VOR dem
# Versand: ein Absturz mitten im Batch darf keinen zweiten ausloesen. Der Preis
# ist, dass eine SMTP-Stoerung den Tag kostet, obwohl nichts rausging — dann
# ./taeglich.sh von Hand aufrufen, der Handlauf kennt kein Fenster und keinen
# Stempel. Schritt 1 ist an dieser Stelle schon durch; braeche der Keychain ab,
# waeren wir nie hier und der naechste Anmeldevorgang duerfte es nochmal
# versuchen.
[[ -z "$DRY" ]] && echo "$DATUM" > "$STEMPEL"
if [[ ! -f "$POOL" ]]; then
  echo "⚠ Kein Versandpool unter $POOL — Erstkontakt übersprungen." | tee -a "$PROTOKOLL"
else
  # Nur freigeben, wenn nicht schon genug freigegeben ist. Sonst wachsen die
  # Freigaben mit jedem Lauf um 20, waehrend nur 20 versendet werden — der
  # Ueberhang bliebe liegen und die Batchzusammensetzung waere nicht mehr
  # vorhersagbar. (Ein Trockenlauf hinterlaesst genau diesen Ueberhang.)
  # String(), nicht die nackte Zahl: console.log faerbt Zahlen ein
  # ("\e[33m20\e[39m"). Der Vergleich unten brach damit mit "operand expected"
  # ab — und weil danach auch $((20 - OFFEN)) scheiterte, lief `approve` nie.
  # Am 20.08. blieb das folgenlos (20 lagen schon frei); an jedem normalen Tag
  # waere der Erstkontakt still ausgefallen.
  OFFEN=$(TEDOS_STORAGE_PATH=./.revenue-state node -e '
    const j=JSON.parse(require("fs").readFileSync("./.revenue-state/revenue-lead-status.json","utf8"));
    console.log(String(Object.values(j).filter(r=>r.status==="approved").length));
  ' 2>/dev/null || echo 0)
  [[ "$OFFEN" =~ ^[0-9]+$ ]] || OFFEN=0
  if [[ "$OFFEN" -ge 20 ]]; then
    echo "   $OFFEN Leads bereits freigegeben — keine neue Freigabe nötig." | tee -a "$PROTOKOLL"
  else
    TEDOS_STORAGE_PATH=./.revenue-state REVENUE_APPROVE_N=$((20 - OFFEN)) REVENUE_APPROVE_IDS_FILE="$POOL" \
      npm run approve --silent -- --apply 2>&1 | tee -a "$PROTOKOLL" | tail -1
  fi
  ./send-batch.sh "rollout-${DATUM}" $DRY 2>&1 | tee -a "$PROTOKOLL" | \
    grep -E "Ergebnis|Versendete E-Mails|SMTP-Status|Fehler " || true
fi

# --- 3) Nachfassen ----------------------------------------------------------
sagen "3/3 · Nachfassen"
if [[ -n "$DRY" ]]; then
  ./followup.sh 2>&1 | tee -a "$PROTOKOLL" | grep -E "Fällig|in diesem Lauf|Vorschau"
else
  ./followup.sh --apply 2>&1 | tee -a "$PROTOKOLL" | grep -E "Versendet|Fehler|Nichts zu tun"
fi

sagen "Fertig. Protokoll: $PROTOKOLL"
