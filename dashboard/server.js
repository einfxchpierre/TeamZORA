/*
 * TeamZORA panel: hosts several CustomDCBot instances (one per Discord server) and lets allowlisted
 * Discord accounts manage the bots of their servers.
 * Start: npm run dashboard
 * Env: DASHBOARD_PORT, DASHBOARD_HOST, DASHBOARD_PASSWORD, DASHBOARD_DATA,
 *      DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PANEL_URL, PANEL_ADMINS
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const discord = require('./discord');
const {Auth, cookieFlags, sessionCookie} = require('./auth');
const {BotManager, configSchema, listAvailableModules} = require('./botManager');

const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const STORAGE = path.resolve(process.env.DASHBOARD_DATA || path.join(__dirname, '..', 'bots'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const EMOJI_DIR = path.resolve(__dirname, '..', 'emojis');
const VERSION = require('../package.json').version;
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

fs.mkdirSync(STORAGE, {recursive: true});
const manager = new BotManager(STORAGE);
const auth = new Auth(STORAGE);
const loginAttempts = new Map();
const streams = new Set();

function loadPassword() {
    if (process.env.DASHBOARD_PASSWORD) return process.env.DASHBOARD_PASSWORD;
    const file = path.join(STORAGE, '.dashboard-password');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const generated = crypto.randomBytes(12).toString('base64url');
    fs.writeFileSync(file, generated, {mode: 0o600});
    console.log(`[dashboard] Neues Admin-Passwort generiert: ${generated}  (gespeichert in ${file})`);
    return generated;
}

const PASSWORD_HASH = crypto.createHash('sha256').update(loadPassword()).digest();

function checkPassword(input) {
    const hash = crypto.createHash('sha256').update(String(input || '')).digest();
    return crypto.timingSafeEqual(hash, PASSWORD_HASH);
}

function send(res, status, body, headers) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function redirect(res, location, headers) {
    res.writeHead(302, {Location: location, 'Cache-Control': 'no-store', ...headers});
    res.end();
}

function fail(status, message) {
    return Object.assign(new Error(message), {status});
}

function readBody(req, limit) {
    const max = limit || 1024 * 1024;
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size = size + chunk.length;
            if (size > max) {
                reject(fail(413, 'Anfrage zu groß'));
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
                reject(fail(400, 'Ungültiges JSON'));
            }
        });
        req.on('error', reject);
    });
}

/* ---------- Static files ---------- */

function serveFile(res, file, type, cacheControl) {
    fs.readFile(file, (err, data) => {
        if (err) return send(res, 404, {error: 'Nicht gefunden'});
        res.writeHead(200, {'Content-Type': type, 'Cache-Control': cacheControl});
        res.end(data);
    });
}

function serveStatic(req, res) {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const emoji = urlPath.match(/^\/emojis\/(?<name>z_[a-z0-9_]+)\.png$/);
    if (emoji) return serveFile(res, path.join(EMOJI_DIR, 'png', `${emoji.groups.name}.png`), 'image/png', 'public, max-age=86400');
    const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, {error: 'Verboten'});
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), MIME['.html'], 'no-cache');
    serveFile(res, file, MIME[path.extname(file)] || 'application/octet-stream', 'no-cache');
}

/* ---------- Access helpers ---------- */

function canAccess(session, id) {
    const bot = manager.get(id);
    return auth.canAccess(session, bot.entry, manager.guildID(id));
}

function requireBot(session, id) {
    if (!canAccess(session, id)) throw fail(403, 'Kein Zugriff auf diesen Bot');
}

function requireAdmin(session) {
    if (!auth.isAdmin(session)) throw fail(403, 'Nur für Panel-Admins');
}

function isOwnerOrAdmin(session, id) {
    return auth.isAdmin(session) || (manager.get(id).entry.owners || []).includes(session.user.id);
}

function visibleBots(session) {
    return manager.list().filter(b => canAccess(session, b.id));
}

