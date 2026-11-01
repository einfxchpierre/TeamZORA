/* global icon, renderDiscordText, openEmojiPicker, loadEmojiMeta */
/*
 * Schema-driven content editor for module configs: texts, embeds with live preview, placeholders,
 * emoji picker, channel/role pickers, lists, key/value maps and multi-entry configs.
 */
(function () {
    const CHANNEL_TYPES = {
        GUILD_TEXT: 0, GUILD_VOICE: 2, GUILD_CATEGORY: 4, GUILD_NEWS: 5, GUILD_NEWS_THREAD: 10,
        GUILD_PUBLIC_THREAD: 11, GUILD_PRIVATE_THREAD: 12, GUILD_STAGE_VOICE: 13, GUILD_FORUM: 15, GUILD_MEDIA: 16
    };
    const CHANNEL_GROUPS = {0: 'Textkanäle', 5: 'Ankündigungen', 2: 'Sprachkanäle', 13: 'Stage-Kanäle', 15: 'Foren', 16: 'Medien', 4: 'Kategorien'};
    const TYPE_HINT = {
        string: 'Text', boolean: 'Schalter', integer: 'Zahl', float: 'Dezimalzahl', channelID: 'Kanal', roleID: 'Rolle',
        userID: 'Nutzer-ID', guildID: 'Server-ID', array: 'Liste', keyed: 'Zuordnung', select: 'Auswahl', emoji: 'Emoji',
        imgURL: 'Bild-URL', timezone: 'Zeitzone'
    };

    const ed = {
        ctx: null,
        files: [],
        fileIdx: 0,
        drafts: [],
        dirty: new Set(),
        open: new Set(),
        paths: [],
        guild: null,
        lastFocus: null
    };

    function e(value) {
        return ed.ctx.esc(value);
    }

    function clone(v) {
        return v === null || typeof v === 'undefined' ? v : JSON.parse(JSON.stringify(v));
    }

    function getAt(obj, path) {
        let cur = obj;
        for (const k of path) {
            if (cur === null || typeof cur !== 'object') return null;
            cur = cur[k];
        }
        return typeof cur === 'undefined' ? null : cur;
    }

    function setAt(obj, path, value) {
        let cur = obj;
        for (let i = 0; i < path.length - 1; i = i + 1) {
            const k = path[i];
            if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = typeof path[i + 1] === 'number' ? [] : {};
            cur = cur[k];
        }
        cur[path[path.length - 1]] = value;
    }

    /**
     * Registers a draft path and returns its handle for data-p attributes.
     * @param {Array} path
     * @param {Object} [meta]
     * @returns {number}
     */
    function reg(path, meta) {
        ed.paths.push({path, ...(meta || {})});
        return ed.paths.length - 1;
    }

    function draft() {
        return ed.drafts[ed.fileIdx];
    }

    function file() {
        return ed.files[ed.fileIdx];
    }

    function truthy(v) {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') return v !== '' && v !== 'none';
        return !!v;
    }

    function isVisible(field, scope) {
        if (field.dependsOn && !truthy(scope[field.dependsOn])) return false;
        if (field.dependsOnNot && truthy(scope[field.dependsOnNot])) return false;
        return true;
    }

    /* ---------- Pickers for channels / roles ---------- */

    function channelName(id) {
        const c = ed.guild && ed.guild.channels ? ed.guild.channels.find(x => x.id === id) : null;
        if (!c) return id;
        return c.type === 4 ? c.name : `#${c.name}`;
    }

    function roleName(id) {
        const r = ed.guild && ed.guild.roles ? ed.guild.roles.find(x => x.id === id) : null;
        return r ? `@${r.name}` : id;
    }

    function channelOptions(allowedTypes, value, exclude) {
        const channels = ed.guild.channels.filter(c => (!allowedTypes || allowedTypes.includes(c.type)) && !(exclude || []).includes(c.id));
        const groups = {};
        for (const c of channels) (groups[c.type] = groups[c.type] || []).push(c);
        let html = '';
        for (const type of Object.keys(CHANNEL_GROUPS).map(Number)) {
            if (!groups[type]) continue;
            html = html + `<optgroup label="${CHANNEL_GROUPS[type]}">${groups[type].map(c => `<option value="${c.id}" ${c.id === value ? 'selected' : ''}>${type === 4 ? '' : '# '}${e(c.name)}</option>`).join('')}</optgroup>`;
        }
        if (value && !channels.some(c => c.id === value)) html = `<option value="${e(value)}" selected>Unbekannt (${e(value)})</option>` + html;
        return html;
    }

    function roleOptions(value, exclude) {
        const roles = ed.guild.roles.filter(r => !(exclude || []).includes(r.id));
        let html = roles.map(r => `<option value="${r.id}" ${r.id === value ? 'selected' : ''}>@${e(r.name)}${r.managed ? ' (Bot)' : ''}</option>`).join('');
        if (value && !roles.some(r => r.id === value)) html = `<option value="${e(value)}" selected>Unbekannt (${e(value)})</option>` + html;
        return html;
    }

    function allowedChannelTypes(field) {
        if (Array.isArray(field.content)) {
            const types = field.content.map(t => CHANNEL_TYPES[t]).filter(t => typeof t === 'number');
            if (types.length) return types;
        }
        return null;
    }

    /**
     * Single scalar control (used directly, in arrays and in key/value maps).
     * @returns {string}
     */
    function scalarControl(type, value, p, field, opts) {
        const o = opts || {};
        const cls = o.cls ? ` class="${o.cls}"` : '';
        if (type === 'channelID' && ed.guild) {
            return `<select${cls} data-p="${p}" data-kind="text"><option value="">${o.placeholder || '— kein Kanal —'}</option>${channelOptions(field ? allowedChannelTypes(field) : null, value, o.exclude)}</select>`;
        }
        if (type === 'roleID' && ed.guild) {
            return `<select${cls} data-p="${p}" data-kind="text"><option value="">${o.placeholder || '— keine Rolle —'}</option>${roleOptions(value, o.exclude)}</select>`;
        }
        if (type === 'boolean') {
            return `<span class="switch"><input type="checkbox" data-p="${p}" data-kind="bool" ${value ? 'checked' : ''}><span class="track"></span></span>`;
        }
        if (type === 'integer' || type === 'float') {
            const min = field && field.minValue !== null ? ` min="${field.minValue}"` : '';
            const max = field && field.maxValue !== null ? ` max="${field.maxValue}"` : '';
            return `<input${cls} type="number" step="${type === 'float' ? 'any' : '1'}"${min}${max} data-p="${p}" data-kind="num" value="${value === null ? '' : e(value)}" placeholder="${o.placeholder || ''}">`;
        }
        const hint = {channelID: 'Kanal-ID', roleID: 'Rollen-ID', userID: 'Nutzer-ID', guildID: 'Server-ID'}[type] || o.placeholder || '';
        return `<input${cls} data-p="${p}" data-kind="text" value="${e(value === null ? '' : value)}" placeholder="${hint}"${type === 'timezone' ? ' list="tz-list"' : ''}>`;
    }

    /* ---------- Text, embed and preview ---------- */

    function toolsHTML(p, field) {
        const params = (field && field.params) || [];
        return `<div class="ed-tools">
            ${params.map(x => `<button type="button" class="param-chip" data-insert="%${e(x.name)}%" data-target="${p}" title="${e(x.description)}">%${e(x.name)}%</button>`).join('')}
            <button type="button" class="param-chip emoji-btn" data-emoji="${p}" title="Emoji einfügen">${icon('sparkle')}Emoji</button>
        </div>`;
    }

    function textArea(value, p, field, rows) {
        const text = value === null ? '' : String(value);
        const lines = Math.min(12, Math.max(rows || 2, text.split('\n').length + 1));
        return `<textarea data-p="${p}" data-kind="text" rows="${lines}" spellcheck="true">${e(text)}</textarea>${toolsHTML(p, field)}`;
    }

    function isImageURL(v) {
        return typeof v === 'string' && (/^https?:\/\//).test(v);
    }

    function embedColor(color) {
        if (!color || !(/^#?[0-9a-f]{6}$/i).test(color)) return '#5865f2';
        return color.startsWith('#') ? color : `#${color}`;
    }

    function imageOrPlaceholder(url, cls, label) {
        if (!url) return '';
        if (isImageURL(url)) return `<img class="${cls}" src="${e(url)}">`;
        return `<div class="${cls} dc-image-ph">${label ? `${icon('eye')}${label}: ${e(url)}` : ''}</div>`;
    }

    function embedCard(em) {
        if (!em) return '';
        const color = embedColor(em.color);
        const authorImg = em.author ? em.author.img || em.author.iconURL || em.author.imageURL : null;
        const author = em.author && em.author.name ? `<div class="dc-author">${isImageURL(authorImg) ? `<img src="${e(authorImg)}">` : ''}${renderDiscordText(em.author.name, true)}</div>` : '';
        const thumb = em.thumbnail || em.thumbnailURL;
        const image = em.image || em.imageURL;
        const fields = (em.fields || []).filter(f => f && (f.name || f.value)).map(f => `<div class="dc-field${f.inline ? ' inline' : ''}"><strong>${renderDiscordText(f.name, true)}</strong><div>${renderDiscordText(f.value)}</div></div>`).join('');
        const footer = em.footer && typeof em.footer === 'object' ? em.footer.text : em.footer;
        return `<div class="dc-embed" style="border-left-color:${color}">
            <div class="dc-embed-main">
                ${author}
                ${em.title ? `<div class="dc-title">${renderDiscordText(em.title, true)}</div>` : ''}
                ${em.description ? `<div class="dc-desc">${renderDiscordText(em.description)}</div>` : ''}
                ${fields ? `<div class="dc-fields">${fields}</div>` : ''}
                ${imageOrPlaceholder(image, 'dc-image', 'Bild')}
                ${footer ? `<div class="dc-footer">${renderDiscordText(footer, true)}</div>` : ''}
            </div>
            ${imageOrPlaceholder(thumb, 'dc-thumb', '')}
        </div>`;
    }

    function previewHTML(value) {
        let content = '';
        let embeds = [];
        if (typeof value === 'string' || value === null) content = value || '';
        else if (value['_schema']) {
            content = value.content || '';
            embeds = value.embeds || [];
        } else {
            content = value.message || '';
            embeds = [value];
        }
        if (!content && !embeds.some(x => x && (x.title || x.description || (x.fields || []).length || x.image))) return '<div class="dc-empty">Leer – diese Nachricht wird nicht gesendet.</div>';
        return `<div class="dc-msg"><div class="dc-avatar">${icon('bot')}</div><div class="dc-body">
            <div class="dc-name">${e(ed.ctx.botName || 'Bot')} <span class="dc-tag">APP</span></div>
            ${content ? `<div class="dc-content">${renderDiscordText(content)}</div>` : ''}
            ${embeds.map(embedCard).join('')}
        </div></div>`;
    }

    function embedMode(value) {
        if (value && typeof value === 'object') return value['_schema'] ? 'json' : 'embed';
        return 'text';
    }

    function embedEditor(value, path, field) {
        const root = reg(path);
        function p(sub) {
            return reg([...path, ...sub], {preview: root});
        }
        const v = value || {};
        const author = v.author || {};
        const fields = Array.isArray(v.fields) ? v.fields : [];
        return `<div class="embed-editor">
            <label class="ed-sub"><span>Nachrichtentext über dem Embed</span>${textArea(v.message || '', p(['message']), field, 1)}</label>
            <div class="ed-row">
                <label class="ed-sub grow"><span>Titel</span><input data-p="${p(['title'])}" data-kind="text" value="${e(v.title || '')}"></label>
                <label class="ed-sub"><span>Farbe</span><span class="color-input"><input type="color" data-p="${p(['color'])}" data-kind="text" value="${(/^#[0-9a-f]{6}$/i).test(v.color || '') ? v.color : '#5865f2'}"></span></label>
            </div>
            <label class="ed-sub"><span>Beschreibung</span>${textArea(v.description || '', p(['description']), field, 3)}</label>
            <div class="ed-row">
                <label class="ed-sub grow"><span>Autor</span><input data-p="${p(['author', 'name'])}" data-kind="text" value="${e(author.name || '')}"></label>
                <label class="ed-sub grow"><span>Autor-Bild-URL</span><input data-p="${p(['author', 'img'])}" data-kind="text" value="${e(author.img || '')}"></label>
            </div>
            <div class="ed-row">
                <label class="ed-sub grow"><span>Bild-URL</span><input data-p="${p(['image'])}" data-kind="text" value="${e(v.image || '')}"></label>
                <label class="ed-sub grow"><span>Thumbnail-URL</span><input data-p="${p(['thumbnail'])}" data-kind="text" value="${e(v.thumbnail || '')}"></label>
            </div>
            <label class="ed-sub"><span>Link des Titels</span><input data-p="${p(['url'])}" data-kind="text" value="${e(v.url || '')}"></label>
            <div class="ed-sub"><span>Felder</span>
                ${fields.map((f, i) => `<div class="embed-field">
                    <input data-p="${p(['fields', i, 'name'])}" data-kind="text" value="${e(f.name || '')}" placeholder="Name">
                    <textarea data-p="${p(['fields', i, 'value'])}" data-kind="text" rows="1" placeholder="Wert">${e(f.value || '')}</textarea>
                    <label class="inline-check"><input type="checkbox" data-p="${p(['fields', i, 'inline'])}" data-kind="bool" ${f.inline ? 'checked' : ''}>Inline</label>
                    <button type="button" class="icon-btn icon-btn-sm" data-embed-field-remove="${root}" data-i="${i}" title="Feld entfernen">${icon('trash')}</button>
                </div>`).join('')}
                <button type="button" class="btn btn-sm" data-embed-field-add="${root}">${icon('plus')}Feld hinzufügen</button>
            </div>
        </div>`;
    }

    function stringField(field, value, path) {
        if (!field.allowEmbed) {
            const p = reg(path);
            const long = (typeof value === 'string' && (value.length > 60 || value.includes('\n'))) || (typeof field.default === 'string' && field.default.length > 60) || field.params.length;
            if (long) return textArea(value, p, field);
            return `<input data-p="${p}" data-kind="text" value="${e(value === null ? '' : value)}">${field.params.length ? toolsHTML(p, field) : ''}`;
        }
        const mode = embedMode(value);
        const root = reg(path);
        let body;
        if (mode === 'text') body = textArea(value, reg(path, {preview: root}), field, 3);
        else if (mode === 'embed') body = embedEditor(value, path, field);
        else body = `<textarea class="mono" data-p="${reg(path, {preview: root})}" data-kind="json" rows="12" spellcheck="false">${e(JSON.stringify(value, null, 2))}</textarea><small class="muted">Erweitertes Nachrichtenformat (${e(value['_schema'])}) – als JSON bearbeiten.</small>`;
        return `<div class="seg">
                <button type="button" class="${mode === 'text' ? 'active' : ''}" data-mode="text" data-root="${root}">Text</button>
                <button type="button" class="${mode === 'embed' ? 'active' : ''}" data-mode="embed" data-root="${root}">Embed</button>
                ${mode === 'json' ? '<button type="button" class="active" data-mode="json">JSON</button>' : ''}
            </div>
            <div class="embed-split">
                <div class="embed-split-edit">${body}</div>
                <div class="embed-split-preview"><div class="preview-label">${icon('eye')}Vorschau</div><div class="dc-preview" data-preview="${root}">${previewHTML(value)}</div></div>
            </div>`;
    }

    /* ---------- Lists and maps ---------- */

    function itemLabel(type, v) {
        if (type === 'channelID') return channelName(v);
        if (type === 'roleID') return roleName(v);
        return v;
    }

    function arrayField(field, value, path) {
        const list = Array.isArray(value) ? value : [];
        const type = typeof field.content === 'string' ? field.content : 'string';
        const root = reg(path, {array: type});
        const chips = list.map((v, i) => `<span class="item-chip">${type === 'emoji' ? window.renderEmojis(e(v)) : e(itemLabel(type, v))}<button type="button" data-arr-remove="${root}" data-i="${i}" title="Entfernen">${icon('x')}</button></span>`).join('');
        let adder;
        if ((type === 'channelID' || type === 'roleID') && ed.guild) {
            const options = type === 'channelID' ? channelOptions(null, null, list) : roleOptions(null, list);
            adder = `<select data-arr-add-select="${root}"><option value="">${type === 'channelID' ? '+ Kanal hinzufügen…' : '+ Rolle hinzufügen…'}</option>${options}</select>`;
        } else {
            adder = `<div class="arr-input"><input data-arr-input="${root}" placeholder="${type === 'string' ? 'Eintrag hinzufügen' : TYPE_HINT[type] || 'Wert'} und Enter drücken" ${type === 'integer' || type === 'float' ? 'type="number"' : ''}>
                <button type="button" class="btn btn-sm" data-arr-add="${root}">${icon('plus')}</button>${type === 'emoji' || type === 'string' ? `<button type="button" class="btn btn-sm" data-arr-emoji="${root}" title="Emoji">${icon('sparkle')}</button>` : ''}</div>`;
        }
        return `<div class="item-list">${chips || '<span class="muted small">Leer</span>'}</div>${field.maxLength && list.length >= field.maxLength ? '' : adder}`;
    }

    function keyedField(field, value, path) {
        const types = field.content || {key: 'string', value: 'string'};
        const root = reg(path, {keyed: types});
        const entries = Object.entries(value && typeof value === 'object' ? value : {});
        function row(k, v) {
            return `<div class="kv-row">
            ${field.disableKeyEdits ? `<span class="kv-key-fixed">${e(itemLabel(types.key, k))}</span><input type="hidden" class="kv-key" value="${e(k)}">` : scalarControlKV(types.key, k, 'kv-key')}
            <span class="kv-arrow">${icon('chevron')}</span>
            ${scalarControlKV(types.value, v, 'kv-val')}
            ${field.disableKeyEdits ? '' : `<button type="button" class="icon-btn icon-btn-sm" data-kv-remove title="Entfernen">${icon('trash')}</button>`}
        </div>`;
        }
        return `<div class="kv" data-keyed="${root}">
            ${entries.map(([k, v]) => row(k, v)).join('')}
            ${field.disableKeyEdits ? '' : `<button type="button" class="btn btn-sm" data-kv-add="${root}">${icon('plus')}Zeile hinzufügen</button>`}
            <template>${row('', '')}</template>
        </div>`;
    }

    function scalarControlKV(type, value, cls) {
        if (type === 'channelID' && ed.guild) return `<select class="${cls}"><option value="">— Kanal —</option>${channelOptions(null, value)}</select>`;
        if (type === 'roleID' && ed.guild) return `<select class="${cls}"><option value="">— Rolle —</option>${roleOptions(value)}</select>`;
        const num = type === 'integer' || type === 'float';
        return `<input class="${cls}" ${num ? `type="number" step="${type === 'float' ? 'any' : '1'}"` : ''} value="${e(value === null ? '' : value)}" placeholder="${TYPE_HINT[type] || 'Wert'}">`;
    }

    /* ---------- Fields ---------- */

    function fieldHTML(field, value, path, scope) {
        const visible = isVisible(field, scope);
        const wide = ['string', 'array', 'keyed'].includes(field.type) || field.allowEmbed;
        let control;
        switch (field.type) {
            case 'boolean':
                return `<div class="ed-field ed-bool full"${visible ? '' : ' hidden'}><div><strong>${e(field.humanName)}</strong>${field.description ? `<small>${e(field.description)}</small>` : ''}</div>${scalarControl('boolean', value, reg(path, {rerender: true}))}</div>`;
            case 'select': {
                const opts = (field.content || []).map(o => (typeof o === 'object' ? o : {value: o, displayName: o}));
                control = `<select data-p="${reg(path, {rerender: true})}" data-kind="text">${opts.map(o => `<option value="${e(o.value)}" ${o.value === value ? 'selected' : ''}>${e(o.displayName === '' ? '—' : o.displayName)}</option>`).join('')}</select>`;
                break;
            }
            case 'string':
                control = stringField(field, value, path);
                break;
            case 'array':
                control = arrayField(field, value, path);
                break;
            case 'keyed':
                control = keyedField(field, value, path);
                break;
            case 'emoji': {
                const p = reg(path);
                control = `<div class="ed-inline"><input data-p="${p}" data-kind="text" value="${e(value || '')}"><button type="button" class="btn btn-sm" data-emoji="${p}" data-markup="1">${icon('sparkle')}Wählen</button><span class="emoji-preview">${window.renderEmojis(e(value || ''))}</span></div>`;
                break;
            }
            case 'imgURL': {
                const p = reg(path);
                control = `<div class="ed-inline"><input data-p="${p}" data-kind="text" value="${e(value || '')}" placeholder="https://…">${isImageURL(value) ? `<img class="img-preview" src="${e(value)}">` : ''}</div>`;
                break;
            }
            default:
                control = scalarControl(field.type, value, reg(path), field, {placeholder: field.allowNull ? 'optional' : ''});
        }
        return `<div class="ed-field${wide ? ' full' : ''}"${visible ? '' : ' hidden'}>
            <div class="ed-label"><strong>${e(field.humanName)}</strong><span class="type-hint">${TYPE_HINT[field.type] || field.type}</span></div>
            ${field.description ? `<small class="ed-desc">${e(field.description)}</small>` : ''}
            ${control}
        </div>`;
    }

    function fieldsHTML(fields, scope, basePath, categories) {
        const sections = [];
        const uncategorized = fields.filter(f => !f.category || !categories.some(c => c.id === f.category));
        if (uncategorized.length) sections.push({name: null, fields: uncategorized});
        for (const c of categories) {
            const fs = fields.filter(f => f.category === c.id);
            if (fs.length) sections.push({name: c.name, fields: fs});
        }
        return sections.map(s => `<div class="ed-section">${s.name ? `<h4>${e(s.name)}</h4>` : ''}<div class="ed-grid">
            ${s.fields.map(f => fieldHTML(f, typeof scope[f.name] === 'undefined' ? clone(f.default) : scope[f.name], [...basePath, f.name], scope)).join('')}
        </div></div>`).join('');
    }

    function elementTitle(f, el, i) {
        const candidate = f.fields.find(x => x.type === 'string' && typeof el[x.name] === 'string' && el[x.name].trim() && el[x.name].length < 80);
        if (candidate) return el[candidate.name];
        const chan = f.fields.find(x => x.type === 'channelID' && el[x.name]);
        if (chan) return channelName(el[chan.name]);
        return `${f.elementName.one} ${i + 1}`;
    }

    function elementsHTML(f) {
        const list = draft();
        const toggle = f.fields.find(x => x.elementToggle);
        return `<div class="el-head"><span class="muted">${list.length} ${e(list.length === 1 ? f.elementName.one : f.elementName.more)}</span>
                <button type="button" class="btn btn-primary btn-sm" data-el-add>${icon('plus')}${e(f.elementName.one)} hinzufügen</button></div>
            ${list.length ? '' : `<div class="card empty"><span class="stat-icon">${icon('clipboard')}</span><h3>Noch keine ${e(f.elementName.more)}</h3><p>Lege den ersten Eintrag an.</p></div>`}
            ${list.map((el, i) => `<div class="card ed-el${ed.open.has(i) ? ' open' : ''}">
                <div class="ed-el-head" data-el-toggle="${i}">
                    <span class="ed-el-chevron">${icon('chevron')}</span>
                    <strong>${window.renderEmojis(e(elementTitle(f, el, i)))}</strong>
                    <span class="ed-el-actions">
                        ${toggle ? `<span class="switch" title="Aktiv"><input type="checkbox" data-p="${reg([i, toggle.name])}" data-kind="bool" ${el[toggle.name] ? 'checked' : ''}><span class="track"></span></span>` : ''}
                        <button type="button" class="icon-btn icon-btn-sm" data-el-dup="${i}" title="Duplizieren">${icon('clipboard')}</button>
                        <button type="button" class="icon-btn icon-btn-sm" data-el-del="${i}" title="Löschen">${icon('trash')}</button>
                    </span>
                </div>
                ${ed.open.has(i) ? `<div class="ed-el-body">${fieldsHTML(f.fields.filter(x => !x.elementToggle), el, [i], f.categories)}</div>` : ''}
            </div>`).join('')}`;
    }

    /* ---------- Render ---------- */

    function render() {
        const f = file();
        ed.paths = [];
        const container = ed.ctx.container;
        const bodyHTML = f.configElements ? elementsHTML(f) : fieldsHTML(f.fields, draft(), [], f.categories);
        container.innerHTML = `
            <div class="ed-top">
                <a class="btn btn-ghost btn-sm" href="${e(ed.ctx.backHref || '#/')}">${icon('back')}${e(ed.ctx.moduleLabel)}</a>
            </div>
            ${ed.files.length > 1 && !ed.ctx.fileName ? `<div class="chips ed-files">${ed.files.map((x, i) => `<button type="button" class="chip${i === ed.fileIdx ? ' active' : ''}" data-file="${i}">${e(x.humanName)}${ed.dirty.has(i) ? ' •' : ''}</button>`).join('')}</div>` : ''}
            <div class="card ed-card">
                <div class="card-head"><div><h3>${icon('pencil')}${e(f.humanName)}</h3>${f.description ? `<small class="muted">${e(f.description)}</small>` : ''}</div></div>
                <div class="card-pad">
                    ${f.warning ? `<div class="reason">${icon('alert')}<span>${e(f.warning)}</span></div>` : ''}
                    ${f.exists ? '' : `<div class="notice">${icon('info')}<span>Der Bot hat diese Datei noch nicht angelegt – es werden die Standardwerte angezeigt. Beim Speichern wird sie erstellt.</span></div>`}
                    ${ed.guild ? '' : `<div class="notice">${icon('info')}<span>Kanal- und Rollenauswahl erscheint, sobald der Bot einmal gelaufen ist. Bis dahin kannst du IDs eintragen.</span></div>`}
                    ${bodyHTML}
                </div>
            </div>
            <div id="ed-savebar"></div>
            <datalist id="tz-list">${(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map(t => `<option value="${t}">`).join('')}</datalist>`;
        renderSavebar();
    }

    function renderSavebar() {
        const bar = document.getElementById('ed-savebar');
        if (!bar) return;
        bar.innerHTML = ed.dirty.has(ed.fileIdx) ? `<div class="savebar">
            <span><strong>Ungespeicherte Änderungen</strong> in „${e(file().humanName)}“</span>
            <div class="actions"><button type="button" class="btn btn-ghost" data-ed-reset>Verwerfen</button><button type="button" class="btn" data-ed-save>${icon('save')}Speichern</button></div>
        </div>` : '';
    }

    function markDirty() {
        if (!ed.dirty.has(ed.fileIdx)) {
            ed.dirty.add(ed.fileIdx);
            renderSavebar();
            const chip = document.querySelector(`[data-file="${ed.fileIdx}"]`);
            if (chip && !chip.textContent.endsWith('•')) chip.textContent = `${chip.textContent} •`;
        }
    }

    function updatePreview(entry) {
        if (typeof entry.preview !== 'number') return;
        const root = ed.paths[entry.preview];
        const el = document.querySelector(`[data-preview="${entry.preview}"]`);
        if (root && el) el.innerHTML = previewHTML(getAt(draft(), root.path));
    }

    /* ---------- Events ---------- */

    function readControl(el) {
        const kind = el.getAttribute('data-kind');
        if (kind === 'bool') return el.checked;
        if (kind === 'num') return el.value === '' ? null : Number(el.value);
        return el.value;
    }

    function onInput(ev) {
        const el = ev.target;
        if (el.hasAttribute('data-p')) {
            const entry = ed.paths[Number(el.getAttribute('data-p'))];
            if (!entry) return;
            if (el.getAttribute('data-kind') === 'json') {
                try {
                    setAt(draft(), entry.path, JSON.parse(el.value));
                    el.classList.remove('invalid');
                } catch {
                    el.classList.add('invalid');
                    return;
                }
            } else {
                setAt(draft(), entry.path, readControl(el));
            }
            markDirty();
            updatePreview(entry);
            if (ev.type === 'change' && entry.rerender) render();
            const emojiPreview = el.parentElement && el.parentElement.querySelector('.emoji-preview');
            if (emojiPreview) emojiPreview.innerHTML = window.renderEmojis(e(el.value));
            return;
        }
        const keyed = el.closest('[data-keyed]');
        if (keyed) rebuildKeyed(keyed);
    }

    function rebuildKeyed(container) {
        const entry = ed.paths[Number(container.getAttribute('data-keyed'))];
        const out = {};
        for (const row of container.querySelectorAll(':scope > .kv-row')) {
            const k = row.querySelector('.kv-key').value.trim();
            const v = row.querySelector('.kv-val').value;
            if (!k) continue;
            out[k] = ['integer', 'float'].includes(entry.keyed.value) && v !== '' ? Number(v) : v;
        }
        setAt(draft(), entry.path, out);
        markDirty();
    }

    function insertAtCursor(target, textValue) {
        const remembered = ed.lastFocus === target;
        target.focus();
        const start = remembered && typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
        const end = remembered && typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
        target.setRangeText(textValue, start, end, 'end');
        target.dispatchEvent(new Event('input', {bubbles: true}));
    }

    function addArrayItem(handle, raw) {
        const entry = ed.paths[handle];
        if (raw === '' || raw === null) return;
        const value = ['integer', 'float'].includes(entry.array) ? Number(raw) : raw;
        const list = getAt(draft(), entry.path) || [];
        list.push(value);
        setAt(draft(), entry.path, list);
        markDirty();
        render();
    }

    function newElement() {
        const el = {};
        for (const f of file().fields) el[f.name] = clone(f.default);
        return el;
    }

    function changeMode(rootHandle, mode) {
        const entry = ed.paths[rootHandle];
        const current = getAt(draft(), entry.path);
        if (mode === 'embed' && typeof current !== 'object') setAt(draft(), entry.path, {description: current || '', color: '#5865f2'});
        else if (mode === 'text' && current && typeof current === 'object') setAt(draft(), entry.path, current.description || current.message || current.content || '');
        markDirty();
        render();
    }

    function onClick(ev) {
        const t = ev.target;
        function pick(sel) {
            return t.closest(sel);
        }
        let x;
        if ((x = pick('[data-file]'))) {
            ed.fileIdx = Number(x.getAttribute('data-file'));
            ed.open.clear();
            render();
        } else if ((x = pick('[data-insert]'))) {
            const target = document.querySelector(`[data-p="${x.getAttribute('data-target')}"]`);
            if (target) insertAtCursor(target, x.getAttribute('data-insert'));
        } else if ((x = pick('[data-emoji]'))) {
            const target = document.querySelector(`[data-p="${x.getAttribute('data-emoji')}"]`);
            const markup = x.hasAttribute('data-markup');
            openEmojiPicker((code) => {
                if (!target) return;
                if (markup) {
                    target.value = code;
                    target.dispatchEvent(new Event('input', {bubbles: true}));
                } else insertAtCursor(target, code);
            }, markup);
        } else if ((x = pick('[data-arr-emoji]'))) {
            const handle = Number(x.getAttribute('data-arr-emoji'));
            openEmojiPicker(code => addArrayItem(handle, code), true);
        } else if ((x = pick('[data-mode][data-root]'))) {
            changeMode(Number(x.getAttribute('data-root')), x.getAttribute('data-mode'));
        } else if ((x = pick('[data-arr-remove]'))) {
            const entry = ed.paths[Number(x.getAttribute('data-arr-remove'))];
            const list = getAt(draft(), entry.path) || [];
            list.splice(Number(x.getAttribute('data-i')), 1);
            markDirty();
            render();
        } else if ((x = pick('[data-arr-add]'))) {
            const input = document.querySelector(`[data-arr-input="${x.getAttribute('data-arr-add')}"]`);
            addArrayItem(Number(x.getAttribute('data-arr-add')), input ? input.value.trim() : '');
        } else if ((x = pick('[data-kv-add]'))) {
            const container = x.closest('[data-keyed]');
            x.insertAdjacentHTML('beforebegin', container.querySelector('template').innerHTML);
        } else if ((x = pick('[data-kv-remove]'))) {
            const container = x.closest('[data-keyed]');
            x.closest('.kv-row').remove();
            rebuildKeyed(container);
        } else if ((x = pick('[data-embed-field-add]'))) {
            const entry = ed.paths[Number(x.getAttribute('data-embed-field-add'))];
            const v = getAt(draft(), entry.path) || {};
            v.fields = [...(v.fields || []), {name: '', value: '', inline: false}];
            setAt(draft(), entry.path, v);
            markDirty();
            render();
        } else if ((x = pick('[data-embed-field-remove]'))) {
            const entry = ed.paths[Number(x.getAttribute('data-embed-field-remove'))];
            const v = getAt(draft(), entry.path);
            v.fields.splice(Number(x.getAttribute('data-i')), 1);
            markDirty();
            render();
        } else if (pick('[data-el-add]')) {
            draft().push(newElement());
            ed.open.add(draft().length - 1);
            markDirty();
            render();
        } else if ((x = pick('[data-el-dup]'))) {
            const i = Number(x.getAttribute('data-el-dup'));
            draft().splice(i + 1, 0, clone(draft()[i]));
            markDirty();
            render();
        } else if ((x = pick('[data-el-del]'))) {
            draft().splice(Number(x.getAttribute('data-el-del')), 1);
            ed.open.clear();
            markDirty();
            render();
        } else if ((x = pick('[data-el-toggle]')) && !pick('.ed-el-actions')) {
            const i = Number(x.getAttribute('data-el-toggle'));
            if (ed.open.has(i)) ed.open.delete(i);
            else ed.open.add(i);
            render();
        } else if (pick('[data-ed-reset]')) {
            ed.drafts[ed.fileIdx] = clone(file().value);
            ed.dirty.delete(ed.fileIdx);
            render();
        } else if (pick('[data-ed-save]')) {
            save();
        }
    }

    function onChange(ev) {
        const t = ev.target;
        if (t.hasAttribute('data-arr-add-select')) {
            addArrayItem(Number(t.getAttribute('data-arr-add-select')), t.value);
            return;
        }
        onInput(ev);
    }

    function onKeydown(ev) {
        if (ev.key === 'Enter' && ev.target.hasAttribute('data-arr-input')) {
            ev.preventDefault();
            addArrayItem(Number(ev.target.getAttribute('data-arr-input')), ev.target.value.trim());
        }
    }

    async function save() {
        const f = file();
        try {
            const res = await ed.ctx.api('PUT', `/api/bots/${ed.ctx.botId}/content/${ed.ctx.moduleName}/${encodeURIComponent(f.filename)}`, {value: draft()});
            ed.files = res.files;
            ed.drafts[ed.fileIdx] = clone(ed.files[ed.fileIdx].value);
            ed.dirty.delete(ed.fileIdx);
            ed.ctx.toast(ed.ctx.running ? 'Gespeichert – der Bot lädt die Konfiguration neu' : 'Gespeichert – wird beim nächsten Start übernommen');
            render();
        } catch (err) {
            ed.ctx.toast(err.message, true);
        }
    }

    /**
     * Opens the editor for one module.
     * @param {Object} ctx {container, botId, botName, moduleName, moduleLabel, running, api, toast, esc}
     */
    async function openContentEditor(ctx) {
        ed.ctx = ctx;
        ctx.container.innerHTML = '<div class="empty muted">Lade Inhalte…</div>';
        const [data, guild] = await Promise.all([
            ctx.api('GET', `/api/bots/${ctx.botId}/content/${ctx.moduleName}`),
            ctx.guildData ? Promise.resolve(ctx.guildData) : ctx.api('GET', `/api/bots/${ctx.botId}/guild`).catch(() => ({})),
            loadEmojiMeta()
        ]);
        ed.files = data.files;
        ed.drafts = ed.files.map(f => clone(f.value));
        ed.dirty = new Set();
        ed.open = new Set();
        ed.fileIdx = Math.max(0, ed.files.findIndex(f => f.filename === ctx.fileName));
        ed.guild = guild && guild.channels ? guild : null;
        if (!ed.files.length) {
            ctx.container.innerHTML = '<div class="card empty"><h3>Keine Inhalte</h3><p>Dieses Modul hat keine bearbeitbaren Einstellungen.</p></div>';
            return;
        }
        const c = ctx.container;
        c.oninput = onInput;
        c.onchange = onChange;
        c.onclick = onClick;
        c.onkeydown = onKeydown;
        c.addEventListener('focusin', (ev) => {
            if (ev.target.matches('textarea, input')) ed.lastFocus = ev.target;
        });
        render();
    }

    function hasUnsavedContent() {
        return ed.dirty.size > 0;
    }

    window.openContentEditor = openContentEditor;
    window.hasUnsavedContent = hasUnsavedContent;
}());
