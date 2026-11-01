#!/usr/bin/env bash
# TeamZORA – Panel über nginx + Cloudflare Tunnel veröffentlichen (ohne offene Ports, IP bleibt verborgen)
#
#   ./deploy/tunnel.sh                     Domain bots.hostl.eu
#   ./deploy/tunnel.sh panel.example.de    andere Domain
#
# Umgebungsvariablen: NGINX_PORT (Standard 8090), CF_CONFIG (Pfad zur cloudflared config.yml)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

DOMAIN="${1:-${PANEL_DOMAIN:-bots.hostl.eu}}"
NGINX_PORT="${NGINX_PORT:-8090}"
ENV_FILE=".dashboard.env"
SITE_NAME="teamzora-panel"

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
step() { echo; echo "${bold}==> $*${reset}"; }
ok()   { echo "${green}✔${reset} $*"; }
warn() { echo "${yellow}!${reset} $*"; }
fail() { echo "${red}✘ $*${reset}" >&2; exit 1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || fail "Bitte als root ausführen oder sudo installieren."
    SUDO="sudo"
fi

[ -f "$ENV_FILE" ] || fail "$ENV_FILE fehlt – bitte zuerst ./setup.sh ausführen."
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
env_set() {
    if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
PANEL_PORT="$(env_get DASHBOARD_PORT)"
PANEL_PORT="${PANEL_PORT:-3000}"

# ---------------------------------------------------------------- Panel nur lokal
step "Panel nur lokal erreichbar machen"
env_set DASHBOARD_HOST 127.0.0.1
env_set PANEL_URL "https://$DOMAIN"
env_set TRUST_PROXY 1
ok "Panel lauscht auf 127.0.0.1:$PANEL_PORT, öffentliche Adresse https://$DOMAIN"

# ---------------------------------------------------------------- nginx
step "nginx einrichten"
if ! command -v nginx >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || fail "nginx fehlt und kann nicht automatisch installiert werden."
    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq nginx
fi
if [ -d /etc/nginx/sites-available ]; then
    TARGET="/etc/nginx/sites-available/$SITE_NAME"
    LINK="/etc/nginx/sites-enabled/$SITE_NAME"
else
    TARGET="/etc/nginx/conf.d/$SITE_NAME.conf"
    LINK=""
fi
sed -e "s|{{DOMAIN}}|$DOMAIN|g" -e "s|{{NGINX_PORT}}|$NGINX_PORT|g" -e "s|{{PANEL_PORT}}|$PANEL_PORT|g" \
    deploy/nginx-panel.conf.template | $SUDO tee "$TARGET" >/dev/null
[ -n "$LINK" ] && $SUDO ln -sf "$TARGET" "$LINK"
$SUDO nginx -t >/dev/null 2>&1 || { $SUDO nginx -t; fail "nginx-Konfiguration fehlerhaft."; }
$SUDO systemctl enable --now nginx >/dev/null 2>&1 || true
$SUDO systemctl reload nginx 2>/dev/null || $SUDO nginx -s reload 2>/dev/null || $SUDO nginx
ok "nginx: $TARGET → 127.0.0.1:$NGINX_PORT"

# ---------------------------------------------------------------- Cloudflare Tunnel
step "Cloudflare Tunnel verbinden"
SERVICE="http://127.0.0.1:$NGINX_PORT"
CF_CONFIG="${CF_CONFIG:-}"
if [ -z "$CF_CONFIG" ]; then
    for f in /etc/cloudflared/config.yml /etc/cloudflared/config.yaml "$HOME/.cloudflared/config.yml" "$HOME/.cloudflared/config.yaml"; do
        if [ -f "$f" ]; then CF_CONFIG="$f"; break; fi
    done
fi
MANUAL=1
if ! command -v cloudflared >/dev/null 2>&1; then
    warn "cloudflared ist auf diesem Server nicht installiert."
elif [ -n "$CF_CONFIG" ] && grep -qE '^\s*ingress:' "$CF_CONFIG"; then
    # Lokal verwalteter Tunnel: Regel in die config.yml eintragen
    if grep -qE "hostname:\s*$DOMAIN\s*$" "$CF_CONFIG"; then
        ok "$DOMAIN ist in $CF_CONFIG bereits eingetragen"
    else
        $SUDO cp "$CF_CONFIG" "$CF_CONFIG.bak.$(date +%s)"
        TMP="$(mktemp)"
        awk -v host="$DOMAIN" -v svc="$SERVICE" '
            !done && /^[[:space:]]*-[[:space:]]*service:[[:space:]]*http_status:404/ {
                match($0, /^[[:space:]]*/); ind = substr($0, 1, RLENGTH);
                print ind "- hostname: " host; print ind "  service: " svc; done = 1
            }
            { print }
            END { if (!done) { print "  - hostname: " host; print "    service: " svc; print "  - service: http_status:404" } }
        ' "$CF_CONFIG" > "$TMP"
        $SUDO cp "$TMP" "$CF_CONFIG" && rm -f "$TMP"
        ok "Regel in $CF_CONFIG eingetragen (Backup daneben)"
    fi
    TUNNEL="$(grep -E '^\s*tunnel:' "$CF_CONFIG" | head -1 | awk '{print $2}')"
    if [ -n "$TUNNEL" ]; then
        if cloudflared tunnel route dns "$TUNNEL" "$DOMAIN" >/dev/null 2>&1; then
            ok "DNS-Eintrag $DOMAIN → Tunnel gesetzt"
        else
            warn "DNS-Eintrag konnte nicht automatisch gesetzt werden (evtl. existiert er schon oder cloudflared ist nicht eingeloggt)."
            echo "   Manuell: ${bold}cloudflared tunnel route dns $TUNNEL $DOMAIN${reset}"
        fi
    fi
    $SUDO systemctl restart cloudflared 2>/dev/null && ok "cloudflared neu gestartet" || warn "Bitte cloudflared neu starten."
    MANUAL=0
fi

if [ "$MANUAL" -eq 1 ]; then
    echo
    echo "Dein Tunnel wird über das Cloudflare-Dashboard verwaltet (oder ist noch nicht eingerichtet)."
    echo "Lege dort einen Public Hostname an:"
    echo
    echo "   Cloudflare Zero Trust → Networks → Tunnels → dein Tunnel → ${bold}Public Hostname → Add${reset}"
    echo "     Subdomain: ${bold}${DOMAIN%%.*}${reset}   Domain: ${bold}${DOMAIN#*.}${reset}"
    echo "     Service:   ${bold}HTTP${reset}  URL: ${bold}127.0.0.1:$NGINX_PORT${reset}"
    echo
    if ! command -v cloudflared >/dev/null 2>&1; then
        echo "Noch kein Tunnel? Im selben Menü „Create a tunnel“ → Cloudflared wählen und den angezeigten"
        echo "Installationsbefehl (mit Token) auf diesem Server ausführen."
    fi
fi

# ---------------------------------------------------------------- Panel neu starten
step "Panel neu starten"
if command -v pm2 >/dev/null 2>&1; then
    pm2 startOrReload ecosystem.config.js --update-env >/dev/null && pm2 save >/dev/null && ok "Panel läuft mit neuer Konfiguration"
fi

echo
echo "${bold}${green}Fertig!${reset}  Panel: ${bold}https://$DOMAIN${reset}"
echo
echo "  ${bold}Wichtig:${reset}"
echo "  • Discord Developer Portal → OAuth2 → Redirects: ${bold}https://$DOMAIN/auth/callback${reset}"
echo "  • Alte offene Ports schließen, z. B. ${dim}sudo ufw deny $PANEL_PORT${reset} (das Panel lauscht jetzt nur lokal)."
echo "  • In Cloudflare SSL/TLS auf „Full“ stellen und den DNS-Eintrag nur als CNAME auf den Tunnel nutzen (keine A-Records mit der Server-IP)."
