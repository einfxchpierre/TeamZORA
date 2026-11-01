/**
 * TeamZORA custom emojis.
 *
 * - Imports the emoji set from /emojis/png into the bot application (application emojis, so they work on
 *   every server and do not use up server emoji slots). Runs in the background after login and is idempotent.
 * - Rewrites every outgoing message: standard Unicode emojis from /emojis/mapping.json and shortcodes like
 *   :z_check_green: become the custom emojis. Places where Discord cannot render custom emojis (embed titles,
 *   footers, button labels, ...) get the emoji moved into the component's emoji slot or removed.
 * - Writes data/emojis.json (import status) and data/guild-cache.json (channels/roles) for the dashboard.
 * Disable with "useCustomEmojis": false in config.json.
 * @module CustomEmojis
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const EMOJI_DIR = path.join(ROOT, 'emojis');

const state = {
    enabled: true,
    byName: new Map(),
    syncing: false,
    lastError: null,
    installed: false
};

let manifest = {emojis: []};
let mapping = {};
try {
    manifest = JSON.parse(fs.readFileSync(path.join(EMOJI_DIR, 'manifest.json'), 'utf8'));
    mapping = JSON.parse(fs.readFileSync(path.join(EMOJI_DIR, 'mapping.json'), 'utf8'));
} catch {
    manifest = {emojis: []};
    mapping = {};
}

const mappingByKey = new Map(Object.entries(mapping).map(([k, v]) => [k.replace(/️/g, ''), v]));

/**
 * Escapes a string for use in a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every mapped emoji, longest first, with optional variation selectors (U+FE0F) between and after code points
const UNICODE_PATTERN = new RegExp(
    [...mappingByKey.keys()]
        .sort((a, b) => b.length - a.length)
        .map(k => [...k].map(escapeRegex).join('\\uFE0F?') + '\\uFE0F?')
        .join('|'),
    'gu'
);
const SHORTCODE_PATTERN = /(?<!<a?):(?<name>z_[a-z0-9_]+):(?!\d+>)/g;

/**
 * Whether the replacement layer is active (enabled and at least one emoji imported).
 * @returns {boolean}
 */
function isActive() {
    return state.enabled && state.byName.size > 0;
}

/**
 * @param {string} unicode Emoji as found in a text
 * @returns {Object|null} Imported emoji for it
 */
function emojiForUnicode(unicode) {
    const name = mappingByKey.get(unicode.replace(/️/g, ''));
    return name ? state.byName.get(name) || null : null;
}

/**
 * @param {{id: string, name: string, animated: boolean}} e
 * @returns {string} Message markup
 */
function markup(e) {
    return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
}

/**
 * Replaces mapped emojis and shortcodes in a text with custom emoji markup.
 * @param {string} text
 * @param {number} [limit] Maximum length; if the result would be longer, emojis are removed instead
 * @returns {string}
 */
function renderText(text, limit) {
    if (typeof text !== 'string' || !text || !isActive()) return text;
    const result = text
        .replace(UNICODE_PATTERN, (m) => {
            const e = emojiForUnicode(m);
            return e ? markup(e) : m;
        })
        .replace(SHORTCODE_PATTERN, (m, name) => {
            const e = state.byName.get(name);
            return e ? markup(e) : m;
        });
    if (limit && result.length > limit) return stripText(text);
    return result;
}

/**
 * Removes mapped emojis and shortcodes from a text (for places where Discord does not render custom emojis).
 * @param {string} text
 * @returns {string}
 */
function stripText(text) {
    if (typeof text !== 'string' || !text || !isActive()) return text;
    return removeEmojis(text) || text;
}

/**
 * Removes mapped emojis and shortcodes; may return an empty string.
 * @param {string} text
 * @returns {string}
 */
function removeEmojis(text) {
    return text
        .replace(new RegExp(`(?:${UNICODE_PATTERN.source})\\s?`, 'gu'), (m) => (emojiForUnicode(m.trim()) ? '' : m))
        .replace(/(?<!<a?):(?<name>z_[a-z0-9_]+):(?!\d+>)\s?/g, (m, name) => (state.byName.has(name) ? '' : m))
        .trim();
}

/**
 * Finds the first mapped emoji or shortcode in a text.
 * @param {string} text
 * @returns {Object|null}
 */
function firstEmoji(text) {
    if (typeof text !== 'string') return null;
    const candidates = [];
    for (const m of text.matchAll(UNICODE_PATTERN)) {
        const e = emojiForUnicode(m[0]);
        if (e) candidates.push({index: m.index, e});
    }
    for (const m of text.matchAll(SHORTCODE_PATTERN)) {
        const e = state.byName.get(m.groups.name);
        if (e) candidates.push({index: m.index, e});
    }
    candidates.sort((a, b) => a.index - b.index);
    return candidates.length ? candidates[0].e : null;
}

