#!/usr/bin/env bash
# TeamZORA – Diagnose: Panel → nginx → Cloudflare Tunnel → Domain
#   ./deploy/doctor.sh [domain]
cd "$(dirname "$(readlink -f "$0")")/.."
DOMAIN="${1:-bots.hostl.eu}"
NGINX_PORT="${NGINX_PORT:-8090}"
PANEL_PORT="$(grep -E '^DASHBOARD_PORT=' .dashboard.env 2>/dev/null | tail -1 | cut -d= -f2-)"; PANEL_PORT="${PANEL_PORT:-3000}"
g=$'\e[32m'; r=$'\e[31m'; y=$'\e[33m'; b=$'\e[1m'; n=$'\e[0m'
pass() { echo "${g}✔${n} $*"; }
bad()  { echo "${r}✘${n} $*"; }
hint() { echo "   ${y}→${n} $*"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$@" 2>/dev/null; }

echo "${b}1. Panel (127.0.0.1:$PANEL_PORT)${n}"
c="$(code "http://127.0.0.1:$PANEL_PORT/api/session")"
if [ "$c" = "200" ]; then pass "Panel antwortet"; else bad "Panel antwortet nicht (HTTP $c)"; hint "pm2 logs teamzora-dashboard --lines 30   bzw.   pm2 restart teamzora-dashboard --update-env"; fi

echo "${b}2. nginx${n}"
if nginx -t >/dev/null 2>&1; then pass "Konfiguration gültig"; else bad "nginx -t meldet Fehler:"; nginx -t; fi
if [ -L /etc/nginx/sites-enabled/teamzora-panel ] || [ -f /etc/nginx/conf.d/teamzora-panel.conf ]; then pass "Seite teamzora-panel ist aktiv"; else bad "Seite teamzora-panel ist nicht aktiviert"; hint "ln -s /etc/nginx/sites-available/teamzora-panel /etc/nginx/sites-enabled/ && systemctl reload nginx"; fi
TARGETS=("127.0.0.1:$NGINX_PORT" "127.0.0.1:80"); [ -f /proc/net/if_inet6 ] && TARGETS+=("[::1]:$NGINX_PORT")
for target in "${TARGETS[@]}"; do
    c="$(code -H "Host: $DOMAIN" "http://$target/api/session")"
    if [ "$c" = "200" ]; then pass "http://$target → Panel"; else bad "http://$target → HTTP $c"; fi
done

echo "${b}3. Cloudflare Tunnel${n}"
if ! command -v cloudflared >/dev/null 2>&1; then
    bad "cloudflared ist nicht installiert"
else
    if systemctl is-active --quiet cloudflared 2>/dev/null; then pass "cloudflared läuft"; else bad "cloudflared läuft nicht"; hint "systemctl status cloudflared"; fi
    CFG=""; for f in /etc/cloudflared/config.yml /etc/cloudflared/config.yaml /root/.cloudflared/config.yml; do [ -f "$f" ] && CFG="$f" && break; done
    if systemctl cat cloudflared 2>/dev/null | grep -q -- '--token'; then
        echo "   Tunnel wird im Cloudflare-Dashboard verwaltet (Token)."
        hint "Zero Trust → Networks → Tunnels → Tunnel → Public Hostname: ${b}$DOMAIN${n} → Service ${b}HTTP 127.0.0.1:$NGINX_PORT${n}"
    elif [ -n "$CFG" ]; then
        if grep -qE "hostname:\s*$DOMAIN" "$CFG"; then pass "$DOMAIN steht in $CFG"; else bad "$DOMAIN fehlt in $CFG"; hint "./deploy/tunnel.sh $DOMAIN"; fi
        grep -A1 -E "hostname:\s*$DOMAIN" "$CFG" | sed 's/^/   /'
    fi
fi

echo "${b}4. Von außen: https://$DOMAIN${n}"
rm -f /tmp/teamzora-doctor.html; touch /tmp/teamzora-doctor.html
H="$(curl -s -D - -o /tmp/teamzora-doctor.html --max-time 15 "https://$DOMAIN/api/session" 2>/dev/null)"
c="$(echo "$H" | head -1 | awk '{print $2}')"
if [ "$c" = "200" ]; then
    pass "Panel ist über $DOMAIN erreichbar"
elif [ -z "$c" ]; then
    bad "Keine Antwort von $DOMAIN (DNS?)"; hint "In Cloudflare DNS muss $DOMAIN ein CNAME auf <tunnel-id>.cfargotunnel.com sein."
else
    bad "$DOMAIN antwortet mit HTTP $c"
    if grep -qi "nginx" /tmp/teamzora-doctor.html; then
        hint "Die 404 kommt von nginx: der Tunnel zeigt auf die falsche Adresse. Service auf ${b}HTTP 127.0.0.1:$NGINX_PORT${n} stellen."
    elif [ "$c" = "404" ]; then
        hint "Die 404 kommt von cloudflared selbst: im Tunnel fehlt der Public Hostname ${b}$DOMAIN${n} (siehe Punkt 3)."
    elif [ "$c" = "502" ]; then
        hint "Der Tunnel erreicht nginx nicht. Service-URL muss ${b}http://127.0.0.1:$NGINX_PORT${n} sein."
    fi
fi
