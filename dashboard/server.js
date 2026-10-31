/*
 * Dashboard to host several CustomDCBot instances (one per Discord server) from one machine.
 * Start: npm run dashboard  (env: DASHBOARD_PORT, DASHBOARD_HOST, DASHBOARD_PASSWORD, DASHBOARD_DATA)
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {BotManager, configSchema, listAvailableModules} = require('./botManager');

const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const STORAGE = path.resolve(process.env.DASHBOARD_DATA || path.join(__dirname, '..', 'bots'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const EMOJI_DIR = path.resolve(__dirname, '..', 'emojis');
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png'
};

function readJSONFile(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

const EMOJI_META = {
    manifest: readJSONFile(path.join(EMOJI_DIR, 'manifest.json'), {emojis: [], colors: {}, glyphs: {}}),
    mapping: readJSONFile(path.join(EMOJI_DIR, 'mapping.json'), {})
};

const manager = new BotManager(STORAGE);
const sessions = new Map();
const loginAttempts = new Map();
const streams = new Set();

/**
 * Loads the dashboard password: DASHBOARD_PASSWORD, or a generated one stored next to the bots.
 * @returns {string}
 */
function loadPassword() {
    if (process.env.DASHBOARD_PASSWORD) return process.env.DASHBOARD_PASSWORD;
    const file = path.join(STORAGE, '.dashboard-password');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const generated = crypto.randomBytes(12).toString('base64url');
    fs.writeFileSync(file, generated, {mode: 0o600});
    console.log(`[dashboard] Neues Passwort generiert: ${generated}  (gespeichert in ${file})`);
    return generated;
}

const PASSWORD_HASH = crypto.createHash('sha256').update(loadPassword()).digest();

/**
 * Constant-time password check.
 * @param {string} input
 * @returns {boolean}
 */
function checkPassword(input) {
    const hash = crypto.createHash('sha256').update(String(input || '')).digest();
    return crypto.timingSafeEqual(hash, PASSWORD_HASH);
}

function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
}

function isAuthenticated(req) {
    const token = parseCookies(req).dash_session;
    if (!token || !sessions.has(token)) return false;
    if (sessions.get(token) < Date.now()) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function send(res, status, body, headers) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers
    });
    res.end(data);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size = size + chunk.length;
            if (size > 1024 * 1024) {
                reject(Object.assign(new Error('Anfrage zu groß'), {status: 413}));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!chunks.length) return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(Object.assign(new Error('Ungültiges JSON'), {status: 400}));
            }
        });
        req.on('error', reject);
    });
}

function serveEmoji(res, name) {
    fs.readFile(path.join(EMOJI_DIR, 'png', `${name}.png`), (err, data) => {
        if (err) return send(res, 404, {error: 'Nicht gefunden'});
        res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400'});
        res.end(data);
    });
}

function serveStatic(req, res) {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const emoji = urlPath.match(/^\/emojis\/(?<name>z_[a-z0-9_]+)\.png$/);
    if (emoji) return serveEmoji(res, emoji.groups.name);
    const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, {error: 'Verboten'});
    fs.readFile(file, (err, data) => {
        if (err) {
            // SPA fallback
            return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
                if (e2) return send(res, 404, {error: 'Nicht gefunden'});
                res.writeHead(200, {'Content-Type': MIME['.html']});
                res.end(html);
            });
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        res.end(data);
    });
}

function systemInfo() {
    return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        node: process.version,
        cpus: os.cpus().length,
        load: os.loadavg(),
        totalMem: os.totalmem(),
        freeMem: os.freemem(),
        uptime: os.uptime(),
        dashboardUptime: process.uptime()
    };
}

/**
 * Server-Sent Events: pushes bot updates and (optionally) the log of one bot.
 * @param {Request} req
 * @param {Response} res
 * @param {string|null} botID
 */
