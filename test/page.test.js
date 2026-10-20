// SPDX-License-Identifier: Apache-2.0
/* What the page's files may and may not contain, checked without a browser:
 *   - texts from hosts only ever reach the page as text: no innerHTML and its relatives anywhere,
 *   - nothing Cockpit's CSP blocks: no inline scripts, no event handler or style attributes,
 *   - every stylesheet url() names a file of the page (nothing from Cockpit's own files),
 *   - the page asks for no administrative access and watches no files,
 *   - the manifest is valid and has no status entry of its own.
 * Run with: node test/page.test.js */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const read = f => fs.readFileSync(path.join(SRC, f), "utf8");
const own = ["app.js", "lib/status.js", "i18n/en.js", "i18n/de.js"];
const html = read("index.html");
/* the code without its comments, which may name what the code must not do */
const app = read("app.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let passed = 0;
function t(name, fn) {
    try { fn(); passed++; } catch (e) { console.error("FAIL", name, "\n ", e.stack || e.message); process.exitCode = 1; }
}

t("no HTML from strings", () => own.forEach(f => {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "DOMParser", "createContextualFragment", "eval(",
     "new Function", "setTimeout(\"", "javascript:"].forEach(bad => assert.ok(!code.includes(bad), f + " uses " + bad));
}));

t("index.html: only external scripts, no handlers, no style attributes", () => {
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.ok(scripts.length > 0);
    scripts.forEach(s => assert.ok(/^<script src="[^"]+"><\/script>$/.test(s), "external only: " + s));
    assert.ok(!/\son[a-z]+=/i.test(html), "no event handler attributes");
    assert.ok(!/\sstyle=/i.test(html), "no style attributes");
    assert.ok(!/<style\b/i.test(html), "no style elements");
});

t("index.html: the page frame", () => {
    assert.ok(html.includes('<h1 class="az-page-title az-page-title--dot" id="page-title" tabindex="-1">Status Board</h1>'), "the title with the dot");
    assert.ok(html.includes("<title>Status Board</title>"));
    assert.strictEqual((html.match(/az-btn--primary/g) || []).length, 1, "Refresh is the only filled button");
    assert.ok(html.includes('<script src="../manifests.js"></script>'), "cockpit.manifests for this host");
    assert.ok(html.indexOf("azentrius-theme.js") < html.indexOf("azentrius.css"), "the theme script before the stylesheet");
});

t("stylesheets take every file from the page", () => fs.readdirSync(SRC).filter(f => f.endsWith(".css")).forEach(sheet => {
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, "");
    [...css.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/g)].map(m => m[2]).forEach(u => {
        if (u.startsWith("data:")) return;
        assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("/"), sheet + ": a relative path, not " + u);
        const file = path.resolve(SRC, u);
        assert.ok(file.startsWith(SRC + path.sep) && fs.statSync(file).isFile(), sheet + ": " + u + " exists");
    });
}));

t("no administrative access, no watching", () => {
    assert.ok(!app.includes('"require"'), "never superuser: require");
    assert.ok(!/\.watch\(/.test(app), "no cockpit.file().watch()");
    assert.ok(!/superuser:\s*"(?!try")/.test(app), "superuser only as try");
    assert.ok(/superuser: "try"/.test(app), "the status call with superuser: try");
});

t("the only commands the page runs", () => {
    const spawns = app.match(/cockpit\.spawn\([^,]+/g) || [];
    assert.deepStrictEqual(spawns, ["cockpit.spawn(FIND_ARGV", "cockpit.spawn(SB.statusArgv(command"]);
    assert.ok(app.includes('const FIND_ARGV = ["find", "/usr/share/cockpit", "-mindepth", "2", "-maxdepth", "2", "-name", "manifest.json"];'));
    assert.ok(!/cockpit\.script\(/.test(app), "no shell scripts");
});

/* Without AllowMultiHost the shell opens a jump to another host on this host (pkg/shell/state.tsx). */
t("jumps to other hosts only with the host switcher", () => {
    assert.ok(app.includes("window.parent.document.head.querySelector(\"meta[name='allow-multihost']\")"),
        "reads the shell's meta tag allow-multihost, as the shell does");
    assert.ok(app.includes("if (!host.own && !OTHER_HOSTS) return;"), "jumpTo refuses other hosts without it");
    assert.ok(app.includes("const go = !!tile.jump && (host.own || OTHER_HOSTS);"), "tiles of other hosts are no buttons without it");
});

t("manifest.json", () => {
    const m = JSON.parse(read("manifest.json"));
    assert.strictEqual(m.menu.index.label, "Status Board");
    assert.strictEqual(m.menu.index.path, "index.html");
    assert.ok(!("azentrius" in m), "the board has no status of its own");
});

t("SPDX headers", () => own.concat(["index.html", "app.css"]).forEach(f =>
    assert.ok(read(f).includes("SPDX-License-Identifier: Apache-2.0"), f)));

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
