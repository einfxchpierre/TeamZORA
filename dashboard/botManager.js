/*
 * Supervises one CustomDCBot process per configured bot. Every bot gets its own config and data
 * directory (main.js <configDir> <dataDir>), so several bots for different servers run side by side.
 * Exit codes follow src/functions/exitCodes.js: 64/65/66/78 are fatal and never restarted.
 */
const {spawn} = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {EventEmitter} = require('events');
const moduleConfig = require('./moduleConfig');

const ROOT = path.resolve(__dirname, '..');
const MAIN_FILE = path.join(ROOT, 'main.js');
const LOG_LIMIT = 1000;
const FATAL_CODES = {
    64: 'Ungültiger oder fehlender Bot-Token',
    65: 'Benötigte Privileged Intents sind im Developer-Portal nicht aktiviert',
    66: 'Der Bot wurde vom Server entfernt',
    78: 'Konfigurationsfehler – bitte Einstellungen prüfen'
};
const LANGUAGES = ['de', 'en'];
const READY_MARKERS = LANGUAGES
    .map(l => readJSON(path.join(ROOT, 'locales', `${l}.json`), {main: {}}).main['bot-ready'])
    .filter(Boolean);
const SECRET_FIELDS = ['token'];
const FALLBACK_LABELS = {
    token: 'Bot-Token',
    guildID: 'Server-ID (Guild ID)',
    botOperators: 'Bot-Operatoren (User-IDs)'
};

/**
 * Picks the English text of a localized schema value, falling back when it is empty.
 * @param {*} value String or {en: ...} object
 * @param {string} fallback
 * @returns {string}
 */
function localized(value, fallback) {
    const text = (value && typeof value === 'object') ? value.en : value;
    return text || fallback;
}

/**
 * Reads a JSON file, returning a fallback when it is missing or invalid.
 * @param {string} file
 * @param {*} fallback
 * @returns {*}
 */
function readJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

/**
 * Writes JSON atomically (temp file + rename) so a crash never leaves a half-written config.
 * @param {string} file
 * @param {*} data
 */
function writeJSON(file, data) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

/**
 * Returns the default values of config-generator/config.json (same logic as generate-config.js).
 * @returns {Object}
 */
function defaultBotConfig() {
    const example = readJSON(path.join(ROOT, 'config-generator', 'config.json'), {content: []});
    const config = {};
    for (const field of example.content) {
        if (!field.name) continue;
        const def = field.default;
        config[field.name] = (typeof def === 'object' && def !== null && 'en' in def) ? def.en : def;
    }
    return config;
}

/**
 * Returns the config-generator schema (field metadata) for the settings form.
 * @returns {Array<Object>}
 */
function configSchema() {
    const example = readJSON(path.join(ROOT, 'config-generator', 'config.json'), {content: []});
    return example.content.filter(f => f.name).map(f => ({
        name: f.name,
        humanName: FALLBACK_LABELS[f.name] || localized(f.humanName, f.name),
        description: localized(f.description, ''),
        type: f.type,
        content: f.content || null,
        hidden: !!f.hidden,
        secret: SECRET_FIELDS.includes(f.name)
    }));
}

/**
 * Lists all modules shipped in /modules with their metadata.
 * @returns {Array<Object>}
 */
function listAvailableModules() {
    const dir = path.join(ROOT, 'modules');
    let entries = [];
    try {
        entries = fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory());
    } catch {
        return [];
    }
    const modules = [];
    const german = readJSON(path.join(__dirname, 'labels.de.json'), {}).__modules || {}; // eslint-disable-line no-underscore-dangle
    for (const entry of entries) {
        const meta = readJSON(path.join(dir, entry.name, 'module.json'), null);
        if (!meta) continue;
        const englishName = (typeof meta.humanReadableName === 'object' ? meta.humanReadableName.en : meta.humanReadableName) || meta.name || entry.name;
        const de = german[englishName];
        modules.push({
            name: meta.name || entry.name,
            humanName: de ? de[0] : englishName,
            description: de ? de[1] : (typeof meta.description === 'object' ? meta.description.en : meta.description) || '',
            tags: meta.tags || [],
            beta: !!meta.beta
        });
    }
    return modules.sort((a, b) => a.humanName.localeCompare(b.humanName));
}

