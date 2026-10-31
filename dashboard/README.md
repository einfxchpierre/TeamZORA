# Bot-Dashboard

Ein schlankes Web-Dashboard, mit dem du mehrere Instanzen von CustomDCBot betreibst: einen Bot pro Discord-Server, alle auf einer Maschine.
Es braucht keine zusätzlichen Abhängigkeiten, nur Node.js.

## Schnellstart auf dem Server (PM2)

```bash
git clone https://github.com/einfxchpierre/TeamZORA.git
cd TeamZORA
./setup.sh
```

`setup.sh` erledigt Folgendes:

1. Node.js prüfen; falls es fehlt, unter Debian/Ubuntu automatisch installieren.
2. Abhängigkeiten und PM2 installieren.
3. Port und Passwort abfragen und in `.dashboard.env` speichern. Die Datei wird nicht committet.
4. Das Dashboard über `ecosystem.config.js` mit PM2 starten und den Autostart beim Booten einrichten.

Updaten: `git pull && ./setup.sh`. Einstellungen ändern: `./setup.sh --reconfigure`.
Das Dashboard läuft als PM2-Prozess `teamzora-dashboard`. Die Bots sind Unterprozesse davon und werden mit ihm gestoppt.

## Start ohne PM2

```bash
npm ci
npm run dashboard
```

Danach `http://127.0.0.1:3000` öffnen. Beim ersten Start wird ein Passwort generiert und in der Konsole ausgegeben
(gespeichert in `bots/.dashboard-password`).

| Umgebungsvariable    | Standard    | Bedeutung                                          |
|----------------------|-------------|----------------------------------------------------|
| `DASHBOARD_PASSWORD` | generiert   | Login-Passwort                                     |
| `DASHBOARD_PORT`     | `3000`      | Port                                               |
| `DASHBOARD_HOST`     | `127.0.0.1` | Bind-Adresse (`0.0.0.0` für Zugriff von außen)     |
| `DASHBOARD_DATA`     | `./bots`    | Speicherort für Bot-Konfigurationen und Datenbanken |

> Wenn du das Dashboard öffentlich erreichbar machst, setze ein starkes Passwort und betreibe es hinter einem
> Reverse-Proxy mit HTTPS.

## Funktionen

- **Übersicht:** Status, Uptime und RAM aller Bots sowie Systeminfos. Alle Bots lassen sich gemeinsam starten oder stoppen.
- **Pro Bot:** Starten, Stoppen und Neustarten, eine Live-Konsole mit CLI-Befehlen (`reload`, `modules`, `help`),
  Module per Schalter aktivieren (bei laufendem Bot automatisch mit `reload`) und `config.json` bearbeiten.
- **Isolation:** Jeder Bot hat unter `bots/<id>/` ein eigenes Verzeichnis `config/` und `data/` und läuft als
  eigener Prozess (`node main.js <configDir> <dataDir>`).
- **Supervisor:** Nach einem Absturz startet ein Bot automatisch neu, mit Backoff bis 60 s. Fatale Exit-Codes
  (64 ungültiger Token, 65 Intents, 66 vom Server entfernt, 78 Konfigurationsfehler) lösen keinen Neustart aus.
- **Autostart:** Die gewählten Bots starten zusammen mit dem Dashboard.

Die Modul-Konfigurationen (`config/<modul>/*.json`) erzeugt der Bot beim ersten Start mit aktiviertem Modul.
Bearbeiten kannst du sie unter `bots/<id>/config/`.

Lizenzhinweis: Es gilt die [LICENSE](../LICENSE) (BUSL-1.1). Bots für eigene Communities zu betreiben ist erlaubt.
Bots als Hosting-Dienst für Dritte anzubieten ist nicht erlaubt.
