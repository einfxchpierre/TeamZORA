/*
 * TeamZORA emoji set: glyph definitions (24x24 grid, drawn as round strokes) and colour palette.
 * build.js renders every glyph in every colour to emojis/png/z_<glyph>_<color>.png.
 * Glyphs with `fill: true` are filled shapes, `text` glyphs render a label, `shape` glyphs have no tile.
 */
const COLORS = {
    pink: {from: '#ff8ac8', to: '#e0287f', ink: '#ffffff', label: 'Pink'},
    blue: {from: '#6cb6ff', to: '#1d5fd6', ink: '#ffffff', label: 'Blau'},
    white: {from: '#ffffff', to: '#cfd3dc', ink: '#0b0b0f', label: 'Weiß'},
    green: {from: '#5ee790', to: '#13893f', ink: '#ffffff', label: 'Grün'},
    red: {from: '#ff7a7a', to: '#c81e1e', ink: '#ffffff', label: 'Rot'},
    yellow: {from: '#ffe55c', to: '#e09b05', ink: '#2a1d00', label: 'Gelb'},
    purple: {from: '#cf9bff', to: '#7a22cf', ink: '#ffffff', label: 'Lila'},
    orange: {from: '#ffbe7d', to: '#e8550b', ink: '#ffffff', label: 'Orange'},
    black: {from: '#4a4a52', to: '#0b0b0e', ink: '#ffffff', label: 'Schwarz'}
};

// Colours every tile glyph is generated in ("black" is only used for the dot/square shapes)
const TILE_COLORS = ['pink', 'blue', 'white', 'green', 'red', 'yellow', 'purple', 'orange'];
const SHAPE_COLORS = [...TILE_COLORS, 'black'];