/**
 * Resident memory of a process in bytes (Linux only, null elsewhere).
 * @param {number} pid
 * @returns {number|null}
 */
function processMemory(pid) {
    try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const match = status.match(/VmRSS:\s+(?<kb>\d+)\s+kB/);
        return match ? Number(match.groups.kb) * 1024 : null;
    } catch {
        return null;
    }
}

/**
 * @param {Object} entry Persisted bot entry
 * @returns {Object} Runtime state
 */
function createRuntime(entry) {
    return {
        entry,
        process: null,
        status: 'stopped',
        statusReason: null,
        startedAt: null,
        readyAt: null,
        lastExitCode: null,
        restarts: 0,
        restartTimer: null,
        stopRequested: false,
        logs: [],
        logSeq: 0
    };
}

/**
 * Replaces the old SCNX footer defaults in an existing strings.json.
 * @param {string} configDir
 */
function removeLegacyBranding(configDir) {
    const file = path.join(configDir, 'strings.json');
    const strings = readJSON(file, null);
    if (!strings) return;
    let changed = false;
    if (typeof strings.footer === 'string' && strings.footer.toLowerCase().includes('scnx')) {
        strings.footer = 'Powered by TeamZORA';
        changed = true;
    }
    if (typeof strings.footerImgUrl === 'string' && strings.footerImgUrl.includes('scnx.xyz')) {
        strings.footerImgUrl = '';
        changed = true;
    }
    if (changed) writeJSON(file, strings);
}

/**
 * Supervisor for all bots.
 */
class BotManager extends EventEmitter {

    /**
     * @param {string} storageDir Directory holding bots.json and one folder per bot
     */
    constructor(storageDir) {
        super();
        this.storageDir = storageDir;
        this.registryFile = path.join(storageDir, 'bots.json');
        this.bots = new Map();
        fs.mkdirSync(storageDir, {recursive: true});
        for (const entry of readJSON(this.registryFile, [])) {
            this.bots.set(entry.id, createRuntime(entry));
        }
    }

    persist() {
        writeJSON(this.registryFile, [...this.bots.values()].map(b => b.entry));
    }

    botDir(id) {
        return path.join(this.storageDir, id);
    }

    configDir(id) {
        return path.join(this.botDir(id), 'config');
    }

    dataDir(id) {
        return path.join(this.botDir(id), 'data');
    }

    /**
     * @param {string} id
     * @returns {Object}
     */
    get(id) {
        const bot = this.bots.get(id);
        if (!bot) {
            const err = new Error('Bot nicht gefunden');
            err.status = 404;
            throw err;
        }
        return bot;
    }

    /**
     * Public, serialisable summary of a bot.
     * @param {Object} bot Runtime state
     * @returns {Object}
     */
    summary(bot) {
        const config = readJSON(path.join(this.configDir(bot.entry.id), 'config.json'), {});
        const modules = readJSON(path.join(this.configDir(bot.entry.id), 'modules.json'), {});
        return {
            id: bot.entry.id,
            name: bot.entry.name,
            color: bot.entry.color,
            autoStart: !!bot.entry.autoStart,
            autoRestart: bot.entry.autoRestart !== false,
            language: bot.entry.language || 'de',
            createdAt: bot.entry.createdAt,
            guildID: config.guildID || '',
            prefix: config.prefix || '',
            status: bot.status,
            statusReason: bot.statusReason,
            pid: bot.process ? bot.process.pid : null,
            startedAt: bot.startedAt,
            readyAt: bot.readyAt,
            lastExitCode: bot.lastExitCode,
            restarts: bot.restarts,
            memory: bot.process ? processMemory(bot.process.pid) : null,
            enabledModules: Object.keys(modules).filter(m => modules[m]).length,
            hasToken: !!config.token && config.token !== 'yourtokengoeshere'
        };
    }

    list() {
        return [...this.bots.values()].map(b => this.summary(b));
    }

