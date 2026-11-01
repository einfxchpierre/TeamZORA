/*
 * Panel accounts and sessions. Only Discord accounts on the allowlist (panel.json, seeded with PANEL_ADMINS)
 * can log in. The password login stays available as local admin access.
 *
 * Access to a bot: panel admins see every bot, other users see bots they own or whose server they manage.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;

function readJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
}

function sessionCookie(token) {
    if (!token) return 'dash_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
    return `dash_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`;
}

function isSnowflake(id) {
    return typeof id === 'string' && (/^\d{15,22}$/).test(id);
}

/**
 * Accounts, sessions and permission checks.
 */
class Auth {

    /**
     * @param {string} storageDir
     */
    constructor(storageDir) {
        this.file = path.join(storageDir, 'panel.json');
        this.data = readJSON(this.file, {admins: [], members: {}});
        this.data.admins = this.data.admins || [];
        this.data.members = this.data.members || {};
        for (const id of (process.env.PANEL_ADMINS || '').split(',').map(s => s.trim()).filter(isSnowflake)) {
            if (!this.data.admins.includes(id)) this.data.admins.push(id);
        }
        this.sessions = new Map();
        this.states = new Map();
        this.persist();
    }

    persist() {
        fs.mkdirSync(path.dirname(this.file), {recursive: true});
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), {mode: 0o600});
    }

    /* ---------- Sessions ---------- */

    createSession(session) {
        const token = crypto.randomBytes(32).toString('hex');
        this.sessions.set(token, {...session, expires: Date.now() + SESSION_TTL});
        return token;
    }

    session(req) {
        const token = parseCookies(req).dash_session;
        const s = token ? this.sessions.get(token) : null;
        if (!s) return null;
        if (s.expires < Date.now()) {
            this.sessions.delete(token);
            return null;
        }
        s.token = token;
        return s;
    }

    destroy(req) {
        const token = parseCookies(req).dash_session;
        if (token) this.sessions.delete(token);
    }

    /** Ends all sessions of a user (e.g. after removing their access). */
    destroyUser(userId) {
        for (const [token, s] of this.sessions) {
            if (s.user && s.user.id === userId) this.sessions.delete(token);
        }
    }

    newState() {
        const state = crypto.randomBytes(16).toString('hex');
        this.states.set(state, Date.now() + 600000);
        return state;
    }

    consumeState(state, req) {
        const expected = parseCookies(req).oauth_state;
        const until = this.states.get(state);
        this.states.delete(state);
        return !!(state && until && until > Date.now() && expected === state);
    }

    /* ---------- Accounts ---------- */

    isAdmin(session) {
        return !!session && (session.local || this.data.admins.includes(session.user.id));
    }

    isAllowed(userId) {
        return this.data.admins.includes(userId) || !!this.data.members[userId];
    }

    listUsers() {
        const ids = new Set([...this.data.admins, ...Object.keys(this.data.members)]);
        return [...ids].map(id => ({
            id,
            name: (this.data.members[id] && this.data.members[id].name) || null,
            avatar: (this.data.members[id] && this.data.members[id].avatar) || null,
            admin: this.data.admins.includes(id),
            addedAt: this.data.members[id] ? this.data.members[id].addedAt : null,
            lastLogin: this.data.members[id] ? this.data.members[id].lastLogin : null
        }));
    }

    addUser(id, admin) {
        if (!isSnowflake(id)) throw Object.assign(new Error('Ungültige Discord-ID'), {status: 400});
        if (!this.data.members[id]) this.data.members[id] = {addedAt: new Date().toISOString()};
        this.setAdmin(id, !!admin);
    }

    setAdmin(id, admin) {
        this.data.admins = this.data.admins.filter(a => a !== id);
        if (admin) this.data.admins.push(id);
        this.persist();
    }

    removeUser(id) {
        delete this.data.members[id];
        this.data.admins = this.data.admins.filter(a => a !== id);
        this.persist();
        this.destroyUser(id);
    }

    /** Remembers name/avatar of a user on login. */
    touch(user) {
        if (!this.data.members[user.id]) this.data.members[user.id] = {addedAt: new Date().toISOString()};
        Object.assign(this.data.members[user.id], {name: user.username, avatar: user.avatar, lastLogin: new Date().toISOString()});
        this.persist();
    }

    /**
     * Whether the session may manage a bot.
     * @param {Object} session
     * @param {Object} entry Bot registry entry
     * @param {string} guildID Server of the bot
     * @returns {boolean}
     */
    canAccess(session, entry, guildID) {
        if (!session) return false;
        if (this.isAdmin(session)) return true;
        if ((entry.owners || []).includes(session.user.id)) return true;
        return !!guildID && (session.guilds || []).some(g => g.id === guildID);
    }
}

module.exports = {Auth, isSnowflake, sessionCookie};