function publicUser(session) {
    return {...session.user, admin: auth.isAdmin(session), local: !!session.local};
}

/**
 * Server list: servers with a bot (incl. Discord info) and managed servers without one.
 * @param {Object} session
 * @returns {Promise<Object>}
 */
async function serverList(session) {
    const bots = visibleBots(session);
    const withBot = await Promise.all(bots.map(async (b) => {
        const token = manager.token(b.id);
        let guild = null;
        let profile = null;
        if (token && b.guildID) guild = await discord.guildData(token, b.guildID).then(g => g.guild).catch(() => null);
        if (token) profile = await discord.botUser(token).catch(() => null);
        const own = (session.guilds || []).find(g => g.id === b.guildID);
        return {...b, guild: guild || (own ? {id: own.id, name: own.name, icon: own.icon} : null), profile};
    }));
    const used = new Set(bots.map(b => b.guildID));
    const without = (session.guilds || []).filter(g => !used.has(g.id));
    return {withBot, without};
}

/* ---------- Live updates ---------- */

function openStream(req, res, session, botID) {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
    const client = {res, botID, session};
    streams.add(client);
    res.write(`event: bots\ndata: ${JSON.stringify(visibleBots(session))}\n\n`);
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
        if (botID && client.botID !== botID) continue;
        const target = botID || data.id;
        try {
            if (target && manager.bots.has(target) && !canAccess(client.session, target)) continue;
        } catch {
            continue;
        }
        client.res.write(payload);
    }
}

manager.on('update', summary => broadcast('bot', summary));
manager.on('removed', id => broadcast('removed', {id}));
manager.on('log', (id, entry) => broadcast('log', entry, id));

/* ---------- Auth routes ---------- */

async function handleAuth(req, res, pathname) {
    const url = new URL(req.url, 'http://x');
    if (pathname === '/auth/login') {
        if (!discord.oauthConfigured()) return redirect(res, '/#/login?error=oauth');
        const state = auth.newState();
        return redirect(res, discord.authorizeURL(state), {'Set-Cookie': `oauth_state=${state}; ${cookieFlags()}; Path=/auth; Max-Age=600`});
    }
    if (pathname === '/auth/callback') {
        if (!auth.consumeState(url.searchParams.get('state'), req) || !url.searchParams.get('code')) return redirect(res, '/#/login?error=state');
        try {
            const token = await discord.exchangeCode(url.searchParams.get('code'));
            const {user, guilds} = await discord.loadUser(token.access_token);
            if (!auth.isAllowed(user.id)) return redirect(res, `/#/login?error=denied&id=${user.id}`);
            auth.touch(user);
            const session = auth.createSession({user, guilds, accessToken: token.access_token});
            return redirect(res, '/#/', {'Set-Cookie': sessionCookie(session)});
        } catch (e) {
            console.error('[dashboard] Discord-Login fehlgeschlagen:', e.message);
            return redirect(res, '/#/login?error=discord');
        }
    }
    send(res, 404, {error: 'Nicht gefunden'});
}

/**
 * Client IP; behind nginx/Cloudflare (TRUST_PROXY=1) the forwarded header from localhost is used.
 * @param {Request} req
 * @returns {string}
 */