    /**
     * Creates a new bot with its own config/data directory.
     * @param {Object} input
     * @returns {Object} Summary
     */
    create(input) {
        const name = String(input.name || '').trim().slice(0, 64);
        if (!name) throw Object.assign(new Error('Name ist erforderlich'), {status: 400});
        const id = crypto.randomBytes(6).toString('hex');
        const entry = {
            id,
            name,
            color: input.color || '#ffffff',
            autoStart: !!input.autoStart,
            autoRestart: input.autoRestart !== false,
            language: LANGUAGES.includes(input.language) ? input.language : 'de',
            createdAt: new Date().toISOString()
        };
        const config = {...defaultBotConfig(), ...moduleConfig.coreConfigDefaults(entry.language)};
        for (const key of ['token', 'guildID', 'prefix', 'logChannelID', 'timezone', 'user_presence']) {
            if (typeof input[key] === 'string' && input[key].trim() !== '') config[key] = input[key].trim();
        }
        writeJSON(path.join(this.configDir(id), 'config.json'), config);
        const modules = {};
        for (const m of listAvailableModules()) modules[m.name] = Array.isArray(input.modules) && input.modules.includes(m.name);
        writeJSON(path.join(this.configDir(id), 'modules.json'), modules);
        fs.mkdirSync(this.dataDir(id), {recursive: true});
        const bot = createRuntime(entry);
        this.bots.set(id, bot);
        this.persist();
        this.pushLog(bot, 'system', `Bot "${name}" wurde angelegt.`);
        this.emitUpdate(bot);
        return this.summary(bot);
    }

    /**
     * Full details for the bot page; secrets are masked.
     * @param {string} id
     * @returns {Object}
     */
    details(id) {
        const bot = this.get(id);
        const config = readJSON(path.join(this.configDir(id), 'config.json'), {});
        for (const key of SECRET_FIELDS) {
            if (config[key]) config[key] = '';
        }
        return {
            ...this.summary(bot),
            config,
            modules: readJSON(path.join(this.configDir(id), 'modules.json'), {})
        };
    }

    /**
     * Updates name / restart behaviour.
     * @param {string} id
     * @param {Object} input
     */
    updateSettings(id, input) {
        const bot = this.get(id);
        if (typeof input.name === 'string' && input.name.trim()) bot.entry.name = input.name.trim().slice(0, 64);
        if (typeof input.color === 'string' && (/^#[0-9a-f]{6}$/i).test(input.color)) bot.entry.color = input.color;
        if (typeof input.autoStart === 'boolean') bot.entry.autoStart = input.autoStart;
        if (typeof input.autoRestart === 'boolean') bot.entry.autoRestart = input.autoRestart;
        if (LANGUAGES.includes(input.language)) bot.entry.language = input.language;
        this.persist();
        this.emitUpdate(bot);
    }

    /**
     * Updates config.json. Only keys from the schema are accepted; empty secret fields keep their value.
     * @param {string} id
     * @param {Object} input
     */
    updateConfig(id, input) {
        const bot = this.get(id);
        const file = path.join(this.configDir(id), 'config.json');
        const config = readJSON(file, defaultBotConfig());
        for (const field of configSchema()) {
            if (!(field.name in input)) continue;
            const value = input[field.name];
            if (field.secret && (typeof value !== 'string' || value.trim() === '')) continue;
            if (field.type === 'boolean') config[field.name] = !!value;
            else if (field.type === 'array') config[field.name] = Array.isArray(value) ? value.map(String).filter(Boolean) : String(value).split(',').map(s => s.trim()).filter(Boolean);
            else config[field.name] = typeof value === 'string' ? value.trim() : value;
        }
        writeJSON(file, config);
        this.pushLog(bot, 'system', 'Einstellungen gespeichert. Starte den Bot neu, damit Token/Intents übernommen werden.');
        this.emitUpdate(bot);
    }

    /**
     * Updates modules.json and asks a running bot to reload its configuration.
     * @param {string} id
     * @param {Object} input Map moduleName -> boolean
     */
    updateModules(id, input) {
        const bot = this.get(id);
        const file = path.join(this.configDir(id), 'modules.json');
        const modules = readJSON(file, {});
        const known = new Set(listAvailableModules().map(m => m.name));
        for (const name of Object.keys(input)) {
            if (known.has(name)) modules[name] = !!input[name];
        }
        writeJSON(file, modules);
        this.pushLog(bot, 'system', 'Module aktualisiert.');
        if (bot.status === 'running') this.sendCommand(id, 'reload');
        this.emitUpdate(bot);
    }

    /**
     * Starts the bot process.
     * @param {string} id
     */
    start(id) {
        const bot = this.get(id);
        if (bot.process) return;
        clearTimeout(bot.restartTimer);
        bot.restartTimer = null;
        bot.stopRequested = false;
        bot.status = 'starting';
        bot.statusReason = null;
        bot.readyAt = null;
        bot.startedAt = new Date().toISOString();
        fs.mkdirSync(this.dataDir(id), {recursive: true});
        removeLegacyBranding(this.configDir(id));
        this.pushLog(bot, 'system', 'Starte Bot…');

        const lang = bot.entry.language || 'de';
        const child = spawn(process.execPath, [MAIN_FILE, this.configDir(id), this.dataDir(id), `--lang=${lang}`], {
            cwd: ROOT,
            env: {...process.env, SCNX_EXIT_CODES: '1'},
            stdio: ['pipe', 'pipe', 'pipe']
        });
        bot.process = child;
        this.attachStream(bot, child.stdout, 'out');
        this.attachStream(bot, child.stderr, 'err');
        child.stdin.on('error', () => null);
        child.on('error', (err) => {
            this.pushLog(bot, 'err', `Prozessfehler: ${err.message}`);
        });
        child.on('exit', (code, signal) => this.handleExit(bot, code, signal));
        this.emitUpdate(bot);
    }

    /**
     * Splits a stream into log lines.
     * @param {Object} bot
     * @param {Stream} stream
     * @param {string} type
     */
    attachStream(bot, stream, type) {
        let buffer = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
            buffer = buffer + chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop();
            for (const line of lines) this.handleLine(bot, line, type);
        });
        stream.on('end', () => {
            if (buffer) this.handleLine(bot, buffer, type);
        });
    }

