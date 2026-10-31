/*
 * PM2 configuration for the bot dashboard.
 * Start: pm2 start ecosystem.config.js   (setup.sh does this for you)
 * Settings (port, password, ...) live in .dashboard.env, which setup.sh creates. It is not committed.
 */
const fs = require('fs');
const path = require('path');

/**
 * Reads KEY=VALUE lines from an env file. Missing file = no overrides.
 * @param {string} file
 * @returns {Object}
 */
function loadEnv(file) {
    const env = {};
    if (!fs.existsSync(file)) return env;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1);
    }
    return env;
}

module.exports = {
    apps: [
        {
            'name': 'teamzora-dashboard',
            'script': 'dashboard/server.js',
            'cwd': __dirname,
            'env': {
                NODE_ENV: 'production',
                ...loadEnv(path.join(__dirname, '.dashboard.env'))
            },
            'autorestart': true,
            'restart_delay': 3000,
            'max_restarts': 10,
            // Gives the dashboard time to stop all bots gracefully (each bot gets up to 15s)
            'kill_timeout': 20000,
            'time': true
        }
    ]
};
