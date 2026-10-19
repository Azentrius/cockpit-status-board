// SPDX-License-Identifier: Apache-2.0
/* Every text the page uses exists in every language, with the same shape, and the English texts
 * contain no German. Run with: node test/i18n.test.js */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const LANGS = fs.readdirSync(path.join(SRC, "i18n")).filter(f => f.endsWith(".js")).map(f => f.replace(/\.js$/, ""));
const texts = Object.fromEntries(LANGS.map(l => [l, require(path.join(SRC, "i18n", l + ".js"))]));
const app = fs.readFileSync(path.join(SRC, "app.js"), "utf8");
const lib = fs.readFileSync(path.join(SRC, "lib", "status.js"), "utf8");
const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");

let passed = 0;
function t(name, fn) {
    try { fn(); passed++; } catch (e) { console.error("FAIL", name, "\n ", e.message); process.exitCode = 1; }
}

const shape = v => (Array.isArray(v) ? "array:" + v.length : typeof v === "function" ? "function:" + v.length
    : v && typeof v === "object" ? "object:" + Object.keys(v).sort().join(",") : typeof v);
const sample = v => (typeof v === "function" ? v.apply(null, Array.from({ length: v.length }, (_, i) => (i ? "x" : 2))) : v);
/* every string of a text table, functions called with sample values */
function strings(v) {
    if (typeof v === "string") return [v];
    if (typeof v === "function") return strings(sample(v));
    if (v && typeof v === "object") return Object.values(v).flatMap(strings);
    return [];
}

t("languages", () => assert.deepStrictEqual(LANGS.sort(), ["de", "en"]));
t("every language file is loaded by the page", () =>
    LANGS.forEach(l => assert.ok(new RegExp(`<script src="i18n/${l}\\.js\\?v=[^"]+"></script>`).test(html), l)));

const keys = Object.keys(texts.en.ui).sort();
LANGS.forEach(l => t(`${l} has the same texts and shapes as en`, () => {
    assert.deepStrictEqual(Object.keys(texts[l].ui).sort(), keys);
    keys.forEach(k => {
        assert.strictEqual(shape(texts[l].ui[k]), shape(texts.en.ui[k]), k);
        const v = texts[l].ui[k];
        if (v && typeof v === "object") Object.keys(v).forEach(s => assert.strictEqual(shape(v[s]), shape(texts.en.ui[k][s]), k + "." + s));
    });
}));

const used = new Set();
(app.match(/\bT\.([A-Za-z]+)/g) || []).forEach(m => used.add(m.slice(2)));
(html.match(/data-t(?:-label)?="([A-Za-z]+)"/g) || []).forEach(m => used.add(/"(.*)"/.exec(m)[1]));
t("every text the page uses exists", () => LANGS.forEach(l => used.forEach(k => assert.ok(k in texts[l].ui, `${l}: ${k}`))));
t("no unused texts", () => assert.deepStrictEqual(keys.filter(k => !used.has(k)), []));

/* The words of the labels: every state, and every word the board gives a tile (lib/status.js). */
t("a word for every state and kind of tile", () => {
    const words = new Set(["none", "ok", "info", "warning", "danger"]);
    (lib.match(/word: "([a-z]+)"/g) || []).forEach(m => words.add(/"(.*)"/.exec(m)[1]));
    (lib.match(/ev\.byAge \? "([a-z]+)"/g) || []).forEach(m => words.add(/"(.*)"/.exec(m)[1]));
    assert.ok(words.size >= 14, "found the words in lib/status.js: " + Array.from(words));
    LANGS.forEach(l => assert.deepStrictEqual(Object.keys(texts[l].ui.words).sort(), Array.from(words).sort(), l));
});

t("a reason for every invalid answer", () => {
    const reasons = new Set();
    (lib.match(/fail\("([a-z-]+)"/g) || []).forEach(m => reasons.add(/"(.*)"/.exec(m)[1]));
    LANGS.forEach(l => assert.deepStrictEqual(Object.keys(texts[l].ui.invalid).sort(), Array.from(reasons).sort(), l));
});

t("functions return strings", () => LANGS.forEach(l => Object.entries(texts[l].ui).forEach(([k, v]) => {
    if (typeof v === "function") assert.strictEqual(typeof sample(v), "string", `${l}.${k}`);
    if (v && typeof v === "object") Object.entries(v).forEach(([s, f]) => {
        if (typeof f === "function") assert.strictEqual(typeof sample(f), "string", `${l}.${k}.${s}`);
    });
})));

t("code marks come in pairs", () => LANGS.forEach(l => strings(texts[l].ui).forEach(s =>
    assert.strictEqual((s.match(/`/g) || []).length % 2, 0, `${l}: ${s}`))));

t("English has no German", () => strings(texts.en.ui).forEach(s => {
    assert.ok(!/[äöüÄÖÜß„“]/.test(s), s);
    assert.ok(!/\b(und|nicht|der|die|das|Sie|ist|auf|mit|Hosts? öffnen)\b/.test(s), s);
}));

t("German addresses the user formally", () => strings(texts.de.ui).forEach(s =>
    assert.ok(!/\b(du|dein|deine|dich|dir)\b/i.test(s), s)));

t("product names are not translated", () => {
    assert.ok(!strings(texts.de.ui).concat(strings(texts.en.ui)).some(s => /Statustafel|Status-Board/.test(s)));
});

t("locales", () => {
    assert.strictEqual(texts.de.locale, "de-DE");
    assert.strictEqual(texts.en.locale, "en-US");
});

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
