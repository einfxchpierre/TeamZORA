/* global icon, hydrateIcons, openContentEditor, renderEmojiTab */
const state = {
    bots: new Map(),
    meta: null,
    system: null,
    route: {name: 'overview'},
    detail: null,
    tab: 'console',
    logs: [],
    autoScroll: true,
    moduleDraft: null,
    moduleFilter: 'all',
    moduleSearch: '',
    stream: null
};

const STATUS_LABEL = {
    running: 'Online',
    starting: 'Startet',
    restarting: 'Neustart',
    stopping: 'Stoppt',
    stopped: 'Offline',
    error: 'Fehler'
};

const CHIP_LABEL = {all: 'Alle', enabled: 'Aktiv'};

/**
 * querySelector shortcut.
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {Element|null}
 */
function $(sel, root) {
    return (root || document).querySelector(sel);
}

/**
 * Escapes text for safe HTML interpolation.
 * @param {*} value
 * @returns {string}
 */
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
    if (!bot.startedAt || !bot.pid) return '–';
    return formatDuration((Date.now() - new Date(bot.startedAt).getTime()) / 1000);
}

function initials(name) {
    return esc(String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
}

function statusBadge(status) {
    return `<span class="badge status-${esc(status)}"><span class="dot"></span>${STATUS_LABEL[status] || esc(status)}</span>`;
}

function isActive(bot) {
    return ['running', 'starting', 'restarting', 'stopping'].includes(bot.status);
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
        showLogin();
        throw new Error('Nicht angemeldet');
    }
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
}