    handleLine(bot, line, type) {
        if (!line.trim()) return;

        const clean = line.replace(/\u001b\[[0-9;]*m/g, '');
        this.pushLog(bot, type, clean);
        if (bot.status === 'starting' && READY_MARKERS.some(m => clean.includes(m))) {
            bot.status = 'running';
            bot.readyAt = new Date().toISOString();
            bot.restarts = 0;
            this.emitUpdate(bot);
        }
    }

    handleExit(bot, code, signal) {
        bot.process = null;
        bot.lastExitCode = code;
        const uptime = bot.startedAt ? Date.now() - new Date(bot.startedAt).getTime() : 0;
        this.pushLog(bot, 'system', `Prozess beendet (Code ${code === null ? '-' : code}${signal ? `, Signal ${signal}` : ''}).`);

        if (bot.stopRequested || code === 0) {
            bot.status = 'stopped';
            bot.statusReason = null;
        } else if (FATAL_CODES[code]) {
            bot.status = 'error';
            bot.statusReason = FATAL_CODES[code];
            this.pushLog(bot, 'err', `Fataler Fehler: ${FATAL_CODES[code]}. Kein automatischer Neustart.`);
        } else if (bot.entry.autoRestart !== false) {
            if (uptime > 60000) bot.restarts = 0;
            bot.restarts = bot.restarts + 1;
            const delay = Math.min(60000, 2000 * (2 ** Math.min(bot.restarts - 1, 5)));
            bot.status = 'restarting';
            bot.statusReason = `Absturz – Neustart in ${Math.round(delay / 1000)}s (Versuch ${bot.restarts})`;
            this.pushLog(bot, 'system', bot.statusReason);
            bot.restartTimer = setTimeout(() => {
                bot.restartTimer = null;
                if (this.bots.has(bot.entry.id)) this.start(bot.entry.id);
            }, delay);
        } else {
            bot.status = 'error';
            bot.statusReason = `Abgestürzt (Code ${code})`;
        }
        bot.stopRequested = false;
        this.emitUpdate(bot);
    }

    /**
     * Stops the bot gracefully (SIGTERM, SIGKILL after 15s).
     * @param {string} id
     * @returns {Promise<void>}
     */
    stop(id) {
        const bot = this.get(id);
        clearTimeout(bot.restartTimer);
        bot.restartTimer = null;
        if (!bot.process) {
            if (bot.status === 'restarting') {
                bot.status = 'stopped';
                bot.statusReason = null;
                this.emitUpdate(bot);
            }
            return Promise.resolve();
        }
        const child = bot.process;
        bot.stopRequested = true;
        bot.status = 'stopping';
        this.pushLog(bot, 'system', 'Stoppe Bot…');
        this.emitUpdate(bot);
        return new Promise((resolve) => {
            const killTimer = setTimeout(() => child.kill('SIGKILL'), 15000);
            child.once('exit', () => {
                clearTimeout(killTimer);
                resolve();
            });
            child.kill('SIGTERM');
        });
    }

    async restart(id) {
        await this.stop(id);
        this.start(id);
    }

    /**
     * Writes a CLI command (see src/cli.js) to the bot's stdin.
     * @param {string} id
     * @param {string} command
     */
    sendCommand(id, command) {
        const bot = this.get(id);
        if (!bot.process) throw Object.assign(new Error('Bot läuft nicht'), {status: 409});
        const line = String(command).replace(/[\r\n]/g, ' ').trim().slice(0, 500);
        if (!line) return;
        this.pushLog(bot, 'cmd', `> ${line}`);
        bot.process.stdin.write(`${line}\n`);
    }

    async remove(id) {
        this.get(id);
        await this.stop(id);
        this.bots.delete(id);
        this.persist();
        fs.rmSync(this.botDir(id), {recursive: true, force: true});
        this.emit('removed', id);
    }

    pushLog(bot, type, text) {
        bot.logSeq = bot.logSeq + 1;
        const entry = {seq: bot.logSeq, time: new Date().toISOString(), type, text};
        bot.logs.push(entry);
        if (bot.logs.length > LOG_LIMIT) bot.logs.splice(0, bot.logs.length - LOG_LIMIT);
        this.emit('log', bot.entry.id, entry);
    }

    /**
     * Emoji import status written by the bot (data/emojis.json).
     * @param {string} id
     * @returns {Object|null}
     */
    emojiStatus(id) {
        this.get(id);
        return readJSON(path.join(this.dataDir(id), 'emojis.json'), null);
    }

    /**
     * Channels and roles of the bot's server (data/guild-cache.json, written by the bot).
     * @param {string} id
     * @returns {Object|null}
     */
    guildCache(id) {
        this.get(id);
        return readJSON(path.join(this.dataDir(id), 'guild-cache.json'), null);
    }

    /**
     * Schema and stored values of a module for the content editor.
     * @param {string} id
     * @param {string} moduleName
     * @returns {Array<Object>}
     */
    moduleContent(id, moduleName) {
        const bot = this.get(id);
        return moduleConfig.readModule(this.configDir(id), moduleName, bot.entry.language || 'de');
    }

    /**
     * Saves one config file of a module and reloads a running bot.
     * @param {string} id
     * @param {string} moduleName
     * @param {string} filename
     * @param {*} value
     */
    saveModuleContent(id, moduleName, filename, value) {
        const bot = this.get(id);
        moduleConfig.writeModuleFile(this.configDir(id), moduleName, filename, value, bot.entry.language || 'de');
        this.pushLog(bot, 'system', `Inhalte von ${moduleName}/${filename} gespeichert.`);
        if (bot.status === 'running') this.sendCommand(id, 'reload');
    }

    logs(id) {
        return this.get(id).logs;
    }

    emitUpdate(bot) {
        this.emit('update', this.summary(bot));
    }

    startAutoStartBots() {
        for (const bot of this.bots.values()) {
            if (bot.entry.autoStart) this.start(bot.entry.id);
        }
    }

    stopAll() {
        return Promise.all([...this.bots.keys()].map(id => this.stop(id)));
    }
}

module.exports = {BotManager, listAvailableModules, configSchema};