function openStream(req, res, botID) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    const client = {res, botID};
    streams.add(client);
    res.write(`event: bots\ndata: ${JSON.stringify(manager.list())}\n\n`);
    if (botID) res.write(`event: logs\ndata: ${JSON.stringify(manager.logs(botID))}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
        clearInterval(ping);
        streams.delete(client);
    });
}

function broadcast(event, data, botID) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of streams) {
        if (!botID || client.botID === botID) client.res.write(payload);
    }
}

manager.on('update', (summary) => broadcast('bot', summary));
manager.on('removed', (id) => broadcast('removed', {id}));
manager.on('log', (id, entry) => broadcast('log', entry, id));

/**
 * Login with a simple per-IP rate limit (10 attempts / 10 min).
 * @param {Request} req
 * @param {Response} res
 */
async function handleLogin(req, res) {
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    const attempts = (loginAttempts.get(ip) || []).filter(t => now - t < 600000);
    if (attempts.length >= 10) return send(res, 429, {error: 'Zu viele Versuche. Bitte später erneut probieren.'});
    const body = await readBody(req);
    if (!checkPassword(body.password)) {
        attempts.push(now);
        loginAttempts.set(ip, attempts);
        return send(res, 401, {error: 'Falsches Passwort'});
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now + SESSION_TTL);
    send(res, 200, {ok: true}, {
        'Set-Cookie': `dash_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`
    });
}

/**
 * Routes /api/bots/:id/* requests.
 * @returns {Promise<boolean>} true when handled
 */
async function handleBotRoute(req, res, id, action) {
    const method = req.method;
    if (!action && method === 'GET') return send(res, 200, manager.details(id));
    if (!action && method === 'DELETE') {
        await manager.remove(id);
        return send(res, 200, {ok: true});
    }
    if (action === 'emojis' && method === 'GET') return send(res, 200, manager.emojiStatus(id) || {});
    if (action === 'guild' && method === 'GET') return send(res, 200, manager.guildCache(id) || {});
    if (action === 'stream' && method === 'GET') {
        manager.get(id);
        return openStream(req, res, id);
    }
    if (method !== 'POST' && method !== 'PUT') return send(res, 405, {error: 'Methode nicht erlaubt'});
    const body = await readBody(req);
    switch (action) {
        case 'start':
            manager.start(id);
            break;
        case 'stop':
            await manager.stop(id);
            break;
        case 'restart':
            await manager.restart(id);
            break;
        case 'command':
            manager.sendCommand(id, body.command);
            break;
        case 'settings':
            manager.updateSettings(id, body);
            break;
        case 'config':
            manager.updateConfig(id, body);
            break;
        case 'modules':
            manager.updateModules(id, body);
            break;
        default:
            return send(res, 404, {error: 'Nicht gefunden'});
    }
    send(res, 200, manager.details(id));
}

async function handleApi(req, res, pathname) {
    if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
    if (pathname === '/api/session') return send(res, 200, {authenticated: isAuthenticated(req)});
    if (!isAuthenticated(req)) return send(res, 401, {error: 'Nicht angemeldet'});

    // CSRF guard: state-changing requests must come from our own frontend (custom header + JSON).
    if (req.method !== 'GET' && req.headers['x-dashboard'] !== '1') return send(res, 403, {error: 'Ungültige Anfrage'});

    if (pathname === '/api/logout' && req.method === 'POST') {
        sessions.delete(parseCookies(req).dash_session);
        return send(res, 200, {ok: true}, {'Set-Cookie': 'dash_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    }
    if (pathname === '/api/overview') return send(res, 200, {bots: manager.list(), system: systemInfo()});
    if (pathname === '/api/meta') return send(res, 200, {modules: listAvailableModules(), schema: configSchema()});
    if (pathname === '/api/emojis') return send(res, 200, EMOJI_META);
    const content = pathname.match(/^\/api\/bots\/(?<id>[a-f0-9]{12})\/content\/(?<module>[a-z0-9_-]+)(?:\/(?<file>[a-z0-9_.-]+\.json))?$/i);
    if (content) {
        const {id, module: moduleName, file} = content.groups;
        if (req.method === 'GET' && !file) return send(res, 200, {files: manager.moduleContent(id, moduleName)});
        if (req.method === 'PUT' && file) {
            const body = await readBody(req);
            manager.saveModuleContent(id, moduleName, file, body.value);
            return send(res, 200, {files: manager.moduleContent(id, moduleName)});
        }
        return send(res, 405, {error: 'Methode nicht erlaubt'});
    }
    if (pathname === '/api/stream') return openStream(req, res, null);
    if (pathname === '/api/bots' && req.method === 'POST') {
        const created = manager.create(await readBody(req));
        if (created.hasToken) manager.start(created.id);
        return send(res, 201, manager.details(created.id));
    }
    if (pathname === '/api/bots/start-all' && req.method === 'POST') {
        for (const b of manager.list()) {
            if (b.hasToken) manager.start(b.id);
        }
        return send(res, 200, {ok: true});
    }
    if (pathname === '/api/bots/stop-all' && req.method === 'POST') {
        await manager.stopAll();
        return send(res, 200, {ok: true});
    }
    const match = pathname.match(/^\/api\/bots\/(?<id>[a-f0-9]{12})(?:\/(?<action>[a-z-]+))?$/);
    if (match) return handleBotRoute(req, res, match.groups.id, match.groups.action);
    send(res, 404, {error: 'Nicht gefunden'});
}

const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const pathname = new URL(req.url, 'http://x').pathname;
    if (!pathname.startsWith('/api/')) return serveStatic(req, res);
    handleApi(req, res, pathname).catch((err) => {
        if (res.headersSent) return res.end();
        send(res, err.status || 500, {error: err.message || 'Interner Fehler'});
    });
});

server.listen(PORT, HOST, () => {
    console.log(`[dashboard] Läuft auf http://${HOST}:${PORT}  –  Bots werden in ${STORAGE} gespeichert`);
    manager.startAutoStartBots();
});

async function shutdown() {
    console.log('[dashboard] Fahre herunter, stoppe alle Bots…');
    server.close();
    await manager.stopAll();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
