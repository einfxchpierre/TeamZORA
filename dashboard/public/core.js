/* global icon */
/*
 * Panel core: state, API, router, layout (top bar + server sidebar), modals, toasts and live updates.
 * Pages register themselves in Z.pages (see pages-servers.js, pages-bot.js).
 */
(function () {
    const Z = {
        state: {
            session: null,
            me: null,
            meta: null,
            bots: new Map(),
            parts: [],
            botId: null,
            detail: null,
            guild: null,
            profile: null,
            logs: [],
            stream: null,
            streamKey: null
        },
        pages: {},
        hooks: {}
    };
    window.Z = Z;

    const STATUS_LABEL = {running: 'Online', starting: 'Startet', restarting: 'Neustart', stopping: 'Stoppt', stopped: 'Offline', error: 'Fehler'};

    function $(sel, root) {
        return (root || document).querySelector(sel);
    }

    function esc(value) {
        return String(value === null || typeof value === 'undefined' ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatBytes(bytes) {
        if (!bytes && bytes !== 0) return '–';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let i = 0;
        while (value >= 1024 && i < units.length - 1) {
            value = value / 1024;
            i = i + 1;
        }
        return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function formatDuration(seconds) {
        if (!seconds && seconds !== 0) return '–';
        const s = Math.floor(seconds);
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d) return `${d}d ${h}h`;
        if (h) return `${h}h ${m}m`;
        if (m) return `${m}m`;
        return `${s % 60}s`;
    }

    function uptimeOf(bot) {
        if (!bot || !bot.startedAt || !bot.pid) return '–';
        return formatDuration((Date.now() - new Date(bot.startedAt).getTime()) / 1000);
    }

    function initials(name) {
        return esc(String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
    }

    function statusBadge(status) {
        return `<span class="pill status-${esc(status)}"><span class="dot"></span>${STATUS_LABEL[status] || esc(status)}</span>`;
    }

    function isActive(bot) {
        return !!bot && ['running', 'starting', 'restarting', 'stopping'].includes(bot.status);
    }

    function avatar(url, name, cls) {
        if (url) return `<img class="${cls || 'av'}" src="${esc(url)}" alt="" loading="lazy">`;
        return `<span class="${cls || 'av'} av-fallback">${initials(name)}</span>`;
    }

    /* ---------- API ---------- */

    async function api(method, url, body) {
        const res = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: {'Content-Type': 'application/json', 'X-Dashboard': '1'},
            body: body ? JSON.stringify(body) : null
        });
        let data = {};
        try {
            data = await res.json();
        } catch {
            data = {};
        }
        if (res.status === 401 && url !== '/api/login') {
            Z.state.session = {authenticated: false};
            go('/login');
            throw new Error('Bitte melde dich an');
        }
        if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
        return data;
    }

    function toast(message, isError) {
        const el = document.createElement('div');
        el.className = `toast${isError ? ' err' : ''}`;
        el.innerHTML = `${icon(isError ? 'alert' : 'check')}<span>${esc(message)}</span>`;
        $('#toasts').appendChild(el);
        setTimeout(() => el.remove(), 3800);
    }

    async function run(fn, success) {
        try {
            const result = await fn();
            if (success) toast(success);
            return result;
        } catch (e) {
            toast(e.message, true);
            return null;
        }
    }

    /* ---------- Modals ---------- */

    function openModal(html, small) {
        const card = $('#modal-card');
        card.className = `modal-card${small ? ' sm' : ''}`;
        card.innerHTML = html;
        $('#modal').classList.remove('hidden');
        const first = card.querySelector('input, select, button.btn-primary');
        if (first) first.focus();
    }

    function closeModal() {
        $('#modal').classList.add('hidden');
        $('#modal-card').innerHTML = '';
    }

    function confirmDialog(title, text, confirmLabel, danger) {
        return new Promise((resolve) => {
            openModal(`
                <div class="modal-head"><h3>${esc(title)}</h3></div>
                <div class="modal-body"><p>${esc(text)}</p></div>
                <div class="modal-foot">
                    <button class="btn" id="confirm-no">Abbrechen</button>
                    <button class="btn ${danger === false ? 'btn-primary' : 'btn-danger'}" id="confirm-yes">${esc(confirmLabel)}</button>
                </div>`, true);
            $('#confirm-yes').onclick = () => {
                closeModal();
                resolve(true);
            };
            $('#confirm-no').onclick = () => {
                closeModal();
                resolve(false);
            };
        });
    }

    /* ---------- Live updates ---------- */

    function connectStream(botId) {
        const key = botId || 'all';
        if (Z.state.stream && Z.state.streamKey === key) return;
        if (Z.state.stream) Z.state.stream.close();
        const source = new EventSource(botId ? `/api/bots/${botId}/stream` : '/api/stream');
        Z.state.stream = source;
        Z.state.streamKey = key;
        source.onopen = () => document.body.classList.add('live');
        source.onerror = () => document.body.classList.remove('live');
        source.addEventListener('bots', (e) => {
            Z.state.bots = new Map(JSON.parse(e.data).map(b => [b.id, b]));
            botChanged();
        });
        source.addEventListener('bot', (e) => {
            const bot = JSON.parse(e.data);
            Z.state.bots.set(bot.id, bot);
            botChanged(bot.id);
        });
        source.addEventListener('removed', (e) => {
            Z.state.bots.delete(JSON.parse(e.data).id);
            botChanged();
        });
        source.addEventListener('logs', (e) => {
            Z.state.logs = JSON.parse(e.data);
            if (Z.hooks.logs) Z.hooks.logs();
        });
        source.addEventListener('log', (e) => {
            const entry = JSON.parse(e.data);
            Z.state.logs.push(entry);
            if (Z.state.logs.length > 1000) Z.state.logs.shift();
            if (Z.hooks.log) Z.hooks.log(entry);
        });
    }

    function closeStream() {
        if (Z.state.stream) Z.state.stream.close();
        Z.state.stream = null;
        Z.state.streamKey = null;
    }

    function botChanged(id) {
        if (Z.state.botId && (!id || id === Z.state.botId)) {
            renderSideStatus();
            if (Z.hooks.bot) Z.hooks.bot(currentBot());
        } else if (!Z.state.botId && Z.hooks.bots) Z.hooks.bots();
    }

    function currentBot() {
        return Z.state.bots.get(Z.state.botId) || Z.state.detail;
    }

    /* ---------- Layout ---------- */

    const BOT_NAV = [
        {section: 'Bot'},
        {key: 'home', label: 'Dashboard', icon: 'grid'},
        {key: 'problems', label: 'Probleme', icon: 'alert', badge: true},
        {key: 'config', label: 'Konfiguration', icon: 'settings'},
        {key: 'modules', label: 'Module', icon: 'puzzle'},
        {key: 'commands', label: 'Befehle', icon: 'terminalSlash'},
        {key: 'emojis', label: 'Emojis', icon: 'sparkle'},
        {key: 'console', label: 'Konsole', icon: 'terminal'},
        {section: 'Verwaltung'},
        {key: 'profile', label: 'Bot-Profil', icon: 'bot'},
        {key: 'team', label: 'Team & Zugriff', icon: 'users'},
        {key: 'settings', label: 'Einstellungen', icon: 'sliders'}
    ];

    function renderShell(withSide) {
        const me = Z.state.session.user;
        $('#app').innerHTML = `
            <header class="topnav">
                ${withSide ? `<button class="icon-btn only-mobile" id="open-side" aria-label="Menü">${icon('menu')}</button>` : ''}
                <a class="logo" href="#/"><span class="logo-mark">${icon('bot')}</span><span class="logo-text">Team<b>ZORA</b></span></a>
                <nav class="topnav-links">
                    <a href="#/" data-top="servers">${icon('server')}<span>Server</span></a>
                    ${me.admin ? `<a href="#/admin" data-top="admin">${icon('shield')}<span>Admin</span></a>` : ''}
                </nav>
                <div class="topnav-right">
                    <span class="live-dot" title="Live-Verbindung"></span>
                    <button class="user-btn" id="user-btn">${avatar(me.avatar, me.username, 'av av-sm')}<span class="hide-sm">${esc(me.username)}</span>${icon('chevronDown')}</button>
                    <div class="dropdown hidden" id="user-menu">
                        <div class="dropdown-head">${avatar(me.avatar, me.username, 'av')}<div><strong>${esc(me.username)}</strong><small>${me.admin ? 'Panel-Admin' : 'Mitglied'}</small></div></div>
                        ${me.admin ? `<a href="#/admin">${icon('shield')}Admin-Bereich</a>` : ''}
                        <button id="logout">${icon('logout')}Abmelden</button>
                    </div>
                </div>
            </header>
            <div class="layout${withSide ? ' with-side' : ''}">
                ${withSide ? '<aside class="side" id="side"></aside><div class="side-backdrop" id="side-backdrop"></div>' : ''}
                <main class="page" id="page"></main>
            </div>`;
        const top = Z.state.parts[0] === 'admin' ? 'admin' : 'servers';
        const link = document.querySelector(`[data-top="${top}"]`);
        if (link) link.classList.add('active');
    }

    function renderSide() {
        const side = $('#side');
        if (!side) return;
        const bot = currentBot();
        const g = Z.state.guild;
        const page = Z.state.parts[2] || 'home';
        side.innerHTML = `
            <div class="side-guild">
                ${avatar(g && g.icon, (g && g.name) || (bot && bot.name), 'av av-md')}
                <div class="side-guild-text"><strong>${esc((g && g.name) || (bot && bot.name) || '…')}</strong><span id="side-status">${bot ? statusBadge(bot.status) : ''}</span></div>
            </div>
            <div id="side-alert"></div>
            <a class="side-link" href="#/">${icon('back')}Zurück zur Serverauswahl</a>
            ${BOT_NAV.map((n) => {
        if (n.section) return `<div class="side-label">${n.section}</div>`;
        return `<a class="side-link${page === n.key ? ' active' : ''}" href="#/s/${Z.state.botId}${n.key === 'home' ? '' : `/${n.key}`}">
                    <span class="side-icon">${icon(n.icon)}</span>${n.label}${n.badge ? '<span class="side-badge hidden" id="problem-badge"></span>' : ''}</a>`;
    }).join('')}`;
        renderSideStatus();
    }

    function renderSideStatus() {
        const bot = currentBot();
        if (!bot) return;
        const status = $('#side-status');
        if (status) status.innerHTML = statusBadge(bot.status);
        const badge = $('#problem-badge');
        if (badge) {
            const count = (bot.problemCount || 0) + (bot.warningCount || 0);
            badge.textContent = count;
            badge.classList.toggle('hidden', !count);
            badge.classList.toggle('warn', !bot.problemCount);
        }
        const alert = $('#side-alert');
        if (alert) {
            alert.innerHTML = bot.hasToken ? '' : `<a class="side-alert" href="#/s/${Z.state.botId}/config">${icon('key')}<span>Kein Token – <u>jetzt einrichten</u></span></a>`;
        }
    }

    function openSide() {
        document.body.classList.add('side-open');
    }

    function closeSide() {
        document.body.classList.remove('side-open');
    }

    /* ---------- Router ---------- */

    function go(path) {
        location.hash = `#${path}`;
    }

    function parseHash() {
        const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
        const [pathPart, query] = hash.split('?');
        return {parts: pathPart ? pathPart.split('/') : [], query: new URLSearchParams(query || '')};
    }

    async function loadBot(id) {
        if (Z.state.botId === id && Z.state.detail) return true;
        Z.state.botId = id;
        Z.state.detail = null;
        Z.state.guild = null;
        Z.state.profile = null;
        Z.state.logs = [];
        try {
            Z.state.detail = await api('GET', `/api/bots/${id}`);
        } catch (e) {
            toast(e.message, true);
            Z.state.botId = null;
            go('/');
            return false;
        }
        Z.state.bots.set(id, Z.state.detail);
        connectStream(id);
        api('GET', `/api/bots/${id}/guild`).then((g) => {
            Z.state.guild = g && g.guild ? g.guild : null;
            Z.state.guildData = g && g.channels ? g : null;
            renderSide();
            if (Z.hooks.guild) Z.hooks.guild();
        }).catch(() => null);
        return true;
    }

    async function route() {
        Z.hooks = {};
        closeSide();
        closeModal();
        const {parts, query} = parseHash();
        Z.state.parts = parts;
        Z.state.query = query;
        if (!Z.state.session || !Z.state.session.authenticated) {
            closeStream();
            return Z.pages.login({query});
        }
        if (!Z.state.meta) Z.state.meta = await api('GET', '/api/meta').catch(() => ({modules: [], schema: []}));
        if (parts[0] === 's' && (/^[a-f0-9]{12}$/).test(parts[1] || '')) {
            const changed = Z.state.botId !== parts[1];
            if (changed || !document.getElementById('side')) renderShell(true);
            if (!(await loadBot(parts[1]))) return;
            renderSide();
            const page = Z.pages[`bot.${parts[2] || 'home'}`] || Z.pages['bot.home'];
            const fresh = document.createElement('main');
            fresh.className = 'page';
            fresh.id = 'page';
            $('#page').replaceWith(fresh);
            fresh.innerHTML = '<div class="loading">Lade…</div>';
            window.scrollTo(0, 0);
            return page({id: parts[1], parts, query, el: $('#page')});
        }
        Z.state.botId = null;
        Z.state.detail = null;
        connectStream(null);
        renderShell(false);
        const name = {admin: 'admin', new: 'new', login: 'servers'}[parts[0]] || 'servers';
        return Z.pages[name]({parts, query, el: $('#page')});
    }

    async function refreshSession() {
        Z.state.session = await fetch('/api/session', {credentials: 'same-origin'}).then(r => r.json()).catch(() => ({authenticated: false}));
        return Z.state.session;
    }

    function bindGlobal() {
        document.addEventListener('click', async (e) => {
            const t = e.target;
            if (t.closest('#user-btn')) {
                $('#user-menu').classList.toggle('hidden');
                return;
            }
            if (!t.closest('#user-menu') && $('#user-menu')) $('#user-menu').classList.add('hidden');
            if (t.closest('#logout')) {
                await api('POST', '/api/logout').catch(() => null);
                Z.state.session = {authenticated: false};
                closeStream();
                go('/login');
                return;
            }
            if (t.closest('#open-side')) openSide();
            if (t.closest('#side-backdrop') || t.closest('.side-link')) closeSide();
            if (t.closest('[data-close-modal]')) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
                closeSide();
            }
        });
        $('#modal').addEventListener('click', (e) => {
            if (e.target.id === 'modal') closeModal();
        });
        window.addEventListener('hashchange', route);
        setInterval(() => {
            if (!document.hidden && Z.hooks.tick) Z.hooks.tick();
        }, 10000);
    }

    Object.assign(Z, {
        $, esc, api, toast, run, go, route, avatar, statusBadge, isActive, uptimeOf, formatBytes, formatDuration,
        initials, openModal, closeModal, confirmDialog, currentBot, renderSide, refreshSession, STATUS_LABEL
    });

    document.addEventListener('DOMContentLoaded', async () => {
        bindGlobal();
        await refreshSession();
        route();
    });
}());
