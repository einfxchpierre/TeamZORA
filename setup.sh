#!/usr/bin/env bash
# TeamZORA – Einrichtung des Bot-Dashboards mit PM2
#
#   ./setup.sh            interaktive Einrichtung (installiert, konfiguriert, startet)
#   ./setup.sh -y         ohne Rückfragen (Standardwerte bzw. DASHBOARD_* Umgebungsvariablen)
#   ./setup.sh --reconfigure   Port/Passwort neu festlegen
#   ./setup.sh --discord       Discord-Login einrichten
#   ./setup.sh --domain bots.hostl.eu   über nginx + Cloudflare Tunnel veröffentlichen
#
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

ENV_FILE=".dashboard.env"
APP_NAME="teamzora-dashboard"
ASSUME_YES=0
RECONFIGURE=0
DISCORD_SETUP=0
DOMAIN_SETUP=""
while [ $# -gt 0 ]; do
    arg="$1"; shift
    case "$arg" in
        --domain)
            if [ $# -gt 0 ] && [[ "$1" != -* ]]; then DOMAIN_SETUP="$1"; shift; else DOMAIN_SETUP="bots.hostl.eu"; fi ;;
        -y|--yes) ASSUME_YES=1 ;;
        --reconfigure) RECONFIGURE=1 ;;
        --discord) DISCORD_SETUP=1 ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) echo "Unbekannte Option: $arg"; exit 1 ;;
    esac
done

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; red=$'\e[31m'; reset=$'\e[0m'
step() { echo; echo "${bold}==> $*${reset}"; }
ok()   { echo "${green}✔${reset} $*"; }
fail() { echo "${red}✘ $*${reset}" >&2; exit 1; }

# sudo nur benutzen, wenn wir nicht root sind und sudo existiert
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

ask() { # ask "Frage" "Standard" -> Antwort
    local prompt="$1" def="$2" answer
    if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then echo "$def"; return; fi
    read -r -p "$prompt ${dim}[$def]${reset}: " answer
    echo "${answer:-$def}"
}

# ---------------------------------------------------------------- Node.js
step "Prüfe Node.js"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
    [ "$NODE_MAJOR" -ge 18 ] && NODE_OK=1
fi
if [ "$NODE_OK" -eq 0 ]; then
    if command -v apt-get >/dev/null 2>&1; then
        echo "Node.js 18+ fehlt – installiere Node.js 22 LTS über NodeSource…"
        curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
        $SUDO apt-get install -y nodejs build-essential python3
    else
        fail "Node.js 18 oder neuer wird benötigt: https://nodejs.org"
    fi
fi
ok "Node.js $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------- Abhängigkeiten
step "Installiere Abhängigkeiten"
npm ci --omit=dev --no-audit --no-fund
ok "Abhängigkeiten installiert"

# ---------------------------------------------------------------- PM2
step "Prüfe PM2"
if ! command -v pm2 >/dev/null 2>&1; then
    echo "PM2 fehlt – installiere global…"
    npm install -g pm2 2>/dev/null || $SUDO npm install -g pm2
fi
ok "PM2 $(pm2 -v)"

# ---------------------------------------------------------------- Konfiguration
step "Dashboard-Konfiguration"
if [ -f "$ENV_FILE" ] && [ "$RECONFIGURE" -eq 0 ]; then
    ok "$ENV_FILE existiert bereits – wird beibehalten (neu einrichten: ./setup.sh --reconfigure)"