function clientIP(req) {
    const remote = req.socket.remoteAddress || '';
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
    if (process.env.TRUST_PROXY === '1' && local && req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
    return remote;
}

async function handlePasswordLogin(req, res) {
    const ip = clientIP(req);
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
    const token = auth.createSession({local: true, user: {id: 'local', username: 'Admin', avatar: null}, guilds: []});
    send(res, 200, {ok: true}, {'Set-Cookie': sessionCookie(token)});
}

/* ---------- Bot routes ---------- */

async function handleBotRoute(req, res, session, id, action) {
    requireBot(session, id);
    const method = req.method;
    if (method === 'GET') {
        switch (action || '') {
            case '':
                return send(res, 200, manager.details(id));
            case 'stream':
                return openStream(req, res, session, id);
            case 'emojis':
                return send(res, 200, manager.emojiStatus(id) || {});
            case 'problems':
                return send(res, 200, manager.problems(id));
            case 'history':
                return send(res, 200, manager.history(id));
            case 'commands':
                return send(res, 200, manager.commands(id));
            case 'guild': {
                const token = manager.token(id);
                const guildID = manager.guildID(id);
                const live = token && guildID ? await discord.guildData(token, guildID).catch(() => null) : null;
                return send(res, 200, live || manager.guildCache(id) || {});
            }
            case 'profile': {
                const token = manager.token(id);
                if (!token) return send(res, 200, {});
                return send(res, 200, await discord.botUser(token).catch(e => ({error: e.message})));
            }
            default:
                return send(res, 404, {error: 'Nicht gefunden'});
        }
    }
    if (method === 'DELETE' && !action) {
        if (!isOwnerOrAdmin(session, id)) throw fail(403, 'Nur Besitzer oder Admins können Bots löschen');
        await manager.remove(id);
        return send(res, 200, {ok: true});
    }
    if (method !== 'POST' && method !== 'PUT') return send(res, 405, {error: 'Methode nicht erlaubt'});
    const body = await readBody(req, action === 'profile' ? 12 * 1024 * 1024 : null);
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
            discord.forgetGuild(manager.guildID(id));
            break;
        case 'modules':
            manager.updateModules(id, body);
            break;
        case 'reset-module':
            manager.resetModule(id, String(body.module || ''));
            break;
        case 'owners':
            if (!isOwnerOrAdmin(session, id)) throw fail(403, 'Nur Besitzer oder Admins');
            manager.setOwners(id, Array.isArray(body.owners) ? body.owners.map(String) : []);
            break;
        case 'profile': {
            const token = manager.token(id);
            if (!token) throw fail(400, 'Der Bot hat noch keinen Token');
            return send(res, 200, await discord.updateBotUser(token, body));
        }
        default:
            return send(res, 404, {error: 'Nicht gefunden'});
    }
    send(res, 200, manager.details(id));
}

async function handleAdmin(req, res, session, pathname) {
    requireAdmin(session);
    if (pathname === '/api/admin/users' && req.method === 'GET') return send(res, 200, auth.listUsers());
    if (pathname === '/api/admin/users' && req.method === 'POST') {
        const body = await readBody(req);
        auth.addUser(String(body.id || '').trim(), !!body.admin);
        return send(res, 200, auth.listUsers());
    }
    const match = pathname.match(/^\/api\/admin\/users\/(?<id>\d{15,22})$/);
    if (match && req.method === 'PUT') {
        const body = await readBody(req);
        auth.setAdmin(match.groups.id, !!body.admin);
        return send(res, 200, auth.listUsers());
    }
    if (match && req.method === 'DELETE') {
        if (match.groups.id === session.user.id) throw fail(400, 'Du kannst dich nicht selbst entfernen');
        auth.removeUser(match.groups.id);
        return send(res, 200, auth.listUsers());
    }
    send(res, 404, {error: 'Nicht gefunden'});
}

function systemInfo() {
    return {
        hostname: os.hostname(),
        node: process.version,
        cpus: os.cpus().length,
        load: os.loadavg(),
        totalMem: os.totalmem(),
        freeMem: os.freemem(),
        uptime: os.uptime(),
        version: VERSION
    };
}