/**
 * Converts a component emoji object ({name: '✅'}) to the custom emoji.
 * @param {Object} emoji
 * @returns {Object}
 */
function mapEmojiObject(emoji) {
    if (!emoji || emoji.id || typeof emoji.name !== 'string') return emoji;
    const e = emojiForUnicode(emoji.name);
    return e ? {id: e.id, name: e.name, animated: !!e.animated} : emoji;
}

/**
 * Buttons and select options cannot render emojis in labels: move the first one into the emoji slot.
 * @param {Object} obj Button or select option JSON
 */
function fixLabel(obj) {
    if (obj.emoji) obj.emoji = mapEmojiObject(obj.emoji);
    if (typeof obj.label !== 'string') return;
    if (!obj.emoji) {
        const e = firstEmoji(obj.label);
        if (e) obj.emoji = {id: e.id, name: e.name, animated: !!e.animated};
    }
    const label = removeEmojis(obj.label);
    if (label === obj.label) return;
    if (label) obj.label = label;
    else if (obj.emoji && obj.emoji.id) delete obj.label;
}

/**
 * Walks component JSON (classic action rows and Components V2) and fixes every emoji.
 * @param {Object} comp
 */
function transformComponent(comp) {
    if (!comp || typeof comp !== 'object') return;
    if (comp.type === 10 && typeof comp.content === 'string') comp.content = renderText(comp.content, 4000);
    if (comp.type === 2) fixLabel(comp);
    if (Array.isArray(comp.options)) {
        for (const option of comp.options) {
            fixLabel(option);
            if (typeof option.description === 'string') option.description = stripText(option.description);
        }
    }
    if (typeof comp.placeholder === 'string') comp.placeholder = stripText(comp.placeholder);
    if (Array.isArray(comp.components)) comp.components.forEach(transformComponent);
    if (comp.accessory) transformComponent(comp.accessory);
}

/**
 * Rewrites a resolved message body in place.
 * @param {Object} body
 */
function transformBody(body) {
    if (typeof body.content === 'string') body.content = renderText(body.content, 2000);
    if (Array.isArray(body.embeds)) {
        for (const embed of body.embeds) {
            if (!embed) continue;
            if (embed.description) embed.description = renderText(embed.description, 4096);
            if (embed.title) embed.title = stripText(embed.title);
            if (embed.footer && embed.footer.text) embed.footer.text = stripText(embed.footer.text);
            if (embed.author && embed.author.name) embed.author.name = stripText(embed.author.name);
            for (const field of embed.fields || []) {
                if (field.name) field.name = stripText(field.name);
                if (field.value) field.value = renderText(field.value, 1024);
            }
        }
    }
    if (Array.isArray(body.components)) body.components.forEach(transformComponent);
}

/**
 * Hooks the replacement layer into discord.js. Every send/reply/edit/followUp/webhook goes through
 * MessagePayload#resolveBody.
 * @param {Object} Discord discord.js exports
 */
function install(Discord) {
    if (state.installed || !Discord.MessagePayload) return;
    state.installed = true;
    const original = Discord.MessagePayload.prototype.resolveBody;
    Discord.MessagePayload.prototype.resolveBody = function resolveBody(...args) {
        const result = original.apply(this, args);
        try {
            if (this.body && isActive()) transformBody(this.body);
        } catch {
            // Never block a message because of emoji rewriting
        }
        return result;
    };
}

/**
 * Writes the import status for the dashboard.
 * @param {Client} client
 */
function writeStatus(client) {
    if (!client.dataDir) return;
    const data = {
        enabled: state.enabled,
        syncing: state.syncing,
        total: manifest.emojis.length,
        imported: state.byName.size,
        lastError: state.lastError,
        updatedAt: new Date().toISOString(),
        emojis: Object.fromEntries([...state.byName.values()].map(e => [e.name, e.id]))
    };
    try {
        fs.writeFileSync(path.join(client.dataDir, 'emojis.json'), JSON.stringify(data));
    } catch (e) {
        client.logger.warn(`[emojis] Status konnte nicht gespeichert werden: ${e.message}`);
    }
}

/**
 * Imports missing emojis into the bot application.
 * @param {Client} client
 * @returns {Promise<void>}
 */
