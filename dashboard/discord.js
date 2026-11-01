/*
 * Minimal Discord REST client for the panel: OAuth2 login, the user's servers, and bot-token calls
 * (channels, roles, bot profile). Uses the global fetch of Node 18+.
 */
const API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;
const cache = new Map();

/**
 * @param {string} route
 * @param {Object} opts {token, bearer, method, body, form}
 * @returns {Promise<*>}
 */
async function request(route, opts) {
    const o = opts || {};
    const headers = {'User-Agent': 'TeamZORA-Panel (https://github.com/einfxchpierre/TeamZORA, 1.0)'};
    if (o.token) headers.Authorization = `Bot ${o.token}`;
    if (o.bearer) headers.Authorization = `Bearer ${o.bearer}`;
    let body;
    if (o.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(o.form).toString();
    } else if (o.body) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(o.body);
    }
    let res;
    try {
        res = await fetch(`${API}${route}`, {method: o.method || 'GET', headers, body, signal: AbortSignal.timeout(15000)});
    } catch {
        throw Object.assign(new Error('Discord ist gerade nicht erreichbar'), {status: 502});
    }
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    if (!res.ok) {
        const message = data && data.message ? data.message : `Discord-API-Fehler ${res.status}`;
        throw Object.assign(new Error(message), {status: res.status === 401 ? 400 : 502, discordStatus: res.status});
    }
    return data;
}

/**
 * Cached GET with a bot token.
 * @param {string} key
 * @param {number} ttl Milliseconds
 * @param {Function} fn
 * @returns {Promise<*>}
 */
async function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await fn();
    cache.set(key, {value, until: Date.now() + ttl});
    return value;
}

function avatarURL(user, size) {
    if (!user) return null;
    if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=${size || 128}`;
    const index = Number((BigInt(user.id) >> 22n) % 6n); // eslint-disable-line no-bitwise
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function guildIconURL(guild, size) {
    if (!guild || !guild.icon) return null;
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith('a_') ? 'gif' : 'png'}?size=${size || 128}`;
}

/**
 * Channels and roles of a server, read with the bot's token.
 * @param {string} token
 * @param {string} guildID
 * @returns {Promise<Object>}
 */
function guildData(token, guildID) {
    return cached(`guild:${guildID}:${token.slice(-8)}`, 60000, async () => {
        const [guild, channels, roles] = await Promise.all([
            request(`/guilds/${guildID}?with_counts=true`, {token}),
            request(`/guilds/${guildID}/channels`, {token}),
            request(`/guilds/${guildID}/roles`, {token})
        ]);
        return {
            updatedAt: new Date().toISOString(),
            source: 'discord',
            guild: {
                id: guild.id,
                name: guild.name,
                icon: guildIconURL(guild, 256),
                banner: guild.banner ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.png?size=1024` : null,
                members: guild.approximate_member_count || null,
                online: guild.approximate_presence_count || null,
                boosts: guild.premium_subscription_count || 0
            },
            channels: channels
                .filter(c => ![10, 11, 12].includes(c.type))
                .map(c => ({id: c.id, name: c.name, type: c.type, parentId: c.parent_id || null, position: c.position || 0}))
                .sort((a, b) => a.position - b.position),
            roles: roles
                .filter(r => r.id !== guildID)
                .map(r => ({id: r.id, name: r.name, color: `#${(r.color || 0).toString(16).padStart(6, '0')}`, position: r.position, managed: r.managed}))
                .sort((a, b) => b.position - a.position)
        };
    });
}

/**
 * The bot account behind a token.
 * @param {string} token
 * @returns {Promise<Object>}
 */
function botUser(token) {
    return cached(`bot:${token.slice(-12)}`, 300000, async () => {
        const user = await request('/users/@me', {token});
        return {id: user.id, username: user.username, avatar: avatarURL(user, 256)};
    });
}

/**
 * Changes name and/or avatar of the bot account.
 * @param {string} token
 * @param {Object} input {username, avatar: data URI}
 * @returns {Promise<Object>}
 */
async function updateBotUser(token, input) {
    const body = {};
    if (input.username) body.username = String(input.username).slice(0, 32);
    if (input.avatar) body.avatar = input.avatar;
    const user = await request('/users/@me', {token, method: 'PATCH', body});
    cache.delete(`bot:${token.slice(-12)}`);
    return {id: user.id, username: user.username, avatar: avatarURL(user, 256)};
}

function forgetGuild(guildID) {
    for (const key of cache.keys()) {
        if (key.startsWith(`guild:${guildID}:`)) cache.delete(key);
    }
}

/* ---------- OAuth2 ---------- */

function oauthConfigured() {
    return !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.PANEL_URL);
}

function redirectURI() {
    return `${process.env.PANEL_URL.replace(/\/$/, '')}/auth/callback`;
}

function authorizeURL(state) {
    const params = new URLSearchParams({
        'client_id': process.env.DISCORD_CLIENT_ID,
        'redirect_uri': redirectURI(),
        'response_type': 'code',
        'scope': 'identify guilds',
        'prompt': 'none',
        state
    });
    return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code) {
    return request('/oauth2/token', {
        method: 'POST',
        form: {
            'client_id': process.env.DISCORD_CLIENT_ID,
            'client_secret': process.env.DISCORD_CLIENT_SECRET,
            'grant_type': 'authorization_code',
            code,
            'redirect_uri': redirectURI()
        }
    });
}

/**
 * Profile and manageable servers of a logged-in user.
 * @param {string} accessToken
 * @returns {Promise<{user: Object, guilds: Array}>}
 */
async function loadUser(accessToken) {
    const [user, guilds] = await Promise.all([
        request('/users/@me', {bearer: accessToken}),
        request('/users/@me/guilds', {bearer: accessToken})
    ]);
    return {
        user: {id: user.id, username: user.global_name || user.username, tag: user.username, avatar: avatarURL(user, 128)},
        guilds: guilds
            .filter(g => g.owner || (BigInt(g.permissions) & BigInt(MANAGE_GUILD | ADMINISTRATOR)) !== 0n) // eslint-disable-line no-bitwise
            .map(g => ({id: g.id, name: g.name, icon: guildIconURL(g, 128), owner: !!g.owner}))
    };
}

module.exports = {
    request,
    guildData,
    botUser,
    updateBotUser,
    forgetGuild,
    avatarURL,
    oauthConfigured,
    authorizeURL,
    exchangeCode,
    loadUser
};