async function handleApi(req, res, pathname) {
    if (pathname === '/api/login' && req.method === 'POST') return handlePasswordLogin(req, res);
    const session = auth.session(req);
    if (pathname === '/api/session') {
        return send(res, 200, {authenticated: !!session, oauth: discord.oauthConfigured(), user: session ? publicUser(session) : null});
    }
    if (!session) return send(res, 401, {error: 'Nicht angemeldet'});
    // CSRF guard: state-changing requests must come from our frontend (custom header)
    if (req.method !== 'GET' && req.headers['x-dashboard'] !== '1') return send(res, 403, {error: 'Ungültige Anfrage'});

    if (pathname === '/api/logout' && req.method === 'POST') {
        auth.destroy(req);
        return send(res, 200, {ok: true}, {'Set-Cookie': sessionCookie(null)});
    }
    if (pathname === '/api/me') return send(res, 200, {user: publicUser(session), ...(await serverList(session)), system: auth.isAdmin(session) ? systemInfo() : {version: VERSION}});
    if (pathname === '/api/me/refresh' && req.method === 'POST') {
        if (session.accessToken) session.guilds = (await discord.loadUser(session.accessToken)).guilds;
        return send(res, 200, {user: publicUser(session), ...(await serverList(session))});
    }
    if (pathname === '/api/meta') return send(res, 200, {modules: listAvailableModules(), schema: configSchema(), version: VERSION});
    if (pathname === '/api/emojis') return send(res, 200, EMOJI_META);
    if (pathname === '/api/stream') return openStream(req, res, session, null);
    if (pathname.startsWith('/api/admin/')) return handleAdmin(req, res, session, pathname);

    if (pathname === '/api/bots' && req.method === 'POST') {
        const body = await readBody(req);
        const guildID = String(body.guildID || '').trim();
        if (!auth.isAdmin(session) && !(session.guilds || []).some(g => g.id === guildID)) throw fail(403, 'Du kannst nur Bots für Server anlegen, die du verwaltest');
        const created = manager.create({...body, owners: session.local ? [] : [session.user.id]});
        if (created.hasToken) manager.start(created.id);
        return send(res, 201, manager.details(created.id));
    }
    if ((pathname === '/api/bots/start-all' || pathname === '/api/bots/stop-all') && req.method === 'POST') {
        requireAdmin(session);
        if (pathname.endsWith('stop-all')) await manager.stopAll();
        else manager.list().filter(b => b.hasToken).forEach(b => manager.start(b.id));
        return send(res, 200, {ok: true});
    }
    const content = pathname.match(/^\/api\/bots\/(?<id>[a-f0-9]{12})\/content\/(?<module>[a-z0-9_-]+)(?:\/(?<file>[a-z0-9_.-]+\.json))?$/i);
    if (content) {
        const {id, module: moduleName, file} = content.groups;
        requireBot(session, id);
        if (req.method === 'GET' && !file) return send(res, 200, {files: manager.moduleContent(id, moduleName)});
        if (req.method === 'PUT' && file) {
            const body = await readBody(req);
            manager.saveModuleContent(id, moduleName, file, body.value);
            return send(res, 200, {files: manager.moduleContent(id, moduleName)});
        }
        return send(res, 405, {error: 'Methode nicht erlaubt'});
    }
    const match = pathname.match(/^\/api\/bots\/(?<id>[a-f0-9]{12})(?:\/(?<action>[a-z-]+))?$/);
    if (match) return handleBotRoute(req, res, session, match.groups.id, match.groups.action);
    send(res, 404, {error: 'Nicht gefunden'});
}

const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    const pathname = new URL(req.url, 'http://x').pathname;
    let handler = null;
    if (pathname.startsWith('/api/')) handler = handleApi(req, res, pathname);
    else if (pathname.startsWith('/auth/')) handler = handleAuth(req, res, pathname);
    if (!handler) return serveStatic(req, res);
    handler.catch((err) => {
        if (res.headersSent) return res.end();
        send(res, err.status || 500, {error: err.message || 'Interner Fehler'});
    });
});

server.listen(PORT, HOST, () => {
    console.log(`[dashboard] Läuft auf http://${HOST}:${PORT}  –  Bots werden in ${STORAGE} gespeichert`);
    if (!discord.oauthConfigured()) console.log('[dashboard] Discord-Login ist nicht eingerichtet (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PANEL_URL) – nur Admin-Passwort aktiv.');
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