const GLYPHS = {
    check: {label: 'Haken', d: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'},
    cross: {label: 'Kreuz', d: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'},
    warning: {label: 'Warnung', d: '<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4.2M12 17.2v.01"/>'},
    info: {label: 'Info', d: '<path d="M12 11v6.5M12 7v.01"/>'},
    question: {label: 'Frage', d: '<path d="M9 9a3 3 0 1 1 4.2 2.75c-.8.35-1.2 1-1.2 1.85v.4M12 17.5v.01"/>'},
    star: {label: 'Stern', fill: true, d: '<path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8Z"/>'},
    sparkle: {label: 'Funkeln', fill: true, d: '<path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z"/><path d="M19 15.5c.2 1.5.9 2.2 2.4 2.4-1.5.2-2.2.9-2.4 2.4-.2-1.5-.9-2.2-2.4-2.4 1.5-.2 2.2-.9 2.4-2.4Z"/>'},
    heart: {label: 'Herz', fill: true, d: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z"/>'},
    fire: {label: 'Feuer', d: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-3.5-9.5C12 7.5 11 9.5 11 12c-1.2-.6-2-1.8-2-3.2C7.2 10.5 6 12.6 6 15a6 6 0 0 0 6 6Z"/>'},
    hourglass: {label: 'Sanduhr', d: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"/>'},
    timer: {label: 'Stoppuhr', d: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.2 1.6M10 3h4M18.5 7l1.2-1.2"/>'},
    clock: {label: 'Uhr', d: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'},
    bell: {label: 'Glocke', d: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'},
    lock: {label: 'Schloss', d: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2"/>'},
    unlock: {label: 'Offen', d: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7M12 14.5v2"/>'},
    key: {label: 'Schlüssel', d: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>'},
    shield: {label: 'Schild', d: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2.2 2.2L15.5 10"/>'},
    hammer: {label: 'Hammer', d: '<path d="m13.5 9.5-9 9a1.8 1.8 0 0 0 2.5 2.5l9-9"/><path d="m11.5 7.5 5-5 5 5-5 5z"/>'},
    ban: {label: 'Verbot', d: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>'},
    trash: {label: 'Mülleimer', d: '<path d="M4 6.5h16M9 6.5V4.5h6v2M6 6.5l1 13.5h10l1-13.5M10 10.5v6M14 10.5v6"/>'},
    clipboard: {label: 'Klemmbrett', d: '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h4"/>'},
    scroll: {label: 'Schriftrolle', d: '<path d="M7 4h10.5a2 2 0 0 1 2 2v1.5h-3M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7.5M7 4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2M11 9h4M11 12.5h4M11 16h3"/>'},
    page: {label: 'Seite', d: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5"/>'},
    pencil: {label: 'Stift', d: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/><path d="m14.5 5.5 3 3"/>'},
    clip: {label: 'Büroklammer', d: '<path d="m20 11.5-8.3 8.3a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>'},
    chart: {label: 'Statistik', d: '<path d="M4 20.5h16M7 17v-5M12 17V7M17 17v-8"/>'},
    moon: {label: 'Mond', d: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5Z"/>'},
    user: {label: 'Person', d: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'},
    users: {label: 'Personen', d: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>'},
    wave: {label: 'Winken', d: '<path d="M7.5 11V6.5a1.5 1.5 0 0 1 3 0V11M10.5 10V4.5a1.5 1.5 0 0 1 3 0V10M13.5 10V5.5a1.5 1.5 0 0 1 3 0v6.5M16.5 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7l-3-4.6a1.5 1.5 0 0 1 2.4-1.8l1.6 2V8.5a1.5 1.5 0 0 1 3 0"/>'},
    trophy: {label: 'Pokal', d: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0V4Z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20.5h7M9.5 20.5c0-2 1-3.5 2.5-3.5s2.5 1.5 2.5 3.5"/>'},
    crown: {label: 'Krone', d: '<path d="m3.5 8 4.5 4 4-7 4 7 4.5-4-2 10.5h-13L3.5 8Z"/><path d="M5.5 21h13"/>'},
    home: {label: 'Haus', d: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5M10 20v-5.5h4V20"/>'},
    stop: {label: 'Stopp', fill: true, d: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>'},
    play: {label: 'Play', fill: true, d: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/>'},
    pause: {label: 'Pause', fill: true, d: '<rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/>'},
    skip: {label: 'Weiter', d: '<path d="m5 5.5 9 6.5-9 6.5V5.5ZM18.5 5.5v13"/>'},
    back: {label: 'Zurück', d: '<path d="M15 5l-7 7 7 7"/>'},
    next: {label: 'Vor', d: '<path d="m9 5 7 7-7 7"/>'},
    reply: {label: 'Antworten', d: '<path d="M9.5 6 4 11.5 9.5 17"/><path d="M4 11.5h10a6 6 0 0 1 6 6v1"/>'},
    refresh: {label: 'Neu laden', d: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'},
    gear: {label: 'Zahnrad', d: '<circle cx="12" cy="12" r="3"/><path d="M10.3 3.2h3.4l.5 2.4 1.6.9 2.3-.8 1.7 2.9-1.8 1.6v1.6l1.8 1.6-1.7 2.9-2.3-.8-1.6.9-.5 2.4h-3.4l-.5-2.4-1.6-.9-2.3.8-1.7-2.9 1.8-1.6v-1.6L4.2 8.6l1.7-2.9 2.3.8 1.6-.9.5-2.4Z"/>'},
    wrench: {label: 'Schraubenschlüssel', d: '<path d="M14.5 6.5a4.5 4.5 0 0 0 5.8 5.8L13 19.6a2.5 2.5 0 0 1-3.6-3.6l7.3-7.3-.1.1a4.5 4.5 0 0 1-2.1-2.3Z"/><path d="M14.7 6.3 17.5 3.5a4.5 4.5 0 0 1 3 3l-2.8 2.8"/>'},
    package: {label: 'Paket', d: '<path d="M12 2.8 20 7v10l-8 4.2L4 17V7l8-4.2Z"/><path d="M4 7l8 4.2L20 7M12 11.2v10M8 4.9l8 4.2"/>'},
    game: {label: 'Controller', d: '<path d="M7 7h10a5 5 0 0 1 4.9 6l-.7 3.3a2.3 2.3 0 0 1-4 1L15 15H9l-2.2 2.3a2.3 2.3 0 0 1-4-1L2.1 13A5 5 0 0 1 7 7Z"/><path d="M7.5 10v4M5.5 12h4M15.5 11v.01M17.5 13v.01"/>'},
    dice: {label: 'Würfel', d: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.5 8.5v.01M15.5 8.5v.01M12 12v.01M8.5 15.5v.01M15.5 15.5v.01"/>'},
    coffee: {label: 'Kaffee', d: '<path d="M5 9.5h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5v-5Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M11 3.5v2.5M14 3.5v2.5"/>'},
    'arrow_up': {label: 'Pfeil hoch', d: '<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>'},
    'arrow_down': {label: 'Pfeil runter', d: '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>'},
    'arrow_right': {label: 'Pfeil rechts', d: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>'},
    rock: {label: 'Stein', d: '<path d="M7 7.5 11 4l6 1.5 3 5.5-1.5 6.5L12 20l-6.5-2L3.5 12 7 7.5Z"/><path d="M11 4l-1 5 4.5 2.5M10 9l-4.5 3M14.5 11.5l4.5-.5"/>'},
    paper: {label: 'Papier', d: '<path d="M6 3.5h12v17H6z"/><path d="M9 8h6M9 11.5h6M9 15h4"/>'},
    scissors: {label: 'Schere', d: '<circle cx="6.5" cy="7" r="3"/><circle cx="6.5" cy="17" r="3"/><path d="M9 8.6 20 17M9 15.4 20 7"/>'},
    mail: {label: 'Brief', d: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>'},
    inbox: {label: 'Eingang', d: '<path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M6 5.5h12l2.5 8V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4.5L6 5.5Z"/>'},
    party: {label: 'Party', d: '<path d="m4 20 4.5-12 7.5 7.5L4 20Z"/><path d="M13 4.5c1.5 1 1.5 2.5.5 3.5M18 6.5l.01.01M19.5 11c-1.5-.5-3 0-3.5 1M15.5 3v.01M21 8v.01"/>'},
    boom: {label: 'Explosion', d: '<path d="m12 2.5 1.8 5.3 5-2.6-2.4 5.1 5.1 1.7-5.3 1.8 2.6 5-5.1-2.4-1.7 5.1-1.8-5.3-5 2.6 2.4-5.1-5.1-1.7 5.3-1.8-2.6-5 5.1 2.4L12 2.5Z"/>'},
    music: {label: 'Musik', d: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'},
    coin: {label: 'Münze', d: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 8.8c-.6-.8-1.5-1.3-2.5-1.3-1.5 0-2.7.9-2.7 2.2 0 3 5.4 1.6 5.4 4.6 0 1.3-1.2 2.2-2.7 2.2-1 0-2-.5-2.6-1.3M12 6v1.5M12 16.5V18"/>'},
    ticket: {label: 'Ticket', d: '<path d="M3.5 8a2 2 0 0 0 2-2h13a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2h-13a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z"/><path d="M14 6v2.5M14 11v2M14 15.5V18"/>'},
    sword: {label: 'Schwert', d: '<path d="M14.5 3.5H20.5V9.5L9.5 20.5 3.5 14.5Z"/><path d="m7 13 4 4M5 19l-1.5 1.5"/>'},
    rocket: {label: 'Rakete', d: '<path d="M12 2.8c3.2 2.4 5 6 5 10l-2 3H9l-2-3c0-4 1.8-7.6 5-10Z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M9 15.8 6 18l1-4M15 15.8l3 2.2-1-4M10.5 19.5l1.5 2 1.5-2"/>'},
    bolt: {label: 'Blitz', fill: true, d: '<path d="M13.5 2.5 4.5 13.5h6.5l-1 8 9-11h-6.5l1-8Z"/>'},
    plus: {label: 'Plus', d: '<path d="M12 5v14M5 12h14"/>'},
    minus: {label: 'Minus', d: '<path d="M5 12h14"/>'},
    pin: {label: 'Pin', d: '<path d="M15 3.5 20.5 9l-3.5 1.5-3 3 .5 4.5-1.5 1.5-4-4L4 20l4-5-4-4L5.5 9.5 10 10l3-3L15 3.5Z"/>'},
    link: {label: 'Link', d: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1"/>'},
    eye: {label: 'Auge', d: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'},
    mute: {label: 'Stumm', d: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'},
    gift: {label: 'Geschenk', d: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5c-1.5-3-5.5-4-5.5-1.5 0 1.5 3 1.5 5.5 1.5Zm0 0c1.5-3 5.5-4 5.5-1.5 0 1.5-3 1.5-5.5 1.5Z"/>'},
    chat: {label: 'Nachricht', d: '<path d="M20.5 12a8 8 0 0 1-11.8 7L3.5 20.5l1.5-5A8 8 0 1 1 20.5 12Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>'},
    num0: {label: '0', text: '0'},
    num1: {label: '1', text: '1'},
    num2: {label: '2', text: '2'},
    num3: {label: '3', text: '3'},
    num4: {label: '4', text: '4'},
    num5: {label: '5', text: '5'},
    num6: {label: '6', text: '6'},
    num7: {label: '7', text: '7'},
    num8: {label: '8', text: '8'},
    num9: {label: '9', text: '9'},
    num10: {label: '10', text: '10'},
    dot: {label: 'Punkt', shape: 'dot'},
    square: {label: 'Quadrat', shape: 'square'}
};

/**
 * Builds the standalone SVG for one emoji (128x128).
 * @param {string} glyphName
 * @param {string} colorName
 * @returns {string}
 */
function emojiSVG(glyphName, colorName) {
    const g = GLYPHS[glyphName];
    const c = COLORS[colorName];
    const id = `${glyphName}-${colorName}`;
    const defs = `<defs>
        <linearGradient id="bg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.from}"/><stop offset="1" stop-color="${c.to}"/></linearGradient>
        <radialGradient id="dot-${id}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${c.from}"/><stop offset="1" stop-color="${c.to}"/></radialGradient>
        <linearGradient id="shine-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <filter id="sh-${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="128" height="128"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".35"/></filter>
    </defs>`;
    const rim = colorName === 'white' ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.35)';
    if (g.shape === 'dot') {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${defs}
            <circle cx="64" cy="66" r="54" fill="url(#dot-${id})" filter="url(#sh-${id})"/>
            <circle cx="64" cy="66" r="52.5" fill="none" stroke="${rim}" stroke-width="3"/>
            <ellipse cx="52" cy="38" rx="28" ry="15" fill="url(#shine-${id})"/></svg>`;
    }
    const tile = `<rect x="8" y="8" width="112" height="112" rx="30" fill="url(#bg-${id})" filter="url(#sh-${id})"/>
        <rect x="9.5" y="9.5" width="109" height="109" rx="28.5" fill="none" stroke="${rim}" stroke-width="3"/>
        <path d="M22 10h84a20 20 0 0 1 12 6v26c-30 10-80 10-108 0V22a12 12 0 0 1 12-12Z" fill="url(#shine-${id})" opacity=".55"/>`;
    if (g.shape === 'square') {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${defs}${tile}</svg>`;
    }
    const inkShadow = c.ink === '#ffffff' ? `filter="url(#sh-${id})"` : '';
    let inner;
    if (g.text) {
        const size = g.text.length > 1 ? 58 : 72;
        inner = `<text x="64" y="66" text-anchor="middle" dominant-baseline="central" font-family="Inter, 'DejaVu Sans', Arial, sans-serif" font-weight="800" font-size="${size}" fill="${c.ink}" ${inkShadow}>${g.text}</text>`;
    } else {
        inner = `<g ${inkShadow}><g transform="translate(24 24) scale(3.333)" fill="${g.fill ? c.ink : 'none'}" stroke="${c.ink}" stroke-width="${g.fill ? 1.6 : 2.5}" stroke-linecap="round" stroke-linejoin="round">${g.d}</g></g>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${defs}${tile}${inner}</svg>`;
}

/**
 * Lists every emoji of the set.
 * @returns {Array<{name: string, glyph: string, color: string}>}
 */
function allEmojis() {
    const list = [];
    for (const glyph of Object.keys(GLYPHS)) {
        const colors = GLYPHS[glyph].shape ? SHAPE_COLORS : TILE_COLORS;
        for (const color of colors) list.push({name: `z_${glyph}_${color}`, glyph, color});
    }
    return list;
}

module.exports = {COLORS, GLYPHS, TILE_COLORS, SHAPE_COLORS, emojiSVG, allEmojis};
