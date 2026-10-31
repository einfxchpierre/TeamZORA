/*
 * Reads module config schemas (modules/<name>/module.json -> config-example-files) and the values a bot
 * has stored in bots/<id>/config/<module>/<filename>, localized for the dashboard, and writes edits back.
 * The bot validates and completes the files itself on the next reload.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = '_core';
const CORE_FILES = ['config-generator/strings.json'];
const NUMERIC = ['integer', 'float'];
const locCache = {};
const LABELS = {de: readJSON(path.join(__dirname, 'labels.de.json'), {})};

function readJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJSON(file, data) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

function configLocalization(lang) {
    if (!locCache[lang]) locCache[lang] = readJSON(path.join(ROOT, 'config-localizations', `${lang}.json`), {});
    return locCache[lang];
}

/**
 * Picks a language from {en, de} objects; strings pass through.
 * @param {*} value
 * @param {string} lang
 * @returns {*}
 */
function pick(value, lang) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'en' in value && Object.keys(value).every(k => (/^[a-z]{2,3}$/).test(k))) {
        return typeof value[lang] !== 'undefined' ? value[lang] : value.en;
    }
    return value;
}

function text(value, lang, fallback) {
    const v = pick(value, lang);
    if (typeof v !== 'string' || !v) return fallback;
    return (LABELS[lang] && LABELS[lang][v]) || v;
}

function assertSafeName(name) {
    if (!(/^[a-z0-9_-]+$/i).test(name)) throw Object.assign(new Error('Ungültiger Name'), {status: 400});
}

/**
 * Lists the schema files of a module.
 * @param {string} moduleName Folder name or "_core"
 * @returns {Array<Object>} Raw schemas
 */
function schemaFiles(moduleName) {
    assertSafeName(moduleName);
    if (moduleName === CORE) return CORE_FILES.map(f => readJSON(path.join(ROOT, f), null)).filter(Boolean);
    const dir = path.join(ROOT, 'modules', moduleName);
    const meta = readJSON(path.join(dir, 'module.json'), null);
    if (!meta) throw Object.assign(new Error('Modul nicht gefunden'), {status: 404});
    return (meta['config-example-files'] || [])
        .map(f => readJSON(path.join(dir, f), null))
        .filter(s => s && s.filename && !s.hidden);
}

/**
 * Default value of a field in the given language.
 * @returns {*}
 */
function fieldDefault(field, moduleName, fileName, lang) {
    const value = pick(field.default, lang);
    if (lang !== 'en' && ['string', 'emoji', 'imgURL'].includes(field.type)) {
        const loc = configLocalization(lang);
        const entry = loc[moduleName] && loc[moduleName][fileName.replace('.json', '')];
        const localized = entry && entry.content && entry.content[field.name];
        if (localized && typeof localized.default !== 'undefined') return localized.default;
    }
    return typeof value === 'undefined' ? null : JSON.parse(JSON.stringify(value));
}

/**
 * Schema in the shape the dashboard renders.
 * @returns {Object}
 */
function localizeSchema(schema, moduleName, lang) {
    return {
        filename: schema.filename,
        humanName: text(schema.humanName, lang, schema.filename),
        description: text(schema.description, lang, ''),
        configElements: !!schema.configElements,
        elementName: schema.configElementName ? {
            one: text(schema.configElementName.one, lang, 'Eintrag'),
            more: text(schema.configElementName.more, lang, 'Einträge')
        } : {one: 'Eintrag', more: 'Einträge'},
        categories: (schema.categories || []).map(c => ({id: c.id, name: text(c.displayName, lang, c.id)})),
        warning: text(schema.warningBanner, lang, '') || null,
        fields: (schema.content || []).filter(f => f.name && !f.hidden).map(f => ({
            name: f.name,
            type: f.type,
            humanName: text(f.humanName, lang, f.name),
            description: text(f.description, lang, ''),
            default: fieldDefault(f, moduleName, schema.filename, lang),
            content: typeof f.content === 'undefined' ? null : f.content,
            params: (f.params || []).map(p => ({name: p.name, description: text(p.description, lang, '')})),
            allowEmbed: !!f.allowEmbed,
            allowNull: !!f.allowNull,
            dependsOn: f.dependsOn || null,
            dependsOnNot: f.dependsOnNot || null,
            elementToggle: !!f.elementToggle,
            category: f.category || null,
            minValue: typeof f.minValue === 'number' ? f.minValue : null,
            maxValue: typeof f.maxValue === 'number' ? f.maxValue : null,
            maxLength: typeof f.maxLength === 'number' ? f.maxLength : null,
            disableKeyEdits: !!f.disableKeyEdits
        }))
    };
}

