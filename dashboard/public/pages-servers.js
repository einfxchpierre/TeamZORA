/* global icon, Z */
/*
 * Pages outside a server: login, server selection, bot setup wizard and admin area.
 */
(function () {
    const {$, esc} = Z;

    const LOGIN_ERRORS = {
        denied: 'Dein Discord-Account ist für dieses Panel nicht freigeschaltet. Schick deine Discord-ID an einen Admin:',
        state: 'Die Anmeldung ist abgelaufen. Bitte versuche es erneut.',
        discord: 'Discord hat die Anmeldung abgelehnt. Bitte versuche es erneut.',
        oauth: 'Der Discord-Login ist auf diesem Server noch nicht eingerichtet. Melde dich mit dem Admin-Passwort an.'
    };

    /* ---------- Login ---------- */

    Z.pages.login = ({query}) => {
        if (Z.state.session && Z.state.session.authenticated) return Z.go('/');
        const error = query.get('error');
        const oauth = Z.state.session && Z.state.session.oauth;
        $('#app').innerHTML = `
            <div class="login-screen">
                <div class="login-hero">
                    <span class="logo logo-lg">${Z.logo()}</span>
                    <h1>Dein Discord-Bot.<br><span>Komplett in deiner Hand.</span></h1>
                    <p>Module aktivieren, Nachrichten gestalten, Emojis, Team und Statistiken – alles in einem Panel.</p>
                </div>
                <div class="login-card">
                    <h2>Anmelden</h2>
                    <p class="muted">Melde dich mit deinem Discord-Account an, um deine Server zu verwalten.</p>
                    ${error ? `<div class="reason">${icon('alert')}<span>${esc(LOGIN_ERRORS[error] || 'Anmeldung fehlgeschlagen.')}${error === 'denied' && query.get('id') ? ` <code>${esc(query.get('id'))}</code>` : ''}</span></div>` : ''}
                    ${oauth ? `<a class="btn btn-discord btn-block btn-lg" href="/auth/login">${icon('discord')}Mit Discord anmelden</a>` : ''}
                    <details class="pw-login"${oauth ? '' : ' open'}>
                        <summary>${icon('key')}Admin-Login mit Passwort</summary>
                        <form id="pw-form">
                            <input type="password" id="pw" placeholder="Admin-Passwort" autocomplete="current-password" required>
                            <button class="btn btn-primary btn-block" type="submit">${icon('login')}Anmelden</button>
                            <p class="form-error" id="pw-error"></p>
                        </form>
                    </details>
                </div>
            </div>`;
        $('#pw-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await Z.api('POST', '/api/login', {password: $('#pw').value});
                await Z.refreshSession();
                Z.go('/');
            } catch (err) {
                $('#pw-error').textContent = err.message;
            }
        });
    };

    /* ---------- Server selection ---------- */

    function serverCard(b) {
        const g = b.guild || {};
        const name = g.name || b.name;
        const problems = (b.problemCount || 0);
        return `<a class="server-card" href="#/s/${b.id}">
            <div class="server-card-banner"${g.icon ? ` style="background-image:url('${esc(g.icon)}')"` : ''}></div>
            <div class="server-card-body">
                ${Z.avatar(g.icon, name, 'av av-lg')}
                <div class="server-card-text">
                    <strong>${esc(name)}</strong>
                    <span class="muted">${b.profile && b.profile.username ? `${icon('bot')}${esc(b.profile.username)}` : esc(b.name)}</span>
                </div>
                ${Z.statusBadge(b.status)}
            </div>
            <div class="server-card-foot">
                <span>${icon('puzzle')}${b.enabledModules} Module</span>
                <span>${icon('clock')}${Z.uptimeOf(b)}</span>
                ${problems ? `<span class="text-err">${icon('alert')}${problems} Problem${problems === 1 ? '' : 'e'}</span>` : `<span>${icon('check')}Alles okay</span>`}
            </div>
        </a>`;
    }

    function guildCard(g) {
        return `<a class="server-card server-card-empty" href="#/new/${g.id}">
            <div class="server-card-body">
                ${Z.avatar(g.icon, g.name, 'av av-lg')}
                <div class="server-card-text"><strong>${esc(g.name)}</strong><span class="muted">${g.owner ? 'Du bist Eigentümer' : 'Du verwaltest diesen Server'}</span></div>
                <span class="btn btn-sm">${icon('plus')}Bot einrichten</span>
            </div>
        </a>`;
    }

    Z.pages.servers = async ({el}) => {
        const me = Z.state.session.user;
        el.innerHTML = '<div class="loading">Lade deine Server…</div>';
        const data = await Z.api('GET', '/api/me').catch((e) => {
            Z.toast(e.message, true);
            return {withBot: [], without: []};
        });
        Z.state.me = data;
        function render() {
            const bots = data.withBot.map(b => ({...b, ...(Z.state.bots.get(b.id) || {}), guild: b.guild, profile: b.profile}));
            el.innerHTML = `
                <div class="container">
                    <div class="hello">
                        <div>
                            <h1>Hallo, ${esc(me.username)}</h1>
                            <p class="muted">Wähle einen Server, um seinen Bot zu verwalten.</p>
                        </div>
                        <div class="actions">
                            ${me.local ? '' : `<button class="btn" id="refresh-guilds">${icon('refresh')}Daten neuladen</button>`}
                            ${me.admin ? `<a class="btn btn-primary" href="#/new">${icon('plus')}Neuer Bot</a>` : ''}
                        </div>
                    </div>
                    <h2 class="section-h">Server mit FreeBot <span class="count">${bots.length}</span></h2>
                    ${bots.length ? `<div class="server-grid">${bots.map(serverCard).join('')}</div>` : `
                        <div class="card empty"><span class="stat-icon">${icon('bot')}</span><h3>Noch kein Bot</h3>
                        <p>${data.without.length ? 'Richte unten für einen deiner Server einen Bot ein.' : 'Sobald du einen Bot einrichtest, erscheint er hier.'}</p></div>`}
                    ${data.without.length ? `<h2 class="section-h">Ohne FreeBot <span class="count">${data.without.length}</span></h2>
                        <div class="server-grid">${data.without.map(guildCard).join('')}</div>` : ''}
                    ${me.local ? '<p class="muted small center">Du bist mit dem Admin-Passwort angemeldet und siehst alle Bots. Melde dich mit Discord an, um deine eigenen Server zu sehen.</p>' : ''}
                </div>`;
            const btn = $('#refresh-guilds');
            if (btn) {
                btn.onclick = async () => {
                    btn.disabled = true;
                    const fresh = await Z.run(() => Z.api('POST', '/api/me/refresh'), 'Server neu geladen');
                    if (fresh) Object.assign(data, fresh);
                    render();
                };
            }
        }
        render();
        Z.hooks.bots = render;
        Z.hooks.tick = render;
    };

    /* ---------- New bot wizard ---------- */

    Z.pages.new = ({parts, el}) => {
        const me = Z.state.session.user;
        const guilds = (Z.state.me && Z.state.me.without) || [];
        const preset = parts[1] || '';
        const presetGuild = guilds.find(g => g.id === preset);
        el.innerHTML = `
            <div class="container narrow">
                <a class="btn btn-ghost btn-sm" href="#/">${icon('back')}Zurück</a>
                <div class="wizard-head">
                    ${presetGuild ? Z.avatar(presetGuild.icon, presetGuild.name, 'av av-lg') : `<span class="stat-icon">${icon('bot')}</span>`}
                    <div><h1>Bot einrichten</h1><p class="muted">${presetGuild ? `für <b>${esc(presetGuild.name)}</b>` : 'In drei Schritten zu deinem eigenen Bot.'}</p></div>
                </div>
                <form class="card wizard" id="new-form">
                    <div class="step"><span class="step-n">1</span><div>
                        <h3>Bot im Developer Portal anlegen</h3>
                        <p class="muted">Öffne das <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Discord Developer Portal</a>, erstelle eine Application und gehe zu <b>Bot</b>. Aktiviere dort alle drei <b>Privileged Gateway Intents</b> und kopiere den Token.</p>
                    </div></div>
                    <div class="step"><span class="step-n">2</span><div class="grow">
                        <h3>Token und Server</h3>
                        <div class="form-grid">
                            <label class="field full"><span>Bot-Token</span><input name="token" type="password" autocomplete="off" required placeholder="Token aus dem Developer Portal"><small>Wird nur auf diesem Server gespeichert und nie wieder angezeigt.</small></label>
                            <label class="field"><span>Name im Panel</span><input name="name" maxlength="64" required value="${esc(presetGuild ? presetGuild.name : '')}" placeholder="z. B. Community-Bot"></label>
                            ${guilds.length && !me.admin ? `<label class="field"><span>Server</span><select name="guildID">${guilds.map(g => `<option value="${g.id}" ${g.id === preset ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>`
        : `<label class="field"><span>Server-ID</span><input name="guildID" inputmode="numeric" required value="${esc(preset)}" placeholder="123456789012345678"></label>`}
                        </div>
                    </div></div>
                    <div class="step"><span class="step-n">3</span><div class="grow">
                        <h3>Feinschliff</h3>
                        <div class="form-grid">
                            <label class="field"><span>Sprache</span><select name="language"><option value="de">Deutsch</option><option value="en">English</option></select></label>
                            <label class="field"><span>Zeitzone</span><input name="timezone" value="Europe/Berlin"></label>
                        </div>
                        <div class="toggle-row"><div><strong>Automatisch starten</strong><small>Startet den Bot sofort und nach jedem Neustart des Panels.</small></div>
                            <span class="switch"><input type="checkbox" name="autoStart" checked><span class="track"></span></span></div>
                    </div></div>
                    <p class="form-error" id="new-error"></p>
                    <div class="form-foot"><button class="btn btn-primary btn-lg" type="submit">${icon('rocket')}Bot erstellen & starten</button></div>
                </form>
            </div>`;
        $('#new-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = new FormData(e.target);
            const body = Object.fromEntries(form.entries());
            body.autoStart = form.has('autoStart');
            try {
                const created = await Z.api('POST', '/api/bots', body);
                Z.toast('Bot erstellt – er startet jetzt');
                Z.go(`/s/${created.id}`);
            } catch (err) {
                $('#new-error').textContent = err.message;
            }
        });
    };

    /* ---------- Admin ---------- */

    function usersHTML(users) {
        return users.length ? users.map(u => `<div class="list-row">
            ${Z.avatar(u.avatar, u.name || u.id, 'av')}
            <div class="grow"><strong>${esc(u.name || 'Noch nie angemeldet')}</strong><small class="muted mono">${esc(u.id)}</small></div>
            <label class="inline-check"><span class="switch"><input type="checkbox" data-admin="${u.id}" ${u.admin ? 'checked' : ''}><span class="track"></span></span>Admin</label>
            <button class="icon-btn icon-btn-sm" data-remove-user="${u.id}" title="Entfernen">${icon('trash')}</button>
        </div>`).join('') : '<p class="muted">Noch keine Nutzer.</p>';
    }

    Z.pages.admin = async ({el}) => {
        if (!Z.state.session.user.admin) return Z.go('/');
        const [users, data] = await Promise.all([Z.api('GET', '/api/admin/users'), Z.api('GET', '/api/me')]);
        const sys = data.system || {};
        const oauth = Z.state.session.oauth;
        function render(list) {
            const bots = [...Z.state.bots.values()];
            const online = bots.filter(b => b.status === 'running').length;
            const ram = bots.reduce((s, b) => s + (b.memory || 0), 0);
            el.innerHTML = `
                <div class="container">
                    <div class="hello"><div><h1>Admin-Bereich</h1><p class="muted">Zugänge, alle Bots und das System.</p></div>
                        <div class="actions"><button class="btn" data-all="start">${icon('play')}Alle starten</button><button class="btn" data-all="stop">${icon('stop')}Alle stoppen</button></div></div>
                    <div class="stats">
                        <div class="card stat"><div class="stat-top"><span>Bots</span><span class="stat-icon">${icon('bot')}</span></div><div class="stat-value">${bots.length}</div><div class="stat-sub">${online} online</div></div>
                        <div class="card stat"><div class="stat-top"><span>RAM (Bots)</span><span class="stat-icon">${icon('memory')}</span></div><div class="stat-value">${Z.formatBytes(ram)}</div><div class="stat-sub">System: ${Z.formatBytes((sys.totalMem || 0) - (sys.freeMem || 0))} / ${Z.formatBytes(sys.totalMem)}</div></div>
                        <div class="card stat"><div class="stat-top"><span>Last (1 min)</span><span class="stat-icon">${icon('cpu')}</span></div><div class="stat-value">${sys.load ? sys.load[0].toFixed(2) : '–'}</div><div class="stat-sub">${sys.cpus || '–'} CPU-Kerne</div></div>
                        <div class="card stat"><div class="stat-top"><span>Nutzer</span><span class="stat-icon">${icon('users')}</span></div><div class="stat-value">${list.length}</div><div class="stat-sub">Version ${esc(sys.version || '')}</div></div>
                    </div>
                    <div class="grid-2">
                        <div class="card">
                            <div class="card-head"><h3>${icon('users')}Freigeschaltete Accounts</h3></div>
                            <div class="card-pad">
                                <form class="inline-form" id="add-user"><input id="new-user" placeholder="Discord-Nutzer-ID" inputmode="numeric" required><label class="inline-check"><input type="checkbox" id="new-admin">Admin</label><button class="btn btn-primary" type="submit">${icon('plus')}Freischalten</button></form>
                                <small class="muted">Nur freigeschaltete Accounts können sich mit Discord anmelden. Sie sehen die Bots ihrer eigenen Server und Bots, bei denen sie als Besitzer eingetragen sind.</small>
                                <div class="list" id="user-list">${usersHTML(list)}</div>
                            </div>
                        </div>
                        <div class="card">
                            <div class="card-head"><h3>${icon('discord')}Discord-Login</h3>${oauth ? '<span class="pill status-running"><span class="dot"></span>Aktiv</span>' : '<span class="pill status-error"><span class="dot"></span>Nicht eingerichtet</span>'}</div>
                            <div class="card-pad">
                                <p class="muted">Lege im Developer Portal eine Application an und trage unter <b>OAuth2 → Redirects</b> diese URL ein:</p>
                                <code class="code-block">${esc(location.origin)}/auth/callback</code>
                                <p class="muted">Dann in <code>.dashboard.env</code> setzen und das Panel neu starten:</p>
                                <code class="code-block">PANEL_URL=${esc(location.origin)}<br>DISCORD_CLIENT_ID=…<br>DISCORD_CLIENT_SECRET=…</code>
                            </div>
                        </div>
                    </div>
                    <h2 class="section-h">Alle Bots <span class="count">${bots.length}</span></h2>
                    <div class="card table-card"><table class="table">
                        <thead><tr><th>Bot</th><th>Status</th><th class="hide-sm">Server-ID</th><th class="hide-sm">RAM</th><th>Uptime</th><th></th></tr></thead>
                        <tbody>${bots.map(b => `<tr><td><strong>${esc(b.name)}</strong></td><td>${Z.statusBadge(b.status)}</td><td class="mono hide-sm">${esc(b.guildID || '–')}</td><td class="hide-sm">${Z.formatBytes(b.memory)}</td><td>${Z.uptimeOf(b)}</td><td class="right"><a class="btn btn-sm" href="#/s/${b.id}">Öffnen${icon('chevron')}</a></td></tr>`).join('')}</tbody>
                    </table></div>
                </div>`;
        }
        render(users);
        Z.hooks.bots = () => render(users);
        el.onclick = async (e) => {
            const all = e.target.closest('[data-all]');
            if (all) await Z.run(() => Z.api('POST', `/api/bots/${all.getAttribute('data-all')}-all`), all.getAttribute('data-all') === 'start' ? 'Alle Bots werden gestartet' : 'Alle Bots gestoppt');
            const rm = e.target.closest('[data-remove-user]');
            if (rm && await Z.confirmDialog('Zugang entfernen?', 'Der Account kann sich danach nicht mehr anmelden.', 'Entfernen')) {
                const list = await Z.run(() => Z.api('DELETE', `/api/admin/users/${rm.getAttribute('data-remove-user')}`), 'Zugang entfernt');
                if (list) users.splice(0, users.length, ...list);
                render(users);
            }
        };
        el.onchange = async (e) => {
            const adm = e.target.closest('[data-admin]');
            if (adm) await Z.run(() => Z.api('PUT', `/api/admin/users/${adm.getAttribute('data-admin')}`, {admin: adm.checked}), 'Gespeichert');
        };
        el.onsubmit = async (e) => {
            if (e.target.id !== 'add-user') return;
            e.preventDefault();
            const list = await Z.run(() => Z.api('POST', '/api/admin/users', {id: $('#new-user').value.trim(), admin: $('#new-admin').checked}), 'Account freigeschaltet');
            if (list) users.splice(0, users.length, ...list);
            render(users);
        };
    };
}());
