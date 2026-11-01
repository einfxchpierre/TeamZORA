/* global icon, Z, openContentEditor, renderEmojiTab */
/*
 * Pages inside a server: dashboard, problems, configuration, modules, commands, emojis, console,
 * bot profile, team and settings.
 */
(function () {
    const {$, esc} = Z;

    const MODULE_ICONS = {
        'admin-tools': 'wrench', 'afk-system': 'moon', 'anti-ghostping': 'bell', 'auto-delete': 'trash', 'auto-messager': 'chat',
        'auto-publisher': 'megaphone', 'auto-thread': 'chat', 'betterstatus': 'user', 'channel-stats': 'chart', 'color-me': 'palette',
        'connect-four': 'grid', 'counter': 'hash', 'duel': 'sword', 'economy-system': 'coin', 'fun': 'smile', 'guess-the-number': 'dice',
        'info-commands': 'info', 'levels': 'trophy', 'massrole': 'users', 'message-quotes': 'quote', 'moderation': 'hammer',
        'nicknames': 'pencil', 'ping-on-vc-join': 'volume', 'ping-protection': 'shield', 'polls': 'chart', 'quiz': 'question',
        'reaction-roles': 'smile', 'reminders': 'bell', 'rock-paper-scissors': 'scissors', 'staff-management-system': 'briefcase',
        'starboard': 'star', 'status-roles': 'tag', 'sticky-messages': 'pin', 'suggestions': 'bulb', 'team-list': 'users',
        'temp-channels': 'hourglass', 'tic-tak-toe': 'grid', 'tickets': 'ticket', 'twitch-notifications': 'play', 'uno': 'cards',
        'welcomer': 'door', '_core': 'chat'
    };
    const TAGS = {administration: 'Administration', bot: 'Bot', community: 'Community', fun: 'Spiel & Spaß', integrations: 'Integrationen', moderation: 'Moderation', support: 'Support', tools: 'Werkzeuge'};
    const TAG_ICONS = {administration: 'wrench', bot: 'bot', community: 'users', fun: 'dice', integrations: 'link', moderation: 'shield', support: 'chat', tools: 'briefcase'};

    function bot() {
        return Z.currentBot();
    }

    function base() {
        return `#/s/${Z.state.botId}`;
    }

    function moduleMeta(name) {
        if (name === '_core') return {name: '_core', humanName: 'Allgemeine Bot-Texte', description: 'Embed-Footer, Systemnachrichten und Texte, die alle Module nutzen.', tags: []};
        return Z.state.meta.modules.find(m => m.name === name) || {name, humanName: name, description: '', tags: []};
    }

    function pageHead(title, sub, actions) {
        return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
    }

    function controls(b) {
        if (Z.isActive(b)) {
            return `<button class="btn" data-bot="restart">${icon('restart')}Neustart</button><button class="btn" data-bot="stop">${icon('stop')}Stoppen</button>`;
        }
        return `<button class="btn btn-primary" data-bot="start" ${b.hasToken ? '' : 'disabled'}>${icon('play')}Starten</button>`;
    }

    async function botAction(action) {
        const labels = {start: 'Bot wird gestartet', stop: 'Bot gestoppt', restart: 'Bot wird neu gestartet'};
        await Z.run(() => Z.api('POST', `/api/bots/${Z.state.botId}/${action}`), labels[action]);
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-bot]');
        if (!btn || !Z.state.botId) return;
        btn.disabled = true;
        botAction(btn.getAttribute('data-bot'));
    });

    /* ---------- Dashboard ---------- */

    function chartSVG(points) {
        const values = points.filter(p => p[1] !== null);
        if (values.length < 2) return '<div class="chart-empty muted">Sobald der Bot eine Weile läuft, erscheint hier der Verlauf.</div>';
        const max = Math.max(...values.map(p => p[1])) * 1.15;
        const t0 = values[0][0];
        const t1 = values[values.length - 1][0];
        function x(t) {
            return ((t - t0) / Math.max(1, t1 - t0)) * 600;
        }
        function y(v) {
            return 150 - (v / max) * 140;
        }
        const line = values.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
        return `<svg class="chart" viewBox="0 0 600 160" preserveAspectRatio="none">
            <defs><linearGradient id="g-ram" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
            <path d="${line} L600,160 L0,160 Z" fill="url(#g-ram)"/><path d="${line}" fill="none" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>
        </svg><div class="chart-legend"><span>Max. ${Z.formatBytes(Math.max(...values.map(p => p[1])))}</span><span>Aktuell ${Z.formatBytes(values[values.length - 1][1])}</span></div>`;
    }

    function banner() {
        const g = Z.state.guild;
        const b = bot();
        return `<div class="guild-banner"${g && (g.banner || g.icon) ? ` style="--banner:url('${esc(g.banner || g.icon)}')"` : ''}>
            <div class="guild-banner-inner">
                ${Z.avatar(g && g.icon, (g && g.name) || b.name, 'av av-xl')}
                <div>
                    <h1>${esc((g && g.name) || b.name)}</h1>
                    <div class="guild-stats">
                        ${g && g.online !== null && typeof g.online !== 'undefined' ? `<span><span class="dot status-running"></span>${g.online} online</span>` : ''}
                        ${g && g.members ? `<span><span class="dot"></span>${g.members} Mitglieder</span>` : ''}
                        ${g && g.boosts ? `<span>${icon('sparkle')}${g.boosts} Boosts</span>` : ''}
                        ${g ? '' : '<span class="muted">Serverdaten erscheinen, sobald der Bot auf dem Server ist.</span>'}
                    </div>
                </div>
            </div>
        </div>`;
    }

    Z.pages['bot.home'] = async ({id, el}) => {
        const [history, profile] = await Promise.all([
            Z.api('GET', `/api/bots/${id}/history`).catch(() => []),
            Z.api('GET', `/api/bots/${id}/profile`).catch(() => ({}))
        ]);
        Z.state.profile = profile;
        function render() {
            const b = bot();
            const problems = (b.problemCount || 0) + (b.warningCount || 0);
            const invite = profile && profile.id && !Z.state.guild && b.guildID
                ? `https://discord.com/oauth2/authorize?client_id=${profile.id}&scope=bot%20applications.commands&permissions=8&guild_id=${b.guildID}&disable_guild_select=true` : null;
            el.innerHTML = `
                ${banner()}
                ${invite ? `<div class="callout">${icon('link')}<div class="grow"><strong>Der Bot ist noch nicht auf deinem Server.</strong><p class="muted">Lade ihn mit einem Klick ein – danach erscheinen hier Kanäle, Rollen und Statistiken.</p></div><a class="btn btn-primary" href="${invite}" target="_blank" rel="noopener">${icon('plus')}Bot einladen</a></div>` : ''}
                <div class="grid-dash">
                    <div class="card status-card">
                        <div class="card-head"><h3>${icon('activity')}Status</h3>${Z.statusBadge(b.status)}</div>
                        <div class="card-pad">
                            ${b.statusReason ? `<div class="reason">${icon('alert')}<span>${esc(b.statusReason)}</span></div>` : ''}
                            ${b.hasToken ? '' : `<div class="reason">${icon('key')}<span>Kein Token hinterlegt. <a href="${base()}/config"><u>Jetzt einrichten</u></a></span></div>`}
                            <div class="kv-list">
                                <div>${icon('bot')}<span>Bot</span><strong>${esc((profile && profile.username) || b.name)}</strong></div>
                                <div>${icon('clock')}<span>Uptime</span><strong>${Z.uptimeOf(b)}</strong></div>
                                <div>${icon('memory')}<span>RAM</span><strong>${Z.formatBytes(b.memory)}</strong></div>
                                <div>${icon('puzzle')}<span>Module</span><strong>${b.enabledModules} aktiv</strong></div>
                                <div>${icon('chat')}<span>Sprache</span><strong>${b.language === 'en' ? 'English' : 'Deutsch'}</strong></div>
                                <div>${icon('package')}<span>Version</span><strong>v${esc(Z.state.meta.version || '')}</strong></div>
                            </div>
                            <div class="actions">${controls(b)}</div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-head"><h3>${icon('alert')}Probleme</h3></div>
                        <div class="card-pad problems-mini">
                            ${problems ? `<div class="big-number ${b.problemCount ? 'text-err' : 'text-warn'}">${problems}</div><p class="muted">${b.problemCount || 0} Fehler, ${b.warningCount || 0} Warnungen</p>`
        : '<img class="zemoji-xl" src="/emojis/z_check_green.png" alt=""><p><strong>Alles in Ordnung</strong></p><p class="muted">Keine Probleme gefunden.</p>'}
                            <a class="btn" href="${base()}/problems">Zu den Problemen${icon('chevron')}</a>
                        </div>
                    </div>
                    <div class="card quick">
                        <div class="card-head"><h3>${icon('sparkle')}Häufige Aktionen</h3></div>
                        <div class="quick-list">
                            ${[['modules', 'puzzle', 'Module verwalten', 'Module aktivieren und einstellen'],
        ['config', 'settings', 'Konfiguration bearbeiten', 'Token, Server, Log-Kanal und mehr'],
        ['modules/_core', 'chat', 'Bot-Texte anpassen', 'Footer und Systemnachrichten'],
        ['profile', 'bot', 'Bot-Profil anpassen', 'Name und Profilbild des Bots'],
        ['emojis', 'sparkle', 'Emojis', 'Eigenes Emoji-Set verwalten'],
        ['console', 'terminal', 'Konsole', 'Live-Logs und Befehle']].map(([href, ic, title, sub]) => `<a href="${base()}/${href}"><span class="quick-icon">${icon(ic)}</span><div><strong>${title}</strong><small>${sub}</small></div>${icon('chevron')}</a>`).join('')}
                        </div>
                    </div>
                    <div class="card chart-card">
                        <div class="card-head"><h3>${icon('memory')}Ressourcen</h3><span class="muted small">RAM, letzte 24 Stunden</span></div>
                        <div class="card-pad">${chartSVG(history)}</div>
                    </div>
                </div>`;
        }
        render();
        Z.hooks.bot = render;
        Z.hooks.guild = render;
        Z.hooks.tick = async () => {
            const fresh = await Z.api('GET', `/api/bots/${id}/history`).catch(() => null);
            if (fresh) history.splice(0, history.length, ...fresh);
            render();
        };
    };

    /* ---------- Problems ---------- */

    Z.pages['bot.problems'] = async ({id, el}) => {
        async function render() {
            const list = await Z.api('GET', `/api/bots/${id}/problems`).catch(() => []);
            const target = {settings: 'config', config: 'config', console: 'console', emojis: 'emojis'};
            el.innerHTML = `${pageHead('Probleme', 'Fehler und Warnungen seit dem letzten Start des Bots.', `<button class="btn" id="reload-problems">${icon('refresh')}Aktualisieren</button>`)}
                ${list.length ? `<div class="problem-list">${list.map(p => `<div class="card problem ${p.level}">
                    <span class="problem-icon">${icon(p.level === 'error' ? 'alert' : 'info')}</span>
                    <div class="grow"><strong>${esc(p.title)}</strong><p>${esc(p.text)}</p>${p.time ? `<small class="muted">${new Date(p.time).toLocaleString('de-DE')}</small>` : ''}</div>
                    ${p.action ? `<a class="btn btn-sm" href="${base()}/${target[p.action] || p.action}">Beheben${icon('chevron')}</a>` : ''}
                </div>`).join('')}</div>`
        : `<div class="card empty"><img class="zemoji-xl" src="/emojis/z_party_green.png" alt=""><h3>Keine Probleme</h3><p>Dein Bot läuft rund. Weiter so!</p></div>`}`;
            $('#reload-problems').onclick = render;
        }
        await render();
        Z.hooks.bot = null;
    };

    /* ---------- Configuration ---------- */

    const FIRST_FIELDS = ['token', 'guildID', 'prefix', 'logChannelID', 'timezone', 'user_presence'];

    function coreField(field, value) {
        const help = field.description ? `<small>${esc(field.description)}</small>` : '';
        const name = esc(field.name);
        const gd = Z.state.guildData;
        if (field.type === 'boolean') {
            return `<div class="toggle-row full"><div><strong>${esc(field.humanName)}</strong>${help}</div><span class="switch"><input type="checkbox" data-config="${name}" data-type="boolean" ${value ? 'checked' : ''}><span class="track"></span></span></div>`;
        }
        let control;
        if (field.secret) {
            control = `<input type="password" data-config="${name}" autocomplete="off" placeholder="${bot().hasToken ? '•••••••• gespeichert – leer lassen zum Beibehalten' : 'Bot-Token einfügen'}">`;
        } else if (field.type === 'select' && Array.isArray(field.content)) {
            control = `<select data-config="${name}">${field.content.map(o => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        } else if (field.type === 'channelID' && gd) {
            control = `<select data-config="${name}"><option value="">— kein Kanal —</option>${gd.channels.filter(c => [0, 5].includes(c.type)).map(c => `<option value="${c.id}" ${c.id === value ? 'selected' : ''}># ${esc(c.name)}</option>`).join('')}</select>`;
        } else if (field.type === 'array') {
            control = `<input data-config="${name}" data-type="array" value="${esc((value || []).join(', '))}" placeholder="Kommagetrennt">`;
        } else {
            control = `<input data-config="${name}" value="${esc(value === null ? '' : value)}"${field.type === 'timezone' ? ' list="tz-core"' : ''}>`;
        }
        return `<label class="field${field.secret || field.type === 'array' ? ' full' : ''}"><span>${esc(field.humanName)}</span>${control}${help}</label>`;
    }

    Z.pages['bot.config'] = async ({id, el}) => {
        const d = await Z.api('GET', `/api/bots/${id}`);
        function rank(f) {
            if (FIRST_FIELDS.includes(f.name)) return FIRST_FIELDS.indexOf(f.name);
            return f.type === 'boolean' ? 200 : 100;
        }
        const schema = [...Z.state.meta.schema].sort((a, b) => rank(a) - rank(b));
        function render() {
            el.innerHTML = `${pageHead('Konfiguration', 'Grundeinstellungen deines Bots.')}
                <div class="grid-config">
                    <form class="card" id="core-form">
                        <div class="card-head"><h3>${icon('settings')}Bot-Konfiguration</h3></div>
                        <div class="card-pad"><div class="form-grid">${schema.map(f => coreField(f, d.config[f.name])).join('')}</div>
                            <div class="form-foot"><button class="btn btn-primary" type="submit">${icon('save')}Speichern</button></div></div>
                    </form>
                    <div class="stack">
                        <a class="card link-card" href="${base()}/modules/_core"><span class="quick-icon">${icon('chat')}</span><div><strong>Allgemeine Bot-Texte</strong><small>Embed-Footer, Systemnachrichten, Hilfe-Texte</small></div>${icon('chevron')}</a>
                        <a class="card link-card" href="${base()}/modules"><span class="quick-icon">${icon('puzzle')}</span><div><strong>Module</strong><small>Funktionen aktivieren und einstellen</small></div>${icon('chevron')}</a>
                        <a class="card link-card" href="${base()}/profile"><span class="quick-icon">${icon('bot')}</span><div><strong>Bot-Profil</strong><small>Name und Profilbild</small></div>${icon('chevron')}</a>
                    </div>
                </div>
                <datalist id="tz-core">${(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map(t => `<option value="${t}">`).join('')}</datalist>`;
            $('#core-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const body = {};
                for (const input of el.querySelectorAll('[data-config]')) {
                    const type = input.getAttribute('data-type');
                    if (type === 'boolean') body[input.getAttribute('data-config')] = input.checked;
                    else if (type === 'array') body[input.getAttribute('data-config')] = input.value.split(',').map(s => s.trim()).filter(Boolean);
                    else body[input.getAttribute('data-config')] = input.value;
                }
                const saved = await Z.run(() => Z.api('PUT', `/api/bots/${id}/config`, body), 'Konfiguration gespeichert');
                if (!saved) return;
                Object.assign(d, saved);
                Z.state.bots.set(id, {...bot(), ...saved});
                if (Z.isActive(bot()) && await Z.confirmDialog('Jetzt neu starten?', 'Token, Server und Intents werden erst nach einem Neustart übernommen.', 'Neu starten', false)) botAction('restart');
                render();
            });
        }
        render();
        Z.hooks.guild = render;
    };

    /* ---------- Modules ---------- */

    const modState = {search: '', onlyActive: false, tag: 'all'};

    function moduleCard(m, active) {
        return `<div class="card mod-card${active ? ' on' : ''}">
            <div class="mod-head">
                <span class="mod-icon">${icon(MODULE_ICONS[m.name] || 'puzzle')}</span>
                <div><strong>${esc(m.humanName)}</strong><span class="mod-author">${icon('bot')}TeamZORA</span></div>
            </div>
            <p class="mod-desc">${esc(m.description)}</p>
            <div class="mod-tags">${m.tags.map(t => `<span class="tag-pill">${icon(TAG_ICONS[t] || 'tag')}${esc(TAGS[t] || t)}</span>`).join('')}${m.beta ? '<span class="tag-pill beta">Beta</span>' : ''}</div>
            <div class="mod-foot">
                <label class="inline-check">Aktiviert? <span class="switch"><input type="checkbox" data-toggle-module="${esc(m.name)}" ${active ? 'checked' : ''}><span class="track"></span></span></label>
                ${active ? `<a class="btn btn-sm btn-primary" href="${base()}/modules/${esc(m.name)}">Konfiguration öffnen${icon('chevron')}</a>` : ''}
            </div>
        </div>`;
    }

    Z.pages['bot.modules'] = async (ctx) => {
        if (ctx.parts[3]) return ctx.parts[4] ? moduleEditor(ctx) : moduleDetail(ctx);
        const {id, el} = ctx;
        const d = await Z.api('GET', `/api/bots/${id}`);
        const tags = [...new Set(Z.state.meta.modules.flatMap(m => m.tags))].sort();
        function grid() {
            const q = modState.search.toLowerCase();
            const list = Z.state.meta.modules.filter(m => (!q || `${m.humanName} ${m.description} ${m.name}`.toLowerCase().includes(q)) &&
                (!modState.onlyActive || d.modules[m.name]) && (modState.tag === 'all' || m.tags.includes(modState.tag)));
            $('#mod-grid').innerHTML = list.length ? list.map(m => moduleCard(m, !!d.modules[m.name])).join('') : '<p class="muted">Keine Module gefunden.</p>';
        }
        const active = Z.state.meta.modules.filter(m => d.modules[m.name]).length;
        el.innerHTML = `${pageHead('Module', `${active} von ${Z.state.meta.modules.length} Modulen aktiv`)}
            <div class="mod-toolbar">
                <label class="search"><span class="i">${icon('search')}</span><input class="input" id="mod-search" placeholder="Module durchsuchen…" value="${esc(modState.search)}"></label>
                <label class="inline-check">Nur aktivierte <span class="switch"><input type="checkbox" id="mod-active" ${modState.onlyActive ? 'checked' : ''}><span class="track"></span></span></label>
            </div>
            <div class="chips tag-chips">
                <button class="chip${modState.tag === 'all' ? ' active' : ''}" data-tag="all">Alle</button>
                ${tags.map(t => `<button class="chip${modState.tag === t ? ' active' : ''}" data-tag="${esc(t)}">${icon(TAG_ICONS[t] || 'tag')}${esc(TAGS[t] || t)}</button>`).join('')}
            </div>
            <div class="mod-grid" id="mod-grid"></div>`;
        grid();
        $('#mod-search').oninput = (e) => {
            modState.search = e.target.value;
            grid();
        };
        $('#mod-active').onchange = (e) => {
            modState.onlyActive = e.target.checked;
            grid();
        };
        el.onclick = (e) => {
            const chip = e.target.closest('[data-tag]');
            if (!chip) return;
            modState.tag = chip.getAttribute('data-tag');
            el.querySelectorAll('[data-tag]').forEach(c => c.classList.toggle('active', c === chip));
            grid();
        };
        el.onchange = async (e) => {
            const t = e.target.closest('[data-toggle-module]');
            if (!t) return;
            const name = t.getAttribute('data-toggle-module');
            const saved = await Z.run(() => Z.api('PUT', `/api/bots/${id}/modules`, {[name]: t.checked}), t.checked ? 'Modul aktiviert' : 'Modul deaktiviert');
            if (saved) Object.assign(d, saved);
            else t.checked = !t.checked;
            grid();
        };
    };

    async function moduleDetail({id, parts, el}) {
        const name = parts[3];
        const m = moduleMeta(name);
        const [d, content] = await Promise.all([Z.api('GET', `/api/bots/${id}`), Z.api('GET', `/api/bots/${id}/content/${name}`)]);
        const enabled = name === '_core' || d.modules[name];
        el.innerHTML = `
            <a class="btn btn-ghost btn-sm" href="${base()}/modules">${icon('back')}Alle Module</a>
            <div class="card mod-hero">
                <span class="mod-icon mod-icon-lg">${icon(MODULE_ICONS[name] || 'puzzle')}</span>
                <div class="grow"><h1>${esc(m.humanName)}</h1><p class="muted">${esc(m.description)}</p></div>
                ${name === '_core' ? '' : `<label class="inline-check">Aktiviert? <span class="switch"><input type="checkbox" id="mod-enabled" ${enabled ? 'checked' : ''}><span class="track"></span></span></label>`}
            </div>
            ${enabled ? '' : `<div class="callout">${icon('info')}<div class="grow"><strong>Dieses Modul ist deaktiviert.</strong><p class="muted">Du kannst es trotzdem schon einstellen – aktiv wird es erst nach dem Einschalten.</p></div></div>`}
            <h2 class="section-h">Konfigurationen</h2>
            <div class="file-grid">${content.files.map(f => `<a class="card file-card" href="${base()}/modules/${esc(name)}/${encodeURIComponent(f.filename)}">
                <span class="quick-icon">${icon(f.configElements ? 'clipboard' : 'settings')}</span>
                <div><strong>${esc(f.humanName)}</strong><small>${esc(f.description || '')}</small>
                ${f.configElements ? `<span class="tag-pill">${Array.isArray(f.value) ? f.value.length : 0} ${esc(f.elementName.more)}</span>` : ''}</div>
            </a>`).join('') || '<p class="muted">Dieses Modul hat keine Einstellungen.</p>'}</div>
            ${name === '_core' ? '' : `<details class="advanced"><summary>${icon('settings')}Erweiterte Optionen</summary>
                <div class="advanced-body"><button class="btn btn-danger" id="reset-module">${icon('trash')}Modul-Konfiguration zurücksetzen</button>
                <small class="muted">Löscht die gespeicherten Einstellungen dieses Moduls. Der Bot legt sie mit den Standardwerten (in der eingestellten Sprache) neu an.</small></div></details>`}`;
        const toggle = $('#mod-enabled');
        if (toggle) {
            toggle.onchange = async () => {
                const saved = await Z.run(() => Z.api('PUT', `/api/bots/${id}/modules`, {[name]: toggle.checked}), toggle.checked ? 'Modul aktiviert' : 'Modul deaktiviert');
                if (saved) Z.route();
            };
        }
        const reset = $('#reset-module');
        if (reset) {
            reset.onclick = async () => {
                if (!await Z.confirmDialog('Konfiguration zurücksetzen?', `Alle Einstellungen von „${m.humanName}“ werden auf die Standardwerte zurückgesetzt.`, 'Zurücksetzen')) return;
                if (await Z.run(() => Z.api('POST', `/api/bots/${id}/reset-module`, {module: name}), 'Konfiguration zurückgesetzt')) Z.route();
            };
        }
    }

    function moduleEditor({id, parts, el}) {
        const name = parts[3];
        const b = bot();
        return openContentEditor({
            container: el,
            botId: id,
            botName: (Z.state.profile && Z.state.profile.username) || b.name,
            moduleName: name,
            moduleLabel: moduleMeta(name).humanName,
            fileName: decodeURIComponent(parts[4]),
            backHref: `${base()}/modules/${name}`,
            guildData: Z.state.guildData,
            running: b.status === 'running',
            api: Z.api,
            toast: Z.toast,
            esc
        }).catch(e => Z.toast(e.message, true));
    }

    /* ---------- Commands ---------- */

    Z.pages['bot.commands'] = async ({id, el}) => {
        const list = await Z.api('GET', `/api/bots/${id}/commands`).catch(() => []);
        const groups = {};
        for (const c of list) (groups[c.module || '_core'] = groups[c.module || '_core'] || []).push(c);
        el.innerHTML = `${pageHead('Befehle', 'Alle Slash- und Kontextmenü-Befehle deines Bots.')}
            ${list.length ? Object.entries(groups).map(([mod, cmds]) => `<div class="card cmd-group">
                <div class="card-head"><h3><span class="mod-icon mod-icon-sm">${icon(MODULE_ICONS[mod] || 'puzzle')}</span>${esc(mod === '_core' ? 'Basis-Befehle' : moduleMeta(mod).humanName)}</h3><span class="muted small">${cmds.length}</span></div>
                <div class="cmd-list">${cmds.map(c => `<div class="cmd">
                    <code class="cmd-name">${c.contextMenu ? icon('pointer') : '/'}${esc(c.name)}</code>
                    <div class="grow"><p>${esc(c.description || (c.contextMenu ? 'Kontextmenü-Befehl (Rechtsklick)' : ''))}</p>
                    ${c.options.length ? `<div class="cmd-opts">${c.options.map(o => `<span class="opt${o.required ? ' req' : ''}" title="${esc(o.description)}">${esc(o.name)}</span>`).join('')}</div>` : ''}</div>
                </div>`).join('')}</div>
            </div>`).join('') : `<div class="card empty"><span class="stat-icon">${icon('terminalSlash')}</span><h3>Noch keine Befehle</h3><p>Die Liste erscheint, sobald der Bot einmal mit der aktuellen Version gestartet wurde.</p></div>`}`;
    };

    /* ---------- Emojis ---------- */

    Z.pages['bot.emojis'] = ({id, el}) => {
        el.innerHTML = `${pageHead('Emojis', 'Das TeamZORA-Emoji-Set für deinen Bot.')}<div id="emoji-host"></div>`;
        return renderEmojiTab($('#emoji-host'), {botId: id, api: Z.api, toast: Z.toast, running: bot().status === 'running'}).catch(e => Z.toast(e.message, true));
    };

    /* ---------- Console ---------- */

    function logClass(entry) {
        if (entry.type === 'err' || (/^\[(?:ERROR|FATAL)\]/).test(entry.text)) return 'log-err';
        if ((/^\[WARN\]/).test(entry.text)) return 'log-warn';
        return `log-${entry.type}`;
    }

    function logLine(entry) {
        return `<div class="log-line ${logClass(entry)}"><span class="log-time">${new Date(entry.time).toLocaleTimeString('de-DE')}</span><span class="log-text">${esc(entry.text)}</span></div>`;
    }

    Z.pages['bot.console'] = ({id, el}) => {
        let autoScroll = true;
        el.innerHTML = `${pageHead('Konsole', 'Live-Ausgabe des Bots. Befehle: <code>reload</code>, <code>modules</code>, <code>emojis</code>, <code>help</code>', controls(bot()))}
            <div class="card console">
                <div class="console-log" id="console-log"></div>
                <form class="console-input" id="console-form"><span class="prompt">›</span><input id="console-cmd" placeholder="Befehl eingeben…" autocomplete="off" spellcheck="false"><button class="btn btn-primary" type="submit">${icon('send')}<span class="hide-sm">Senden</span></button></form>
            </div>`;
        const log = $('#console-log');
        function renderAll() {
            log.innerHTML = Z.state.logs.length ? Z.state.logs.map(logLine).join('') : '<div class="muted">Noch keine Ausgabe. Starte den Bot, um Logs zu sehen.</div>';
            log.scrollTop = log.scrollHeight;
        }
        log.addEventListener('scroll', () => {
            autoScroll = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        });
        renderAll();
        Z.hooks.logs = renderAll;
        Z.hooks.log = (entry) => {
            if (log.firstElementChild && log.firstElementChild.classList.contains('muted')) log.innerHTML = '';
            log.insertAdjacentHTML('beforeend', logLine(entry));
            while (log.childElementCount > 1000) log.firstElementChild.remove();
            if (autoScroll) log.scrollTop = log.scrollHeight;
        };
        Z.hooks.bot = () => {
            const actions = el.querySelector('.page-head .actions');
            if (actions) actions.innerHTML = controls(bot());
        };
        $('#console-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const input = $('#console-cmd');
            if (!input.value.trim()) return;
            Z.run(() => Z.api('POST', `/api/bots/${id}/command`, {command: input.value}));
            input.value = '';
        });
    };

    /* ---------- Bot profile ---------- */

    Z.pages['bot.profile'] = async ({id, el}) => {
        const profile = await Z.api('GET', `/api/bots/${id}/profile`).catch(() => ({}));
        const b = bot();
        let avatarData = null;
        el.innerHTML = `${pageHead('Bot-Profil', 'So sehen die Mitglieder deinen Bot in Discord.')}
            ${profile.username ? `<form class="card profile-card" id="profile-form">
                <div class="profile-preview">
                    <label class="avatar-upload" title="Profilbild ändern">
                        <img id="avatar-img" src="${esc(profile.avatar)}" alt="">
                        <span class="avatar-overlay">${icon('upload')}</span>
                        <input type="file" id="avatar-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
                    </label>
                    <div><h2 id="name-preview">${esc(profile.username)}</h2><span class="dc-tag">APP</span><p class="muted mono">ID ${esc(profile.id)}</p></div>
                </div>
                <div class="card-pad">
                    <label class="field"><span>Name des Bots</span><input id="bot-name" maxlength="32" value="${esc(profile.username)}"><small>Discord erlaubt nur wenige Namensänderungen pro Stunde.</small></label>
                    <div class="form-foot">
                        ${b.guildID ? `<a class="btn" target="_blank" rel="noopener" href="https://discord.com/oauth2/authorize?client_id=${profile.id}&scope=bot%20applications.commands&permissions=8&guild_id=${b.guildID}&disable_guild_select=true">${icon('link')}Einladungslink</a>` : ''}
                        <button class="btn btn-primary" type="submit">${icon('save')}Profil speichern</button>
                    </div>
                </div>
            </form>` : `<div class="card empty"><span class="stat-icon">${icon('bot')}</span><h3>Profil nicht verfügbar</h3><p>${esc(profile.error || 'Hinterlege zuerst einen gültigen Bot-Token unter „Konfiguration“.')}</p><a class="btn btn-primary" href="${base()}/config">${icon('settings')}Zur Konfiguration</a></div>`}`;
        if (!profile.username) return;
        $('#bot-name').oninput = e => ($('#name-preview').textContent = e.target.value);
        $('#avatar-file').onchange = (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.size > 8 * 1024 * 1024) return Z.toast('Das Bild ist zu groß (max. 8 MB)', true);
            const reader = new FileReader();
            reader.onload = () => {
                avatarData = reader.result;
                $('#avatar-img').src = avatarData;
            };
            reader.readAsDataURL(f);
        };
        $('#profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = {};
            if ($('#bot-name').value.trim() !== profile.username) body.username = $('#bot-name').value.trim();
            if (avatarData) body.avatar = avatarData;
            if (!Object.keys(body).length) return Z.toast('Nichts geändert');
            const saved = await Z.run(() => Z.api('PUT', `/api/bots/${id}/profile`, body), 'Profil aktualisiert');
            if (saved) Object.assign(profile, saved);
        });
    };

    /* ---------- Team ---------- */

    Z.pages['bot.team'] = async ({id, el}) => {
        const d = await Z.api('GET', `/api/bots/${id}`);
        const owners = [...(d.owners || [])];
        function render() {
            el.innerHTML = `${pageHead('Team & Zugriff', 'Wer diesen Bot im Panel verwalten darf.')}
                <div class="grid-2">
                    <div class="card"><div class="card-head"><h3>${icon('crown')}Besitzer</h3></div><div class="card-pad">
                        <form class="inline-form" id="owner-form"><input id="owner-id" placeholder="Discord-Nutzer-ID" inputmode="numeric" required><button class="btn btn-primary" type="submit">${icon('plus')}Hinzufügen</button></form>
                        <div class="list">${owners.length ? owners.map(o => `<div class="list-row"><span class="av av-fallback">${icon('user')}</span><code class="grow">${esc(o)}</code><button class="icon-btn icon-btn-sm" data-remove-owner="${o}">${icon('trash')}</button></div>`).join('') : '<p class="muted">Keine Besitzer eingetragen.</p>'}</div>
                    </div></div>
                    <div class="card"><div class="card-head"><h3>${icon('info')}So funktioniert der Zugriff</h3></div><div class="card-pad info-list">
                        <p>${icon('shield')}<span><b>Panel-Admins</b> sehen und verwalten alle Bots.</span></p>
                        <p>${icon('crown')}<span><b>Besitzer</b> verwalten diesen Bot – auch ohne Rechte auf dem Discord-Server.</span></p>
                        <p>${icon('server')}<span><b>Server-Verwalter</b> (Rechte „Server verwalten“ auf Discord) sehen den Bot automatisch, wenn ihr Account im Panel freigeschaltet ist.</span></p>
                    </div></div>
                </div>`;
            $('#owner-form').onsubmit = async (e) => {
                e.preventDefault();
                const value = $('#owner-id').value.trim();
                if (!(/^\d{15,22}$/).test(value)) return Z.toast('Ungültige Discord-ID', true);
                owners.push(value);
                if (await Z.run(() => Z.api('PUT', `/api/bots/${id}/owners`, {owners}), 'Besitzer hinzugefügt')) render();
                else owners.pop();
            };
            el.onclick = async (e) => {
                const rm = e.target.closest('[data-remove-owner]');
                if (!rm) return;
                owners.splice(owners.indexOf(rm.getAttribute('data-remove-owner')), 1);
                if (await Z.run(() => Z.api('PUT', `/api/bots/${id}/owners`, {owners}), 'Entfernt')) render();
            };
        }
        render();
    };

    /* ---------- Settings ---------- */

    Z.pages['bot.settings'] = async ({id, el}) => {
        const d = await Z.api('GET', `/api/bots/${id}`);
        el.innerHTML = `${pageHead('Einstellungen', 'Verhalten des Bots im Panel.')}
            <div class="grid-2">
                <form class="card" id="panel-form"><div class="card-head"><h3>${icon('sliders')}Allgemein</h3></div><div class="card-pad stack">
                    <label class="field"><span>Name im Panel</span><input id="set-name" maxlength="64" value="${esc(d.name)}" required></label>
                    <label class="field"><span>Sprache des Bots</span><select id="set-lang"><option value="de" ${d.language === 'de' ? 'selected' : ''}>Deutsch</option><option value="en" ${d.language === 'en' ? 'selected' : ''}>English</option></select><small>Gilt nach einem Neustart. Bereits gespeicherte Modul-Texte bleiben, bis du sie zurücksetzt.</small></label>
                    <div class="toggle-row"><div><strong>Autostart</strong><small>Mit dem Panel automatisch starten.</small></div><span class="switch"><input type="checkbox" id="set-auto" ${d.autoStart ? 'checked' : ''}><span class="track"></span></span></div>
                    <div class="toggle-row"><div><strong>Automatischer Neustart</strong><small>Nach Abstürzen neu starten (nicht bei Token- oder Konfigurationsfehlern).</small></div><span class="switch"><input type="checkbox" id="set-restart" ${d.autoRestart ? 'checked' : ''}><span class="track"></span></span></div>
                    <div class="form-foot"><button class="btn btn-primary" type="submit">${icon('save')}Speichern</button></div>
                </div></form>
                <div class="card danger"><div class="card-head"><h3>${icon('alert')}Gefahrenzone</h3></div><div class="card-pad stack">
                    <p class="muted">Löscht den Bot inklusive Konfiguration und Datenbank. Das kann nicht rückgängig gemacht werden.</p>
                    <div><button class="btn btn-danger" id="delete-bot">${icon('trash')}Bot löschen</button></div>
                </div></div>
            </div>`;
        $('#panel-form').onsubmit = async (e) => {
            e.preventDefault();
            await Z.run(() => Z.api('PUT', `/api/bots/${id}/settings`, {
                name: $('#set-name').value, language: $('#set-lang').value, autoStart: $('#set-auto').checked, autoRestart: $('#set-restart').checked
            }), 'Gespeichert');
        };
        $('#delete-bot').onclick = async () => {
            if (!await Z.confirmDialog('Bot löschen?', `„${d.name}“ wird gestoppt und mit allen Daten entfernt.`, 'Endgültig löschen')) return;
            if (await Z.run(() => Z.api('DELETE', `/api/bots/${id}`), 'Bot gelöscht')) Z.go('/');
        };
    };
}());