else
    PORT="$(ask "Port" "${DASHBOARD_PORT:-3000}")"
    EXTERNAL="$(ask "Von außen erreichbar machen? (j/n)" "n")"
    if [[ "$EXTERNAL" =~ ^[jJyY] ]]; then HOST="0.0.0.0"; else HOST="127.0.0.1"; fi
    HOST="${DASHBOARD_HOST:-$HOST}"
    GENERATED="$(node -e 'process.stdout.write(require("crypto").randomBytes(15).toString("base64url"))')"
    PASSWORD="${DASHBOARD_PASSWORD:-}"
    if [ -z "$PASSWORD" ] && [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
        read -r -s -p "Dashboard-Passwort ${dim}[leer = zufällig generieren]${reset}: " PASSWORD; echo
    fi
    PASSWORD="${PASSWORD:-$GENERATED}"
    umask 077
    {
        echo "# Erstellt von setup.sh – nicht committen"
        echo "DASHBOARD_PORT=$PORT"
        echo "DASHBOARD_HOST=$HOST"
        echo "DASHBOARD_PASSWORD=$PASSWORD"
        echo "DASHBOARD_DATA=$(pwd)/bots"
    } > "$ENV_FILE"
    umask 022
    ok "Gespeichert in $ENV_FILE"
    SHOW_PASSWORD="$PASSWORD"
fi

# ---------------------------------------------------------------- Domain / Cloudflare Tunnel
if [ -z "$DOMAIN_SETUP" ] && ! grep -qE '^PANEL_URL=https://' "$ENV_FILE" && [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
    step "Veröffentlichen über Cloudflare Tunnel (empfohlen)"
    echo "Das Panel läuft dann nur lokal; nginx + Cloudflare Tunnel machen es unter deiner Domain"
    echo "erreichbar, ohne offene Ports und ohne dass die Server-IP sichtbar wird."
    if [[ "$(ask "Jetzt einrichten? (j/n)" "j")" =~ ^[jJyY] ]]; then
        DOMAIN_SETUP="$(ask "Domain" "bots.hostl.eu")"
    fi
fi
if [ -n "$DOMAIN_SETUP" ]; then
    ./deploy/tunnel.sh "$DOMAIN_SETUP"
fi

# ---------------------------------------------------------------- Discord-Login
env_has() { grep -qE "^$1=.+" "$ENV_FILE" 2>/dev/null; }
if [ "$DISCORD_SETUP" -eq 1 ] || { ! env_has DISCORD_CLIENT_ID && [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; }; then
    step "Discord-Login (optional)"
    echo "Damit sich freigeschaltete Accounts mit Discord anmelden können, brauchst du eine Application"
    echo "im Discord Developer Portal (https://discord.com/developers/applications)."
    if [[ "$(ask "Discord-Login jetzt einrichten? (j/n)" "n")" =~ ^[jJyY] ]]; then
        CUR_PORT="$(grep -E '^DASHBOARD_PORT=' "$ENV_FILE" | cut -d= -f2-)"
        DEFAULT_URL="$(grep -E '^PANEL_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
        DEFAULT_URL="${DEFAULT_URL:-http://$(hostname -I 2>/dev/null | awk '{print $1}'):${CUR_PORT:-3000}}"
        PANEL_URL_IN="$(ask "Öffentliche Adresse des Panels" "$DEFAULT_URL")"
        echo "Trage im Developer Portal unter OAuth2 → Redirects ein:  ${bold}${PANEL_URL_IN%/}/auth/callback${reset}"
        CLIENT_ID="$(ask "Client-ID" "")"
        read -r -s -p "Client-Secret: " CLIENT_SECRET; echo
        ADMINS="$(ask "Deine Discord-Nutzer-ID (Panel-Admin, mehrere mit Komma)" "")"
        sed -i '/^PANEL_URL=/d;/^DISCORD_CLIENT_ID=/d;/^DISCORD_CLIENT_SECRET=/d;/^PANEL_ADMINS=/d' "$ENV_FILE"
        {
            echo "PANEL_URL=${PANEL_URL_IN%/}"
            echo "DISCORD_CLIENT_ID=$CLIENT_ID"
            echo "DISCORD_CLIENT_SECRET=$CLIENT_SECRET"
            echo "PANEL_ADMINS=$ADMINS"
        } >> "$ENV_FILE"
        ok "Discord-Login gespeichert"
    else
        echo "Übersprungen – später mit ./setup.sh --discord nachholen."
    fi
fi

# ---------------------------------------------------------------- Start
step "Starte Dashboard mit PM2"
pm2 startOrReload ecosystem.config.js --update-env
pm2 save >/dev/null
ok "Läuft als PM2-Prozess \"$APP_NAME\""

# Autostart nach Server-Neustart
if [ "$(ask "PM2 beim Systemstart automatisch starten? (j/n)" "j")" != "n" ]; then
    STARTUP_CMD="$(pm2 startup 2>/dev/null | grep -E '^\s*sudo ' | tail -1 || true)"
    if [ -n "$STARTUP_CMD" ]; then
        eval "$STARTUP_CMD" && pm2 save >/dev/null && ok "Autostart eingerichtet" || echo "Bitte manuell ausführen: $STARTUP_CMD"
    else
        pm2 startup >/dev/null 2>&1 && pm2 save >/dev/null && ok "Autostart eingerichtet" || echo "Autostart: bitte 'pm2 startup' manuell ausführen."
    fi
fi

# ---------------------------------------------------------------- Fertig
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
DASHBOARD_PORT="$(env_get DASHBOARD_PORT)"
URL_HOST="$(env_get DASHBOARD_HOST)"
PUBLIC_URL="$(env_get PANEL_URL)"
[ "$URL_HOST" = "0.0.0.0" ] && URL_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "${bold}${green}Fertig!${reset}"
if [ -n "$PUBLIC_URL" ]; then
    echo "  Dashboard:  ${bold}${PUBLIC_URL}${reset}  ${dim}(lokal: http://127.0.0.1:${DASHBOARD_PORT})${reset}"
else
    echo "  Dashboard:  ${bold}http://${URL_HOST:-localhost}:${DASHBOARD_PORT}${reset}"
fi
if [ -n "${SHOW_PASSWORD:-}" ]; then
    echo "  Passwort:   ${bold}${SHOW_PASSWORD}${reset}  ${dim}(steht auch in $ENV_FILE)${reset}"
else
    echo "  Passwort:   ${dim}siehe $ENV_FILE${reset}"
fi
echo
echo "  Nützliche Befehle:"
echo "    pm2 logs $APP_NAME      # Logs ansehen"
echo "    pm2 restart $APP_NAME   # Neustart"
echo "    pm2 stop $APP_NAME      # Stoppen (stoppt auch alle Bots)"
echo "    git pull && ./setup.sh  # Update"