async function sync(client) {
    state.enabled = client.config.useCustomEmojis !== false;
    if (!state.enabled || state.syncing) {
        writeStatus(client);
        return;
    }
    state.syncing = true;
    state.lastError = null;
    try {
        const existing = await client.application.emojis.fetch();
        state.byName.clear();
        for (const e of existing.values()) {
            if (e.name && e.name.startsWith('z_')) state.byName.set(e.name, {id: e.id, name: e.name, animated: !!e.animated});
        }
        writeStatus(client);
        const missing = manifest.emojis.filter(e => !state.byName.has(e.name));
        if (missing.length) client.logger.info(`[emojis] Importiere ${missing.length} eigene Emojis in den Bot (läuft im Hintergrund)…`);
        let done = 0;
        for (const e of missing) {
            const file = path.join(EMOJI_DIR, 'png', `${e.name}.png`);
            if (!fs.existsSync(file)) continue;
            try {
                const created = await client.application.emojis.create({attachment: file, name: e.name});
                state.byName.set(created.name, {id: created.id, name: created.name, animated: false});
            } catch (err) {
                state.lastError = err.message;
                client.logger.warn(`[emojis] ${e.name} konnte nicht importiert werden: ${err.message}`);
                if (err.code === 30018 || err.code === 30008) break; // emoji limit reached
            }
            done = done + 1;
            if (done % 25 === 0) {
                writeStatus(client);
                client.logger.info(`[emojis] ${done}/${missing.length} importiert`);
            }
        }
        client.logger.info(`[emojis] ${state.byName.size}/${manifest.emojis.length} eigene Emojis verfügbar.`);
    } catch (e) {
        state.lastError = e.message;
        client.logger.warn(`[emojis] Synchronisierung fehlgeschlagen: ${e.message}`);
    } finally {
        state.syncing = false;
        writeStatus(client);
    }
}

/**
 * Removes all imported z_ emojis from the application (used before a re-import).
 * @param {Client} client
 * @returns {Promise<number>} Number of deleted emojis
 */
async function removeAll(client) {
    const existing = await client.application.emojis.fetch();
    let removed = 0;
    for (const e of existing.values()) {
        if (!e.name || !e.name.startsWith('z_')) continue;
        await e.delete().catch(() => null);
        removed = removed + 1;
    }
    state.byName.clear();
    writeStatus(client);
    return removed;
}

/**
 * Writes channels and roles of the server so the dashboard can show pickers.
 * @param {Client} client
 */
function writeGuildCache(client) {
    if (!client.dataDir || !client.guild) return;
    const guild = client.guild;
    const data = {
        updatedAt: new Date().toISOString(),
        guild: {id: guild.id, name: guild.name, icon: guild.iconURL ? guild.iconURL({size: 128}) : null},
        channels: [...guild.channels.cache.values()]
            .filter(c => !c.isThread || !c.isThread())
            .map(c => ({id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, position: c.rawPosition || 0}))
            .sort((a, b) => a.position - b.position),
        roles: [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({id: r.id, name: r.name, color: r.hexColor, position: r.position, managed: r.managed}))
            .sort((a, b) => b.position - a.position)
    };
    try {
        fs.writeFileSync(path.join(client.dataDir, 'guild-cache.json'), JSON.stringify(data));
    } catch (e) {
        client.logger.warn(`[dashboard] Server-Cache konnte nicht gespeichert werden: ${e.message}`);
    }
}

/**
 * Writes the registered slash/context commands for the dashboard's command list.
 * @param {Client} client
 */
function writeCommands(client) {
    if (!client.dataDir || !Array.isArray(client.commands)) return;
    const list = client.commands.map(c => ({
        name: c.name,
        description: typeof c.description === 'string' ? c.description : '',
        module: c.module || null,
        contextMenu: !!c.contextMenu,
        type: c.type || null,
        options: (Array.isArray(c.options) ? c.options : []).map(o => ({name: o.name, description: o.description || '', type: o.type, required: !!o.required}))
    }));
    try {
        fs.writeFileSync(path.join(client.dataDir, 'commands.json'), JSON.stringify(list));
    } catch (e) {
        client.logger.warn(`[dashboard] Befehlsliste konnte nicht gespeichert werden: ${e.message}`);
    }
}

/**
 * Starts emoji import and keeps the guild cache up to date.
 * @param {Client} client
 */
function init(client) {
    writeGuildCache(client);
    writeCommands(client);
    let timer = null;
    function refresh() {
        clearTimeout(timer);
        timer = setTimeout(() => writeGuildCache(client), 3000);
    }
    for (const event of ['channelCreate', 'channelDelete', 'channelUpdate', 'roleCreate', 'roleDelete', 'roleUpdate', 'guildUpdate']) {
        client.on(event, refresh);
    }
    sync(client).catch(() => null);
}

module.exports = {
    install,
    init,
    sync,
    removeAll,
    renderText,
    stripText,
    transformBody,
    isActive,
    state
};