function toast(message, isError) {
    const el = document.createElement('div');
    el.className = `toast${isError ? ' err' : ''}`;
    el.innerHTML = `${icon(isError ? 'alert' : 'check')}<span>${esc(message)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

async function run(promiseFn, success) {
    try {
        const result = await promiseFn();
        if (success) toast(success);
        return result;
    } catch {
        toast(e.message, true);
        return null;
    }
}

/* ---------- Live updates (SSE) ---------- */

function connectStream() {
    if (state.stream) state.stream.close();
    const url = state.route.name === 'bot' ? `/api/bots/${state.route.id}/stream` : '/api/stream';
    const source = new EventSource(url);
    state.stream = source;
    source.onopen = () => $('#conn').classList.add('on');
    source.onerror = () => $('#conn').classList.remove('on');
    source.addEventListener('bots', (e) => {
        state.bots = new Map(JSON.parse(e.data).map(b => [b.id, b]));
        renderNav();
        refreshView();
    });
    source.addEventListener('bot', (e) => {
        const bot = JSON.parse(e.data);
        state.bots.set(bot.id, bot);
        renderNav();
        refreshView();
    });
    source.addEventListener('removed', (e) => {
        state.bots.delete(JSON.parse(e.data).id);
        renderNav();
        refreshView();
    });
    source.addEventListener('logs', (e) => {
        state.logs = JSON.parse(e.data);
        renderLogs(true);
    });
    source.addEventListener('log', (e) => {
        const entry = JSON.parse(e.data);
        state.logs.push(entry);
        if (state.logs.length > 1000) state.logs.shift();
        appendLog(entry);
    });
}

/* ---------- Routing ---------- */

function parseRoute() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const match = hash.match(/^\/bot\/(?<id>[a-f0-9]{12})(?:\/(?<tab>[a-z]+))?(?:\/(?<module>[a-z0-9_-]+))?$/i);
    if (match) return {name: 'bot', id: match.groups.id, tab: match.groups.tab || 'console', module: match.groups.module || null};
    return {name: 'overview'};
}

async function onRoute() {
    const prev = state.route;
    state.route = parseRoute();
    closeSidebar();
    if (state.route.name === 'bot') {
        const sameBot = prev.name === 'bot' && prev.id === state.route.id;
        state.tab = state.route.tab;
        if (!sameBot) {
            state.detail = null;
            state.logs = [];
            state.moduleDraft = null;
            $('#view').innerHTML = '<div class="empty muted">Lade…</div>';
            const detail = await run(() => api('GET', `/api/bots/${state.route.id}`));
            if (!detail) {
                location.hash = '#/';
                return;
            }
            state.detail = detail;
            connectStream();
        }
        renderBot();
    } else {
        if (prev.name !== 'overview' || !state.stream) connectStream();
        const overview = await run(() => api('GET', '/api/overview'));
        if (overview) {
            state.system = overview.system;
            state.bots = new Map(overview.bots.map(b => [b.id, b]));
        }
        renderOverview();
    }
    renderNav();
}

function refreshView() {
    if (state.route.name === 'overview') renderOverview();
    else if (state.route.name === 'bot') renderBotHead();
}

/* ---------- Sidebar ---------- */

function renderNav() {
    const nav = $('#nav-bots');
    const bots = [...state.bots.values()];
    if (!bots.length) {
        nav.innerHTML = '<div class="nav-empty">Noch keine Bots</div>';
    } else {
        nav.innerHTML = bots.map(b => `
            <a href="#/bot/${b.id}" class="nav-link${state.route.id === b.id ? ' active' : ''}">
                <span class="dot status-${esc(b.status)}"></span>
                <span class="label">${esc(b.name)}</span>
            </a>`).join('');
    }
    for (const link of document.querySelectorAll('.nav [data-route]')) {
        link.classList.toggle('active', state.route.name === link.getAttribute('data-route'));
    }
    $('#topbar-title').textContent = state.route.name === 'bot' && state.bots.get(state.route.id) ? state.bots.get(state.route.id).name : 'Übersicht';
}

function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#backdrop').classList.add('open');
}

function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#backdrop').classList.remove('open');
}

/* ---------- Overview ---------- */

function statCard(label, iconName, value, sub, percent) {
    return `
        <div class="card stat">
            <div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon(iconName)}</span></div>
            <div class="stat-value">${esc(value)}</div>
            ${typeof percent === 'number' ? `<div class="bar"><span style="width:${Math.min(100, Math.max(0, percent)).toFixed(0)}%"></span></div>` : ''}
            <div class="stat-sub">${esc(sub)}</div>
        </div>`;
}

function botCard(b) {
    const active = isActive(b);
    return `
        <div class="card bot-card">
            <div class="bot-card-head">
                <a class="avatar" href="#/bot/${b.id}">${initials(b.name)}</a>
                <a class="bot-card-title" href="#/bot/${b.id}">
                    <strong>${esc(b.name)}</strong>
                    <span class="mono">${b.guildID ? `Server ${esc(b.guildID)}` : 'Kein Server gesetzt'}</span>
                </a>
                ${statusBadge(b.status)}
            </div>
            ${b.statusReason ? `<div class="reason">${icon('alert')}<span>${esc(b.statusReason)}</span></div>` : ''}
            ${b.hasToken ? '' : `<div class="reason">${icon('key')}<span>Kein Token hinterlegt – in den Einstellungen ergänzen.</span></div>`}
            <dl class="meta">
                <div><dt>Uptime</dt><dd>${uptimeOf(b)}</dd></div>
                <div><dt>RAM</dt><dd>${formatBytes(b.memory)}</dd></div>
                <div><dt>Module</dt><dd>${b.enabledModules}</dd></div>
            </dl>
            <div class="bot-card-actions">
                ${active
                    ? `<button class="btn btn-sm" data-bot-action="stop" data-id="${b.id}">${icon('stop')}Stop</button>
                       <button class="btn btn-sm" data-bot-action="restart" data-id="${b.id}">${icon('restart')}Neustart</button>`
                    : `<button class="btn btn-sm btn-primary" data-bot-action="start" data-id="${b.id}" ${b.hasToken ? '' : 'disabled'}>${icon('play')}Start</button>`}
                <a class="btn btn-sm btn-ghost" href="#/bot/${b.id}">Öffnen${icon('chevron')}</a>
            </div>
        </div>`;
}

function renderOverview() {
    const bots = [...state.bots.values()];
    const online = bots.filter(b => b.status === 'running').length;
    const errors = bots.filter(b => b.status === 'error' || b.status === 'restarting').length;
    const ram = bots.reduce((sum, b) => sum + (b.memory || 0), 0);
    const sys = state.system;
    const memUsed = sys ? sys.totalMem - sys.freeMem : 0;

    $('#view').innerHTML = `
        <div class="page-head">
            <div>
                <h1>Übersicht</h1>
                <p class="muted">Alle Bots auf einen Blick – jeder Bot läuft isoliert für seinen eigenen Server.</p>
            </div>
            ${bots.length ? `<div class="actions">
                <button class="btn" data-action="start-all">${icon('play')}Alle starten</button>
                <button class="btn" data-action="stop-all">${icon('stop')}Alle stoppen</button>
            </div>` : ''}
        </div>
        <div class="stats">
            ${statCard('Bots gesamt', 'bot', bots.length, `${bots.filter(b => b.hasToken).length} mit Token`)}
            ${statCard('Online', 'activity', online, bots.length ? `${Math.round(online / bots.length * 100)}% aktiv` : 'Keine Bots', bots.length ? online / bots.length * 100 : 0)}
            ${statCard('Probleme', 'alert', errors, errors ? 'Bitte Konsole prüfen' : 'Alles in Ordnung')}
            ${statCard('RAM (Bots)', 'memory', formatBytes(ram), sys ? `System: ${formatBytes(memUsed)} / ${formatBytes(sys.totalMem)}` : '', sys ? memUsed / sys.totalMem * 100 : null)}
        </div>
        <div class="section-title"><h2>Deine Bots</h2></div>
        ${bots.length ? `<div class="bot-grid">${bots.map(botCard).join('')}</div>` : `
            <div class="card empty">
                <span class="stat-icon">${icon('bot')}</span>
                <h3>Noch keine Bots</h3>
                <p>Lege deinen ersten Bot an. Du brauchst nur den Bot-Token aus dem Discord Developer Portal und die ID deines Servers.</p>
                <button class="btn btn-primary" data-action="new-bot">${icon('plus')}Ersten Bot anlegen</button>
            </div>`}
        ${sys ? `
        <div class="section-title" style="margin-top:28px"><h2>System</h2></div>
        <div class="card card-pad">
            <dl class="meta" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
                <div><dt>Host</dt><dd>${esc(sys.hostname)}</dd></div>
                <div><dt>Node.js</dt><dd>${esc(sys.node)}</dd></div>
                <div><dt>CPU-Kerne</dt><dd>${esc(sys.cpus)}</dd></div>
                <div><dt>Last (1m)</dt><dd>${sys.load[0].toFixed(2)}</dd></div>
                <div><dt>System-Uptime</dt><dd>${formatDuration(sys.uptime)}</dd></div>
            </dl>
        </div>` : ''}`;
}

/* ---------- Bot detail ---------- */

function renderBot() {
    if (!state.detail) return;
    const id = state.detail.id;
    const tabs = [['console', 'terminal', 'Konsole'], ['modules', 'puzzle', 'Module'], ['content', 'pencil', 'Inhalte'], ['emojis', 'sparkle', 'Emojis'], ['settings', 'settings', 'Einstellungen']];
    $('#view').innerHTML = `
        <div id="bot-head"></div>
        <div class="tabs">
            ${tabs.map(([key, ic, label]) => `<a class="tab${state.tab === key ? ' active' : ''}" href="#/bot/${id}/${key}">${icon(ic)}${label}</a>`).join('')}
        </div>
        <div id="tab-content"></div>`;
    renderBotHead();
    if (state.tab === 'modules') renderModules();
    else if (state.tab === 'settings') renderSettings();
    else if (state.tab === 'content') renderContent();
    else if (state.tab === 'emojis') renderEmojiPage();
    else renderConsole();
}

/* ---------- Content (module texts & settings) ---------- */

function moduleLabel(name) {
    if (name === '_core') return 'Allgemeine Bot-Texte';
    const m = state.meta.modules.find(x => x.name === name);
    return m ? m.humanName : name;
}

function renderContent() {
    const d = state.detail;
    const bot = state.bots.get(d.id) || d;
    if (state.route.module) {
        openContentEditor({
            container: $('#tab-content'),
            botId: d.id,
            botName: d.name,
            moduleName: state.route.module,
            moduleLabel: moduleLabel(state.route.module),
            running: bot.status === 'running',
            api,
            toast,
            esc
        }).catch(e => toast(e.message, true));
        return;
    }
    const enabled = state.meta.modules.filter(m => d.modules[m.name]);
    function card(name, title, desc, iconName) {
        return `
        <a class="card module content-card" href="#/bot/${d.id}/content/${esc(name)}">
            <span class="stat-icon">${icon(iconName)}</span>
            <div class="module-body"><strong>${esc(title)}</strong><p>${esc(desc)}</p></div>
            ${icon('chevron')}
        </a>`;
    }
    $('#tab-content').innerHTML = `
        <p class="muted" style="margin-top:0">Bearbeite Texte, Embeds, Kanäle, Rollen und alle weiteren Einstellungen deiner aktiven Module. Gespeicherte Änderungen übernimmt der Bot sofort.</p>
        <div class="module-grid">
            ${card('_core', 'Allgemeine Bot-Texte', 'Embed-Footer, Systemnachrichten und Texte, die alle Module nutzen', 'chat')}
            ${enabled.map(m => card(m.name, m.humanName, m.description, 'pencil')).join('')}
        </div>
        ${enabled.length ? '' : `<div class="card empty" style="margin-top:16px"><h3>Keine aktiven Module</h3><p>Aktiviere zuerst Module im Tab „Module“.</p><a class="btn btn-primary" href="#/bot/${d.id}/modules">${icon('puzzle')}Zu den Modulen</a></div>`}`;
}

function renderEmojiPage() {
    const d = state.detail;
    const bot = state.bots.get(d.id) || d;
    renderEmojiTab($('#tab-content'), {botId: d.id, api, toast, running: bot.status === 'running'})
        .catch(e => toast(e.message, true));
}

function renderBotHead() {
    const head = $('#bot-head');
    if (!head || !state.detail) return;
    const b = state.bots.get(state.detail.id) || state.detail;
    const active = isActive(b);
    head.innerHTML = `
        <div class="bot-head">
            <span class="avatar avatar-lg">${initials(b.name)}</span>
            <div class="bot-head-info">
                <h1>${esc(b.name)} ${statusBadge(b.status)}</h1>
                <div class="sub">
                    <span>${icon('server')}<span class="mono">${esc(b.guildID || '–')}</span></span>
                    <span>${icon('clock')}${uptimeOf(b)}</span>
                    <span>${icon('memory')}${formatBytes(b.memory)}</span>
                    <span>${icon('puzzle')}${b.enabledModules} Module</span>
                    ${b.pid ? `<span>${icon('cpu')}PID ${b.pid}</span>` : ''}
                </div>
            </div>
            <div class="actions">
                ${active
                    ? `<button class="btn" data-bot-action="restart" data-id="${b.id}">${icon('restart')}Neustart</button>
                       <button class="btn" data-bot-action="stop" data-id="${b.id}">${icon('stop')}Stop</button>`
                    : `<button class="btn btn-primary" data-bot-action="start" data-id="${b.id}" ${b.hasToken ? '' : 'disabled'}>${icon('play')}Starten</button>`}
            </div>
        </div>
        ${b.statusReason ? `<div class="reason" style="margin-bottom:16px">${icon('alert')}<span>${esc(b.statusReason)}</span></div>` : ''}
        ${b.hasToken ? '' : `<div class="reason" style="margin-bottom:16px">${icon('key')}<span>Kein Token hinterlegt. Trage ihn unter „Einstellungen“ ein, um den Bot zu starten.</span></div>`}`;
}

function renderConsole() {
    $('#tab-content').innerHTML = `
        <div class="card console">
            <div class="card-head">
                <h3>${icon('terminal')}Live-Konsole</h3>
                <div class="console-toolbar">
                    <button class="icon-btn icon-btn-sm" data-action="scroll-bottom" title="Nach unten">${icon('arrowDown')}</button>
                    <button class="icon-btn icon-btn-sm" data-action="clear-log" title="Ansicht leeren">${icon('eraser')}</button>
                </div>
            </div>
            <div class="console-log" id="console-log"></div>
            <form class="console-input" id="console-form">
                <input id="console-cmd" placeholder="Befehl senden, z. B. reload, modules, help" autocomplete="off" spellcheck="false">
                <button class="btn btn-primary" type="submit">${icon('send')}<span class="hide-sm">Senden</span></button>
            </form>
        </div>`;
    const log = $('#console-log');
    log.addEventListener('scroll', () => {
        state.autoScroll = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    });
    renderLogs(true);
}

function logClass(entry) {
    if (entry.type === 'err' || (/^\[(?:ERROR|FATAL)\]/).test(entry.text)) return 'log-err';
    if ((/^\[WARN\]/).test(entry.text)) return 'log-warn';
    return `log-${entry.type}`;
}

function logLine(entry) {
    const time = new Date(entry.time).toLocaleTimeString('de-DE');
    return `<div class="log-line ${logClass(entry)}"><span class="log-time">${time}</span><span class="log-text">${esc(entry.text)}</span></div>`;
}

function renderLogs(scroll) {
    const log = $('#console-log');
    if (!log) return;
    log.innerHTML = state.logs.length ? state.logs.map(logLine).join('') : '<div class="muted">Noch keine Ausgabe. Starte den Bot, um Logs zu sehen.</div>';
    if (scroll) log.scrollTop = log.scrollHeight;
}

function appendLog(entry) {
    const log = $('#console-log');
    if (!log) return;
    if (log.firstElementChild && log.firstElementChild.classList.contains('muted')) log.innerHTML = '';
    log.insertAdjacentHTML('beforeend', logLine(entry));
    while (log.childElementCount > 1000) log.firstElementChild.remove();
    if (state.autoScroll) log.scrollTop = log.scrollHeight;
}

/* ---------- Modules ---------- */

function renderModules() {
    if (!state.meta) return;
    if (!state.moduleDraft) state.moduleDraft = {...state.detail.modules};
    const tags = [...new Set(state.meta.modules.flatMap(m => m.tags))].sort();
    const enabledCount = state.meta.modules.filter(m => state.moduleDraft[m.name]).length;
    $('#tab-content').innerHTML = `
        <div class="module-toolbar">
            <label class="search"><span class="i">${icon('search')}</span><input class="input" id="module-search" placeholder="Module durchsuchen…" value="${esc(state.moduleSearch)}"></label>
            <span class="badge">${enabledCount} / ${state.meta.modules.length} aktiv</span>
        </div>
        <div class="chips" style="margin-bottom:16px">
            ${['all', 'enabled', ...tags].map(t => `<button class="chip${state.moduleFilter === t ? ' active' : ''}" data-filter="${esc(t)}">${esc(CHIP_LABEL[t] || t)}</button>`).join('')}
        </div>
        <div class="module-grid" id="module-grid"></div>
        <div id="savebar"></div>`;
    renderModuleGrid();
}

function moduleVisible(m) {
    const q = state.moduleSearch.toLowerCase();
    if (q && !`${m.humanName} ${m.name} ${m.description}`.toLowerCase().includes(q)) return false;
    if (state.moduleFilter === 'enabled') return !!state.moduleDraft[m.name];
    if (state.moduleFilter !== 'all') return m.tags.includes(state.moduleFilter);
    return true;
}

function renderModuleGrid() {
    const visible = state.meta.modules.filter(moduleVisible);
    $('#module-grid').innerHTML = visible.length ? visible.map(m => `
        <label class="card module${state.moduleDraft[m.name] ? ' on' : ''}">
            <div class="module-body">
                <strong>${esc(m.humanName)}</strong>
                <p>${esc(m.description)}</p>
                <span class="tag">${esc(m.tags.join(' · ') || m.name)}${m.beta ? ' · Beta' : ''}</span>
            </div>
            <div class="module-side">
                <span class="switch"><input type="checkbox" data-module="${esc(m.name)}" ${state.moduleDraft[m.name] ? 'checked' : ''}><span class="track"></span></span>
                ${state.detail.modules[m.name] ? `<a class="icon-btn icon-btn-sm" href="#/bot/${state.detail.id}/content/${esc(m.name)}" title="Inhalte bearbeiten">${icon('pencil')}</a>` : ''}
            </div>
        </label>`).join('') : '<div class="muted">Keine Module gefunden.</div>';
    renderSavebar();
}

function renderSavebar() {
    const changed = state.meta.modules.filter(m => !!state.moduleDraft[m.name] !== !!state.detail.modules[m.name]).length;
    const bar = $('#savebar');
    if (!bar) return;
    bar.innerHTML = changed ? `
        <div class="savebar">
            <span><strong>${changed}</strong> ungespeicherte Änderung${changed === 1 ? '' : 'en'}</span>
            <div class="actions">
                <button class="btn btn-ghost" data-action="modules-reset">Verwerfen</button>
                <button class="btn" data-action="modules-save">${icon('save')}Speichern</button>
            </div>
        </div>` : '';
}

/* ---------- Settings ---------- */

function configField(field, value) {
    const id = `cfg-${field.name}`;
    const label = `<span>${esc(field.humanName)}</span>`;
    const help = field.description ? `<small>${esc(field.description)}</small>` : '';
    if (field.type === 'boolean') {
        return `<div class="toggle-row full"><div><strong>${esc(field.humanName)}</strong>${help}</div>
            <span class="switch"><input type="checkbox" id="${id}" data-config="${esc(field.name)}" data-type="boolean" ${value ? 'checked' : ''}><span class="track"></span></span></div>`;
    }
    if (field.type === 'select' && Array.isArray(field.content)) {
        return `<label class="field">${label}<select id="${id}" data-config="${esc(field.name)}">
            ${field.content.map(o => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${help}</label>`;
    }
    if (field.type === 'array') {
        return `<label class="field full">${label}<input id="${id}" data-config="${esc(field.name)}" data-type="array" value="${esc((value || []).join(', '))}" placeholder="Kommagetrennt">${help}</label>`;
    }
    if (field.secret) {
        return `<label class="field full">${label}<input type="password" id="${id}" data-config="${esc(field.name)}" placeholder="${state.detail.hasToken ? '•••••••• (gespeichert – leer lassen zum Beibehalten)' : 'Bot-Token einfügen'}" autocomplete="off">${help}</label>`;
    }
    return `<label class="field">${label}<input id="${id}" data-config="${esc(field.name)}" value="${esc(value)}">${help}</label>`;
}

const FIRST_FIELDS = ['token', 'guildID', 'prefix', 'logChannelID', 'timezone', 'user_presence'];

function fieldRank(field) {
    if (FIRST_FIELDS.includes(field.name)) return FIRST_FIELDS.indexOf(field.name);
    return field.type === 'boolean' ? 200 : 100;
}

function renderSettings() {
    if (!state.meta) return;
    const d = state.detail;
    const schema = state.meta.schema;
    const ordered = [...schema].sort((a, b) => fieldRank(a) - fieldRank(b));
    $('#tab-content').innerHTML = `
        <div class="settings-layout">
            <form class="card" id="config-form">
                <div class="card-head"><h3>${icon('bot')}Bot-Konfiguration</h3></div>
                <div class="card-pad"><div class="form-grid">${ordered.map(f => configField(f, d.config[f.name])).join('')}</div>
                    <div class="form-foot"><button class="btn btn-primary" type="submit">${icon('save')}Speichern</button></div>
                </div>
            </form>
            <div style="display:flex;flex-direction:column;gap:20px">
                <form class="card" id="dash-form">
                    <div class="card-head"><h3>${icon('settings')}Dashboard</h3></div>
                    <div class="card-pad">
                        <label class="field"><span>Anzeigename</span><input id="dash-name" value="${esc(d.name)}" maxlength="64" required></label>
                        <label class="field"><span>Sprache des Bots</span><select id="dash-language">
                            <option value="de" ${d.language === 'de' ? 'selected' : ''}>Deutsch</option>
                            <option value="en" ${d.language === 'en' ? 'selected' : ''}>English</option>
                        </select><small>Gilt nach einem Neustart. Neue Standardtexte werden in dieser Sprache erzeugt.</small></label>
                        <div>
                            <div class="toggle-row"><div><strong>Autostart</strong><small>Startet den Bot automatisch mit dem Dashboard.</small></div>
                                <span class="switch"><input type="checkbox" id="dash-autostart" ${d.autoStart ? 'checked' : ''}><span class="track"></span></span></div>
                            <div class="toggle-row"><div><strong>Automatischer Neustart</strong><small>Startet den Bot nach einem Absturz neu (nicht bei Token-/Konfigfehlern).</small></div>
                                <span class="switch"><input type="checkbox" id="dash-autorestart" ${d.autoRestart ? 'checked' : ''}><span class="track"></span></span></div>
                        </div>
                        <div class="form-foot"><button class="btn btn-primary" type="submit">${icon('save')}Speichern</button></div>
                    </div>
                </form>
                <div class="card danger">
                    <div class="card-head"><h3>${icon('alert')}Gefahrenzone</h3></div>
                    <div class="card-pad">
                        <p class="muted" style="margin:0">Löscht den Bot inklusive Konfiguration und Datenbank. Das kann nicht rückgängig gemacht werden.</p>
                        <div><button class="btn btn-danger" data-action="delete-bot">${icon('trash')}Bot löschen</button></div>
                    </div>
                </div>
            </div>
        </div>`;
}

/* ---------- Modals ---------- */

function openModal(html, small) {
    const card = $('#modal-card');
    card.className = `modal-card${small ? ' sm' : ''}`;
    card.innerHTML = html;
    $('#modal').classList.remove('hidden');
    const first = card.querySelector('input, button.btn-primary');
    if (first) first.focus();
}

function closeModal() {
    $('#modal').classList.add('hidden');
    $('#modal-card').innerHTML = '';
}

function confirmDialog(title, text, confirmLabel) {
    return new Promise((resolve) => {
        openModal(`
            <div class="modal-head"><h3>${esc(title)}</h3></div>
            <div class="modal-body"><p>${esc(text)}</p></div>
            <div class="modal-foot">
                <button class="btn" id="confirm-no">Abbrechen</button>
                <button class="btn btn-danger" id="confirm-yes">${icon('trash')}${esc(confirmLabel)}</button>
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

function openCreateModal() {
    openModal(`
        <form id="create-form">
            <div class="modal-head"><h3>Neuen Bot anlegen</h3><button type="button" class="icon-btn icon-btn-sm" data-action="close-modal">${icon('x')}</button></div>
            <div class="modal-body">
                <div class="form-grid">
                    <label class="field full"><span>Name</span><input name="name" maxlength="64" required placeholder="z. B. Community-Bot"></label>
                    <label class="field full"><span>Bot-Token</span><input name="token" type="password" autocomplete="off" placeholder="Aus dem Discord Developer Portal">
                        <small>Wird nur lokal in der Konfiguration des Bots gespeichert.</small></label>
                    <label class="field"><span>Server-ID (Guild ID)</span><input name="guildID" inputmode="numeric" pattern="\\d{15,22}" placeholder="123456789012345678"></label>
                    <label class="field"><span>Log-Kanal-ID</span><input name="logChannelID" inputmode="numeric" placeholder="optional"></label>
                    <label class="field"><span>Prefix</span><input name="prefix" value="!" maxlength="5"></label>
                    <label class="field"><span>Zeitzone</span><input name="timezone" value="Europe/Berlin"></label>
                    <label class="field"><span>Sprache</span><select name="language"><option value="de" selected>Deutsch</option><option value="en">English</option></select></label>
                </div>
                <div>
                    <div class="toggle-row"><div><strong>Autostart</strong><small>Mit dem Dashboard automatisch starten</small></div>
                        <span class="switch"><input type="checkbox" name="autoStart" checked><span class="track"></span></span></div>
                </div>
                <p class="form-error" id="create-error"></p>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn" data-action="close-modal">Abbrechen</button>
                <button type="submit" class="btn btn-primary">${icon('plus')}Bot anlegen</button>
            </div>
        </form>`);
    $('#create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const body = Object.fromEntries(form.entries());
        body.autoStart = form.has('autoStart');
        try {
            const created = await api('POST', '/api/bots', body);
            closeModal();
            toast(created.hasToken ? 'Bot angelegt und gestartet' : 'Bot angelegt');
            location.hash = `#/bot/${created.id}/${created.hasToken ? 'console' : 'settings'}`;
        } catch (err) {
            $('#create-error').textContent = err.message;
        }
    });
}

/* ---------- Actions ---------- */

async function botAction(action, id) {
    const labels = {start: 'Bot wird gestartet', stop: 'Bot gestoppt', restart: 'Bot wird neu gestartet'};
    await run(() => api('POST', `/api/bots/${id}/${action}`), labels[action]);
}

async function saveModules() {
    const detail = await run(() => api('PUT', `/api/bots/${state.detail.id}/modules`, state.moduleDraft), 'Module gespeichert');
    if (!detail) return;
    state.detail = detail;
    state.moduleDraft = {...detail.modules};
    if (detail.status !== 'running') toast('Änderungen werden beim nächsten Start übernommen');
    renderModules();
}

async function saveConfig() {
    const body = {};
    for (const el of document.querySelectorAll('[data-config]')) {
        const name = el.getAttribute('data-config');
        const type = el.getAttribute('data-type');
        if (type === 'boolean') body[name] = el.checked;
        else if (type === 'array') body[name] = el.value.split(',').map(s => s.trim()).filter(Boolean);
        else body[name] = el.value;
    }
    const detail = await run(() => api('PUT', `/api/bots/${state.detail.id}/config`, body), 'Konfiguration gespeichert');
    if (detail) {
        state.detail = detail;
        renderSettings();
    }
}

async function saveDashSettings() {
    const detail = await run(() => api('PUT', `/api/bots/${state.detail.id}/settings`, {
        name: $('#dash-name').value,
        autoStart: $('#dash-autostart').checked,
        autoRestart: $('#dash-autorestart').checked,
        language: $('#dash-language').value
    }), 'Gespeichert');
    if (detail) state.detail = detail;
}

async function deleteBot() {
    const ok = await confirmDialog('Bot löschen?', `„${state.detail.name}“ wird gestoppt und mit allen Daten entfernt.`, 'Endgültig löschen');
    if (!ok) return;
    const res = await run(() => api('DELETE', `/api/bots/${state.detail.id}`), 'Bot gelöscht');
    if (res) location.hash = '#/';
}

const ACTIONS = {
    'new-bot': openCreateModal,
    'close-modal': closeModal,
    'start-all': () => run(() => api('POST', '/api/bots/start-all'), 'Alle Bots werden gestartet'),
    'stop-all': () => run(() => api('POST', '/api/bots/stop-all'), 'Alle Bots gestoppt'),
    'scroll-bottom': () => {
        const log = $('#console-log');
        state.autoScroll = true;
        log.scrollTop = log.scrollHeight;
    },
    'clear-log': () => {
        state.logs = [];
        renderLogs();
    },
    'modules-save': saveModules,
    'modules-reset': () => {
        state.moduleDraft = {...state.detail.modules};
        renderModules();
    },
    'delete-bot': deleteBot
};

function bindEvents() {
    document.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]');
        if (action && ACTIONS[action.getAttribute('data-action')]) {
            e.preventDefault();
            ACTIONS[action.getAttribute('data-action')]();
            return;
        }
        const botBtn = e.target.closest('[data-bot-action]');
        if (botBtn) {
            botBtn.disabled = true;
            botAction(botBtn.getAttribute('data-bot-action'), botBtn.getAttribute('data-id'));
            return;
        }
        const chip = e.target.closest('[data-filter]');
        if (chip) {
            state.moduleFilter = chip.getAttribute('data-filter');
            renderModules();
        }
    });
    document.addEventListener('change', (e) => {
        if (e.target.matches('[data-module]')) {
            state.moduleDraft[e.target.getAttribute('data-module')] = e.target.checked;
            e.target.closest('.module').classList.toggle('on', e.target.checked);
            renderSavebar();
        }
    });
    document.addEventListener('input', (e) => {
        if (e.target.id === 'module-search') {
            state.moduleSearch = e.target.value;
            renderModuleGrid();
        }
    });
    document.addEventListener('submit', (e) => {
        if (e.target.id === 'console-form') {
            e.preventDefault();
            const input = $('#console-cmd');
            if (!input.value.trim()) return;
            run(() => api('POST', `/api/bots/${state.detail.id}/command`, {command: input.value}));
            input.value = '';
        } else if (e.target.id === 'config-form') {
            e.preventDefault();
            saveConfig();
        } else if (e.target.id === 'dash-form') {
            e.preventDefault();
            saveDashSettings();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
    });
    $('#modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
    });
    $('#open-sidebar').onclick = openSidebar;
    $('#close-sidebar').onclick = closeSidebar;
    $('#backdrop').onclick = closeSidebar;
    $('#logout').onclick = async () => {
        await run(() => api('POST', '/api/logout'));
        showLogin();
    };
    window.addEventListener('hashchange', onRoute);
    setInterval(() => {
        if (state.route.name === 'overview' && $('#modal').classList.contains('hidden') && !document.hidden) {
            api('GET', '/api/overview').then((o) => {
                state.system = o.system;
                state.bots = new Map(o.bots.map(b => [b.id, b]));
                renderOverview();
                renderNav();
            }).catch(() => null);
        } else if (state.route.name === 'bot') {
            renderBotHead();
        }
    }, 10000);
}

/* ---------- Auth & boot ---------- */

function showLogin() {
    if (state.stream) state.stream.close();
    state.stream = null;
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#login-password').focus();
}

async function showApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    state.meta = await run(() => api('GET', '/api/meta'));
    await onRoute();
}

$('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
        await api('POST', '/api/login', {password: $('#login-password').value});
        $('#login-password').value = '';
        showApp();
    } catch (err) {
        $('#login-error').textContent = err.message;
    }
});

hydrateIcons(document);
bindEvents();
api('GET', '/api/session').then(s => (s.authenticated ? showApp() : showLogin())).catch(showLogin);
