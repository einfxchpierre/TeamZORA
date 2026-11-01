/* global icon */
/*
 * TeamZORA emojis in the dashboard: rendering emojis as images in previews, the emoji picker and
 * the emoji gallery tab.
 */
(function () {
    const EmojiKit = {
        meta: null,
        pattern: null,
        byKey: new Map(),
        status: null
    };

    function emojiEsc(value) {
        return String(value === null || typeof value === 'undefined' ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Loads manifest + mapping once.
     * @returns {Promise<Object>}
     */
    async function loadEmojiMeta() {
        if (EmojiKit.meta) return EmojiKit.meta;
        const res = await fetch('/api/emojis', {credentials: 'same-origin'});
        const data = await res.json();
        EmojiKit.meta = {...data.manifest, mapping: data.mapping || {}};
        for (const [k, v] of Object.entries(EmojiKit.meta.mapping)) EmojiKit.byKey.set(k.replace(/️/g, ''), v);
        const keys = [...EmojiKit.byKey.keys()].sort((a, b) => b.length - a.length);
        EmojiKit.pattern = new RegExp(keys.map(k => [...k].map(escapeRegex).join('\\uFE0F?') + '\\uFE0F?').join('|'), 'gu');
        return EmojiKit.meta;
    }

    function emojiImg(name, title) {
        return `<img class="zemoji" src="/emojis/${emojiEsc(name)}.png" alt=":${emojiEsc(name)}:" title="${emojiEsc(title || name)}" loading="lazy">`;
    }

    /**
     * Turns already-escaped HTML text into text with emoji images (standard emojis, :z_x: and <:z_x:id>).
     * @param {string} html Escaped text
     * @returns {string}
     */
    function renderEmojis(html) {
        if (!EmojiKit.pattern) return html;
        return html
            .replace(/&lt;a?:(?<name>z_[a-z0-9_]+):\d+&gt;/g, (m, name) => emojiImg(name))
            .replace(/:(?<name>z_[a-z0-9_]+):/g, (m, name) => emojiImg(name))
            .replace(EmojiKit.pattern, (m) => {
                const name = EmojiKit.byKey.get(m.replace(/️/g, ''));
                return name ? emojiImg(name, m) : m;
            });
    }

    /**
     * Minimal Discord markdown + emoji rendering for previews.
     * @param {string} text
     * @param {Object} [params] Known %params% to highlight
     * @returns {string}
     */
    /**
     * Removes mapped emojis and shortcodes (Discord cannot show custom emojis in titles, field names, footers).
     * @param {string} text
     * @returns {string}
     */
    function stripEmojis(text) {
        if (!EmojiKit.pattern || typeof text !== 'string') return text;
        const stripped = text
            .replace(new RegExp(`(?:${EmojiKit.pattern.source})\\s?`, 'gu'), m => (EmojiKit.byKey.has(m.trim().replace(/\uFE0F/g, '')) ? '' : m))
            .replace(/<?a?:z_[a-z0-9_]+:(?:\d+>)?\s?/g, '')
            .trim();
        return stripped || text;
    }

    function renderDiscordText(text, plain) {
        let html = emojiEsc(plain ? stripEmojis(text || '') : text || '');
        html = html
            .replace(/```(?<code>[\s\S]*?)```/g, '<pre>$<code></pre>')
            .replace(/`(?<code>[^`]+)`/g, '<code>$<code></code>')
            .replace(/\*\*(?<t>[^*]+)\*\*/g, '<strong>$<t></strong>')
            .replace(/\*(?<t>[^*]+)\*/g, '<em>$<t></em>')
            .replace(/__(?<t>[^_]+)__/g, '<u>$<t></u>')
            .replace(/^### (?<t>.*)$/gm, '<span class="md-h3">$<t></span>')
            .replace(/^## (?<t>.*)$/gm, '<span class="md-h2">$<t></span>')
            .replace(/^-# (?<t>.*)$/gm, '<span class="md-sub">$<t></span>')
            .replace(/%(?<p>[a-zA-Z0-9_-]+)%/g, '<span class="md-param">%$<p>%</span>')
            .replace(/&lt;@&amp;?\d+&gt;/g, '<span class="md-mention">@mention</span>')
            .replace(/&lt;#\d+&gt;/g, '<span class="md-mention">#kanal</span>')
            .replace(/\n/g, '<br>');
        return renderEmojis(html);
    }

    /**
     * Markup the bot can use directly (needed for reaction emoji fields): <:name:id> when imported.
     * @param {string} name
     * @returns {string}
     */
    function emojiValueFor(name, preferMarkup) {
        const id = EmojiKit.status && EmojiKit.status.emojis ? EmojiKit.status.emojis[name] : null;
        if (preferMarkup && id) return `<:${name}:${id}>`;
        return `:${name}:`;
    }

    const picker = {colorFilter: 'all', search: '', onPick: null, preferMarkup: false};

    function pickerGrid() {
        const meta = EmojiKit.meta;
        const q = picker.search.toLowerCase();
        const list = meta.emojis.filter(e => (picker.colorFilter === 'all' || e.color === picker.colorFilter) &&
            (!q || `${e.name} ${meta.glyphs[e.glyph]} ${meta.colors[e.color].label}`.toLowerCase().includes(q)));
        return list.length ? list.map(e => `<button type="button" class="emoji-cell" data-pick="${e.name}" title="${emojiEsc(meta.glyphs[e.glyph])} · ${emojiEsc(meta.colors[e.color].label)}">${emojiImg(e.name)}</button>`).join('')
            : '<div class="muted" style="padding:12px">Nichts gefunden.</div>';
    }

    function renderPicker() {
        const meta = EmojiKit.meta;
        const el = document.getElementById('emoji-picker');
        el.innerHTML = `
            <div class="emoji-picker-card">
                <div class="modal-head"><h3>${icon('sparkle')}Emoji einfügen</h3><button type="button" class="icon-btn icon-btn-sm" data-picker-close>${icon('x')}</button></div>
                <div class="emoji-picker-tools">
                    <label class="search"><span class="i">${icon('search')}</span><input class="input" id="emoji-search" placeholder="Suchen, z. B. Haken, Stern, Pink…" value="${emojiEsc(picker.search)}"></label>
                    <div class="chips">
                        <button type="button" class="chip${picker.colorFilter === 'all' ? ' active' : ''}" data-color="all">Alle</button>
                        ${Object.entries(meta.colors).map(([k, c]) => `<button type="button" class="chip color-chip${picker.colorFilter === k ? ' active' : ''}" data-color="${k}"><span class="swatch" style="background:${c.hex}"></span>${emojiEsc(c.label)}</button>`).join('')}
                    </div>
                </div>
                <div class="emoji-grid" id="emoji-grid">${pickerGrid()}</div>
                <div class="emoji-picker-foot muted">Tipp: <code>:z_check_green:</code> funktioniert in jedem Text – der Bot ersetzt es automatisch.</div>
            </div>`;
    }

    /**
     * Opens the picker.
     * @param {Function} onPick Receives the text to insert
     * @param {boolean} [preferMarkup] Insert <:name:id> (for reaction emoji fields)
     */
    async function openEmojiPicker(onPick, preferMarkup) {
        await loadEmojiMeta();
        let el = document.getElementById('emoji-picker');
        if (!el) {
            el = document.createElement('div');
            el.id = 'emoji-picker';
            el.className = 'modal';
            document.body.appendChild(el);
            el.addEventListener('click', (e) => {
                if (e.target === el || e.target.closest('[data-picker-close]')) {
                    el.classList.add('hidden');
                    return;
                }
                const color = e.target.closest('[data-color]');
                if (color) {
                    picker.colorFilter = color.getAttribute('data-color');
                    renderPicker();
                    return;
                }
                const cell = e.target.closest('[data-pick]');
                if (cell && picker.onPick) {
                    picker.onPick(emojiValueFor(cell.getAttribute('data-pick'), picker.preferMarkup));
                    el.classList.add('hidden');
                }
            });
            el.addEventListener('input', (e) => {
                if (e.target.id !== 'emoji-search') return;
                picker.search = e.target.value;
                document.getElementById('emoji-grid').innerHTML = pickerGrid();
            });
        }
        picker.onPick = onPick;
        picker.preferMarkup = !!preferMarkup;
        renderPicker();
        el.classList.remove('hidden');
        const search = document.getElementById('emoji-search');
        if (search) search.focus();
    }

    /**
     * Emoji tab of a bot: import status, gallery and the standard-emoji mapping.
     * @param {HTMLElement} container
     * @param {Object} ctx {botId, api, toast, running}
     */
    async function renderEmojiTab(container, ctx) {
        const meta = await loadEmojiMeta();
        const status = await ctx.api('GET', `/api/bots/${ctx.botId}/emojis`).catch(() => ({}));
        EmojiKit.status = status;
        const imported = status.imported || 0;
        const total = meta.emojis.length;
        const pct = total ? Math.round(imported / total * 100) : 0;
        const glyphs = Object.keys(meta.glyphs);
        const colors = Object.keys(meta.colors).filter(c => c !== 'black');
        const mappingRows = Object.entries(meta.mapping);
        container.innerHTML = `
            <div class="emoji-hero card">
                <div class="emoji-hero-art">${['z_check_green', 'z_heart_pink', 'z_star_yellow', 'z_bolt_blue', 'z_party_purple', 'z_shield_white'].map(n => emojiImg(n)).join('')}</div>
                <div class="emoji-hero-body">
                    <h2>FreeBot Emoji-Set</h2>
                    <p class="muted">${total} eigene Emojis in ${colors.length} Farben. Sie werden als <strong>App-Emojis</strong> in den Bot importiert – sie funktionieren auf jedem Server und belegen keine Server-Emoji-Plätze. Alle Standard-Emojis in Bot-Nachrichten werden automatisch ersetzt.</p>
                    <div class="bar bar-lg"><span style="width:${pct}%"></span></div>
                    <div class="emoji-hero-meta">
                        <span>${status.syncing ? `${icon('refresh')} Import läuft…` : `${icon('check')} ${imported} / ${total} importiert`}</span>
                        ${status.enabled === false ? `<span class="badge">${icon('alert')}In den Einstellungen deaktiviert</span>` : ''}
                        ${status.lastError ? `<span class="badge status-error"><span class="dot"></span>${emojiEsc(status.lastError)}</span>` : ''}
                    </div>
                </div>
                <div class="emoji-hero-actions">
                    <button class="btn btn-primary" data-emoji-action="sync" ${ctx.running ? '' : 'disabled'}>${icon('arrowDown')}Jetzt importieren</button>
                    <button class="btn" data-emoji-action="reset" ${ctx.running ? '' : 'disabled'}>${icon('restart')}Neu importieren</button>
                    ${ctx.running ? '' : '<small class="muted">Bot starten, um zu importieren</small>'}
                </div>
            </div>
            <div class="section-title" style="margin-top:24px"><h2>Galerie</h2><span class="muted">Klick kopiert den Shortcode</span></div>
            <div class="card emoji-table-wrap">
                <table class="emoji-table">
                    <thead><tr><th></th>${colors.map(c => `<th><span class="swatch" style="background:${meta.colors[c].hex}"></span>${emojiEsc(meta.colors[c].label)}</th>`).join('')}</tr></thead>
                    <tbody>${glyphs.map(g => `<tr><th>${emojiEsc(meta.glyphs[g])}</th>${colors.map((c) => {
        const name = `z_${g}_${c}`;
        const ok = status.emojis && status.emojis[name];
        return `<td><button class="emoji-cell${ok ? ' ok' : ''}" data-copy=":${name}:" title=":${name}:">${emojiImg(name)}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody>
                </table>
            </div>
            <div class="section-title" style="margin-top:24px"><h2>Automatischer Ersatz</h2><span class="muted">${mappingRows.length} Standard-Emojis</span></div>
            <div class="card card-pad mapping-grid">
                ${mappingRows.map(([u, n]) => `<div class="mapping"><span class="mapping-from">${emojiEsc(u)}</span>${icon('chevron')}${emojiImg(n)}</div>`).join('')}
            </div>`;
        container.onclick = async (e) => {
            const copy = e.target.closest('[data-copy]');
            if (copy) {
                const textValue = copy.getAttribute('data-copy');
                try {
                    await navigator.clipboard.writeText(textValue);
                    ctx.toast(`${textValue} kopiert`);
                } catch {
                    ctx.toast(textValue);
                }
                return;
            }
            const action = e.target.closest('[data-emoji-action]');
            if (!action) return;
            action.disabled = true;
            const cmd = action.getAttribute('data-emoji-action') === 'reset' ? 'emojis reset' : 'emojis';
            try {
                await ctx.api('POST', `/api/bots/${ctx.botId}/command`, {command: cmd});
                ctx.toast('Import gestartet – Fortschritt in der Konsole');
            } catch (err) {
                ctx.toast(err.message, true);
            }
            setTimeout(() => renderEmojiTab(container, ctx), 4000);
        };
    }

    window.EmojiKit = EmojiKit;
    window.loadEmojiMeta = loadEmojiMeta;
    window.renderDiscordText = renderDiscordText;
    window.renderEmojis = renderEmojis;
    window.openEmojiPicker = openEmojiPicker;
    window.renderEmojiTab = renderEmojiTab;
    window.emojiImg = emojiImg;
}());