function filePath(configDir, moduleName, filename) {
    return moduleName === CORE ? path.join(configDir, filename) : path.join(configDir, moduleName, filename);
}

/**
 * Everything the editor needs for one module.
 * @param {string} configDir Bot config directory
 * @param {string} moduleName
 * @param {string} lang
 * @returns {Object}
 */
function readModule(configDir, moduleName, lang) {
    return schemaFiles(moduleName).map((schema) => {
        const localized = localizeSchema(schema, moduleName, lang);
        const file = filePath(configDir, moduleName, schema.filename);
        const exists = fs.existsSync(file);
        let value = exists ? readJSON(file, null) : null;
        if (value === null) {
            value = localized.configElements ? [] : Object.fromEntries(localized.fields.map(f => [f.name, f.default]));
        }
        return {...localized, exists, value};
    });
}

function coerceScalar(type, value) {
    if (NUMERIC.includes(type)) {
        if (value === '' || value === null || typeof value === 'undefined') return null;
        const n = Number(value);
        if (Number.isNaN(n)) throw Object.assign(new Error(`„${value}“ ist keine Zahl`), {status: 400});
        return type === 'integer' ? Math.trunc(n) : n;
    }
    if (type === 'boolean') return !!value;
    if (value === null || typeof value === 'undefined') return '';
    return typeof value === 'string' ? value : String(value);
}

/**
 * Normalizes one field value according to its schema.
 * @returns {*}
 */
function coerceField(field, value) {
    switch (field.type) {
        case 'boolean':
            return !!value;
        case 'integer':
        case 'float': {
            const n = coerceScalar(field.type, value);
            if (n === null) return field.allowNull ? null : field.default;
            if (field.minValue !== null && n < field.minValue) throw Object.assign(new Error(`${field.humanName}: Mindestwert ist ${field.minValue}`), {status: 400});
            if (field.maxValue !== null && n > field.maxValue) throw Object.assign(new Error(`${field.humanName}: Höchstwert ist ${field.maxValue}`), {status: 400});
            return n;
        }
        case 'array': {
            const list = Array.isArray(value) ? value : [];
            const itemType = typeof field.content === 'string' ? field.content : 'string';
            return list.map(v => coerceScalar(itemType, v)).filter(v => v !== '' && v !== null);
        }
        case 'keyed': {
            const out = {};
            const types = field.content || {key: 'string', value: 'string'};
            for (const [k, v] of Object.entries(value && typeof value === 'object' ? value : {})) {
                if (k === '') continue;
                out[k] = coerceScalar(types.value, v);
            }
            return out;
        }
        case 'string':
            if (field.allowEmbed && value && typeof value === 'object') return value;
            return coerceScalar('string', value);
        default:
            return coerceScalar(field.type, value);
    }
}

function coerceObject(fields, input, previous) {
    const out = {...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {})};
    for (const field of fields) {
        if (!(field.name in input)) continue;
        out[field.name] = coerceField(field, input[field.name]);
    }
    return out;
}

/**
 * Writes the value of one module config file.
 * @param {string} configDir
 * @param {string} moduleName
 * @param {string} filename
 * @param {*} value
 * @param {string} lang
 */
function writeModuleFile(configDir, moduleName, filename, value, lang) {
    const schema = schemaFiles(moduleName).find(s => s.filename === filename);
    if (!schema) throw Object.assign(new Error('Konfigurationsdatei nicht gefunden'), {status: 404});
    const localized = localizeSchema(schema, moduleName, lang);
    const file = filePath(configDir, moduleName, filename);
    const previous = readJSON(file, null);
    let data;
    if (localized.configElements) {
        if (!Array.isArray(value)) throw Object.assign(new Error('Erwartet wird eine Liste'), {status: 400});
        data = value.map((el, i) => coerceObject(localized.fields, el || {}, Array.isArray(previous) ? previous[i] : null));
    } else {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Ungültige Daten'), {status: 400});
        data = coerceObject(localized.fields, value, previous);
    }
    writeJSON(file, data);
}

/**
 * Localized defaults of the core config.json (used when creating a bot).
 * @param {string} lang
 * @returns {Object}
 */
function coreConfigDefaults(lang) {
    const schema = readJSON(path.join(ROOT, 'config-generator', 'config.json'), {content: []});
    const out = {};
    for (const f of schema.content) {
        if (f.name) out[f.name] = fieldDefault(f, CORE, 'config.json', lang);
    }
    return out;
}

module.exports = {readModule, writeModuleFile, coreConfigDefaults, CORE};
