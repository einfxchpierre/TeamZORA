/*
 * Renders the TeamZORA emoji set to PNG (128x128) and writes emojis/manifest.json.
 * Needs Playwright with Chromium (dev only): node emojis/build.js
 * The rendered PNGs are committed, so bots and the dashboard never need a browser.
 */
const fs = require('fs');
const path = require('path');
const {COLORS, GLYPHS, allEmojis, emojiSVG} = require('./glyphs');

const OUT = path.join(__dirname, 'png');

async function build() {
    const {chromium} = require('playwright');
    fs.mkdirSync(OUT, {recursive: true});
    const browser = await chromium.launch();
    const page = await browser.newPage({viewport: {width: 128, height: 128}, deviceScaleFactor: 1});
    const list = allEmojis();
    for (const e of list) {
        await page.setContent(`<html><body style="margin:0;background:transparent">${emojiSVG(e.glyph, e.color)}</body></html>`);
        await page.locator('svg').screenshot({path: path.join(OUT, `${e.name}.png`), omitBackground: true});
    }
    await browser.close();
    const manifest = {
        version: 1,
        colors: Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, {label: v.label, hex: v.to}])),
        glyphs: Object.fromEntries(Object.entries(GLYPHS).map(([k, v]) => [k, v.label])),
        emojis: list
    };
    fs.writeFileSync(path.join(__dirname, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${list.length} Emojis gerendert nach ${OUT}`);
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});
