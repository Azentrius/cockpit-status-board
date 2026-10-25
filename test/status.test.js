// SPDX-License-Identifier: Apache-2.0
/* The rules for what hosts send (src/lib/status.js), against the fixtures in test/fixtures:
 * good, broken and hostile answers of the status verb, manifests and the host switcher's list.
 * Every fixture of the status verb needs an expectation below.
 * Run with: node test/status.test.js */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const SB = require("../src/lib/status.js");

const FIX = path.join(__dirname, "fixtures");
const read = rel => fs.readFileSync(path.join(FIX, rel), "utf8");
const json = rel => JSON.parse(read(rel));
/* The time the fixtures are written for; the browser tests set their clock to it as well. */
const NOW = Date.parse("2026-10-19T19:00:00Z");

let passed = 0;
function t(name, fn) {
    try { fn(); passed++; } catch (e) { console.error("FAIL", name, "\n ", e.stack || e.message); process.exitCode = 1; }
}

/* ---------- every answer of the status verb ---------- */

/* pkg: the package the answer is read for (default: the addon it names). */
const EXPECT = {
    "good-image-updates.json": { state: "info", reported: "info", items: 4, key: "updates", value: "3", link: "#/updates" },
    "good-image-updates.de.json": { state: "info", reported: "info", items: 4, key: "updates", value: "3" },
    "good-image-updates-stale.json": { state: "warning", reported: "ok", items: 1, key: "updates", stale: true, byAge: true },
    "good-image-updates-stale.de.json": { state: "warning", reported: "ok", items: 1, key: "updates", stale: true, byAge: true },
    "good-cronjobs-danger.json": { state: "danger", reported: "danger", items: 2, key: "failed-runs", value: "2" },
    "good-cronjobs-danger.de.json": { state: "danger", reported: "danger", items: 2, key: "failed-runs", value: "2" },
    "good-cronjobs-ok.json": { state: "ok", reported: "ok", items: 2, key: "failed-runs", value: "0" },
    "good-cronjobs-ok.de.json": { state: "ok", reported: "ok", items: 2, key: "failed-runs", value: "0" },
    "good-update-gaps.json": { state: "warning", reported: "warning", items: 4, key: "held", value: "2", link: "#/held" },
    "good-update-gaps.de.json": { state: "warning", reported: "warning", items: 4, key: "held", value: "2" },
    /* What the add-ons answer, from their own verbs on the fixtures of their repositories (times
       moved to just before NOW): the key figure and the place in the add-on its link opens.
       Cron Jobs 2.9.0, Image Update Monitor 0.24.1, Update Gaps 0.6.0, Security Monitor 0.2.0. */
    "real-cronjobs.json": { state: "danger", reported: "danger", items: 3, key: "failed", value: "1", link: "#/overview/results" },
    "real-cronjobs.de.json": { state: "danger", reported: "danger", items: 3, key: "failed", value: "1", link: "#/overview/results" },
    "real-image-updates.json": { state: "info", reported: "info", items: 5, key: "updates", value: "2", link: "#/updates/update" },
    "real-image-updates.de.json": { state: "info", reported: "info", items: 5, key: "updates", value: "2", link: "#/updates/update" },
    "real-update-gaps.json": { state: "warning", reported: "warning", items: 7, key: "held", value: "6", link: "#/held" },
    "real-update-gaps.de.json": { state: "warning", reported: "warning", items: 7, key: "held", value: "6", link: "#/held" },
    "real-security.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "1", link: "#/containers" },
    "real-security.de.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "1", link: "#/containers" },
    /* the Security Monitor on its recordings of the other three hosts: vpn-host, build-host, claw-host */
    "real-security-edge.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "1", link: "#/containers" },
    "real-security-edge.de.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "1", link: "#/containers" },
    "real-security-ci.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "5", link: "#/containers" },
    "real-security-ci.de.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "5", link: "#/containers" },
    "real-security-ipv6.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "1", link: "#/containers" },
    "real-security-ipv6.de.json": { state: "danger", reported: "danger", items: 5, key: "containers", value: "1", link: "#/containers" },
    "good-minimal.json": { state: "none", reported: "none", items: 0, key: null },
    /* says ok, but an item says danger: the board believes the item */
    "good-understated.json": { state: "danger", reported: "ok", items: 1, key: "cves", dropped: 2 },

    "broken-not-json.txt": { pkg: "update-gaps", reason: "not-json" },
    "broken-empty.txt": { pkg: "cronjobs", reason: "not-json" },
    "broken-truncated.json": { pkg: "cronjobs", reason: "not-json" },
    "broken-schema-2.json": { pkg: "image-updates", reason: "schema", detail: "2" },
    "broken-no-schema.json": { pkg: "image-updates", reason: "schema", detail: null },
    "broken-wrong-addon.json": { pkg: "update-gaps", reason: "addon-mismatch", detail: "cronjobs" },
    "broken-state.json": { pkg: "cronjobs", reason: "state" },
    "broken-items-object.json": { pkg: "cronjobs", reason: "items" },
    "broken-array.json": { pkg: "cronjobs", reason: "not-object" },

    "hostile-markup.json": { state: "warning", reported: "warning", items: 4, key: "xss", value: "<i>7</i>", link: null },
    "hostile-bidi.json": { state: "ok", reported: "ok", items: 1, dropped: 1, key: "y", value: "5" },
    "hostile-proto.json": { state: "ok", reported: "ok", items: 1, key: "p" },
    "hostile-addon-path.json": { pkg: "cronjobs", reason: "addon" },
    "hostile-schema-string.json": { pkg: "cronjobs", reason: "schema", detail: "1" },
    "hostile-types.json": { state: "info", reported: "info", items: 4, dropped: 6, key: "u" },
    "hostile-long.json": { state: "info", reported: "info", items: SB.MAX_ITEMS, dropped: 31, key: "item-0" },

    /* the optional parts of version 1: checks, findings, a host's profile (written by a script, see
       the tests "optional parts" below) */
    "ext-good-security.json": { state: "danger", reported: "danger", items: 3, key: "exposure", value: "2", link: "#/exposure" },
    /* says ok: one acceptance has ended, so that finding counts again */
    "ext-good-update-gaps.json": { state: "warning", reported: "ok", items: 2, key: "restart", value: null, link: "#/restart" },
    "ext-good-host-settings.json": { state: "ok", reported: "ok", items: 3, key: "setup", value: "1" },
    "ext-broken-shapes.json": { state: "warning", reported: "warning", items: 3, key: "y", value: "1" },
    "ext-hostile.json": { state: "danger", reported: "warning", items: 2, key: "exposure", value: "120" },
    "ext-hostile-profile.json": { state: "ok", reported: "ok", items: 1, key: "run" },
    "ext-incompatible-schema-2.json": { pkg: "security", reason: "schema", detail: "2" },
    /* when a list of findings is complete, shared with Host Settings (see the tests "complete"
       below); what the item says counts either way */
    "ext-complete-total-1-empty.json": { state: "danger", reported: "danger", items: 1, key: "exposure", value: "1", link: "#/exposure" },
    "ext-complete-total-2-one.json": { state: "danger", reported: "danger", items: 1, key: "exposure", value: "2", link: "#/exposure" },
    "ext-complete-total-0-checked.json": { state: "ok", reported: "ok", items: 1, key: "exposure", value: "0", link: "#/exposure" },
    "ext-complete-no-total.json": { state: "danger", reported: "danger", items: 1, key: "exposure", value: "2", link: "#/exposure" },
    "ext-complete-invalid-entry.json": { state: "danger", reported: "danger", items: 1, key: "exposure", value: "2", link: "#/exposure" },
    "ext-complete-duplicate-fid.json": { state: "danger", reported: "danger", items: 1, key: "exposure", value: "2", link: "#/exposure" },
    "ext-complete-over-100.json": { state: "danger", reported: "danger", items: 1, key: "exposure", value: "101", link: "#/exposure" },
};

const statusFiles = fs.readdirSync(path.join(FIX, "status")).sort();
t("every status fixture has an expectation, and every expectation a fixture", () => {
    assert.deepStrictEqual(statusFiles, Object.keys(EXPECT).sort());
});

for (const file of statusFiles) {
    const want = EXPECT[file];
    if (!want) continue;
    t("status/" + file, () => {
        const text = read(path.join("status", file));
        const pkg = want.pkg || (() => { try { return JSON.parse(text).addon; } catch (_) { return undefined; } })();
        const v = SB.validateStatus(text, pkg);
        if (want.reason) {
            assert.strictEqual(v.ok, false, "refused");
            assert.strictEqual(v.reason, want.reason);
            if ("detail" in want) assert.strictEqual(v.detail, want.detail);
            return;
        }
        assert.strictEqual(v.ok, true, "accepted: " + JSON.stringify(v));
        const st = v.status;
        assert.strictEqual(st.addon, pkg);
        assert.strictEqual(st.state, want.reported);
        assert.strictEqual(st.items.length, want.items);
        assert.strictEqual(st.dropped, want.dropped || 0);
        const ev = SB.evaluate(st, NOW);
        assert.strictEqual(ev.state, want.state);
        assert.strictEqual(ev.key ? ev.key.id : null, want.key);
        if ("value" in want) assert.strictEqual(ev.key.value, want.value);
        if ("link" in want) assert.strictEqual(ev.key.link, want.link);
        assert.strictEqual(ev.staleSince !== null, !!want.stale, "out of date");
        assert.strictEqual(ev.byAge, !!want.byAge);
        /* whatever came in: only short plain texts went out */
        const texts = [st.label, st.version, st.summary].concat(...st.items.map(i => [i.title, i.value, i.detail]));
        texts.filter(x => x !== null).forEach(x => {
            assert.strictEqual(typeof x, "string");
            assert.ok(!/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(x), "no invisible characters: " + JSON.stringify(x));
        });
        st.items.forEach(i => {
            assert.ok(SB.ITEM_ID_RE.test(i.id));
            assert.ok(SB.STATES.includes(i.state));
            assert.ok(i.link === null || SB.LINK_RE.test(i.link));
        });
    });
}

t("the times of a good answer", () => {
    const st = SB.validateStatus(read("status/good-image-updates.json"), "image-updates").status;
    assert.strictEqual(st.checkedAt, Date.UTC(2026, 9, 19, 18, 36));
    assert.strictEqual(st.items[0].staleAfter, 43200);
    /* six digits of a fraction and +00:00, as Python writes them */
    assert.strictEqual(st.items[2].checkedAt, Date.UTC(2026, 9, 19, 16, 40, 12, 482));
    assert.strictEqual(st.version, "0.20.0");
    assert.strictEqual(st.label, "Image Update Monitor");
});

t("the data of an out-of-date answer", () => {
    const st = SB.validateStatus(read("status/good-image-updates-stale.json"), "image-updates").status;
    const ev = SB.evaluate(st, NOW);
    assert.strictEqual(ev.staleSince, Date.UTC(2026, 9, 18, 17, 12));
    assert.strictEqual(ev.key.state, "warning");
    assert.strictEqual(ev.key.staleAt, ev.staleSince);
    assert.strictEqual(ev.checkedAt, Date.UTC(2026, 9, 18, 5, 12));
    /* on the dot it is not out of date yet */
    assert.strictEqual(SB.evaluate(st, ev.staleSince).staleSince, null);
    assert.strictEqual(SB.evaluate(st, ev.staleSince + 1).state, "warning");
});

t("a danger stays a danger when it is out of date as well", () => {
    const st = SB.validateStatus(read("status/good-cronjobs-danger.json"), "cronjobs").status;
    const ev = SB.evaluate(st, NOW + 3 * 3600e3);
    assert.strictEqual(ev.state, "danger");
    assert.notStrictEqual(ev.staleSince, null);
    assert.strictEqual(ev.byAge, false);
});

t("markup stays text", () => {
    const st = SB.validateStatus(read("status/hostile-markup.json"), "cronjobs").status;
    assert.strictEqual(st.label, "<img src=x onerror=\"window.__pwned='label'\">");
    assert.strictEqual(st.version, "<script>window.__pwned='version'</script>".slice(0, 39) + "…");
    assert.ok(st.summary.startsWith("<b onmouseover="));
    assert.deepStrictEqual(st.items.map(i => i.link), [null, null, null, null], "no link leaves the page");
});

t("invisible and bidirectional characters go", () => {
    const st = SB.validateStatus(read("status/hostile-bidi.json"), "update-gaps").status;
    assert.strictEqual(st.label, "Updatespag Gaps");
    assert.strictEqual(st.summary, "line one line two tabbedbellzerowidthisolate end");
    assert.deepStrictEqual(st.items.map(i => [i.id, i.title, i.value]), [["y", "oktitle", "5"]]);
});

t("prototype keys are only data", () => {
    const v = SB.validateStatus(read("status/hostile-proto.json"), "cronjobs");
    assert.strictEqual(v.ok, true);
    assert.strictEqual({}.polluted, undefined);
    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(v.status.items[0].state, "ok");
});

t("fields of the wrong type are dropped, not trusted", () => {
    const st = SB.validateStatus(read("status/hostile-types.json"), "cronjobs").status;
    assert.deepStrictEqual([st.label, st.version, st.checkedAt, st.summary], [null, null, null, null]);
    assert.deepStrictEqual(st.items.map(i => i.id), ["u", "v", "w", "time"]);
    const u = st.items[0];
    assert.deepStrictEqual([u.value, u.detail, u.link, u.checkedAt, u.staleAfter], [null, null, null, null, null]);
    assert.deepStrictEqual(st.items.map(i => i.staleAfter), [null, null, null, 60]);
    assert.strictEqual(st.items[3].checkedAt, null, "a time without a zone is no time");
});

t("long texts are cut, long lists too", () => {
    const st = SB.validateStatus(read("status/hostile-long.json"), "update-gaps").status;
    assert.strictEqual(Array.from(st.label).length, SB.LIMITS.label);
    assert.ok(st.label.endsWith("…"));
    assert.strictEqual(st.version.length, SB.LIMITS.version);
    assert.strictEqual(st.summary.length, SB.LIMITS.summary);
    st.items.forEach(i => {
        assert.ok(i.title.length <= SB.LIMITS.title);
        assert.ok(i.value.length <= SB.LIMITS.value);
        assert.ok(i.detail.length <= SB.LIMITS.detail);
    });
    assert.strictEqual(st.items.filter(i => i.id === "item-0").length, 1, "an id counts once");
});

t("an answer longer than 64 KiB is not read", () => {
    const big = JSON.stringify({ schema: 1, addon: "cronjobs", state: "ok", items: [], pad: "x".repeat(SB.MAX_OUTPUT) });
    assert.strictEqual(SB.validateStatus(big, "cronjobs").reason, "too-large");
});

t("a deeply nested answer is refused, not a crash", () => {
    const deep = "[".repeat(100000) + "]".repeat(100000);
    assert.strictEqual(SB.validateStatus(deep, "cronjobs").ok, false);
});

t("not text", () => {
    assert.strictEqual(SB.validateStatus(null, "cronjobs").reason, "not-text");
    assert.strictEqual(SB.validateStatus({ schema: 1 }, "cronjobs").reason, "not-text");
});

t("the add-on must be the package it was found in", () => {
    const text = read("status/good-cronjobs-ok.json");
    assert.strictEqual(SB.validateStatus(text, "cronjobs").ok, true);
    assert.strictEqual(SB.validateStatus(text, "image-updates").reason, "addon-mismatch");
});

/* ---------- texts and times ---------- */

t("cleanText", () => {
    assert.strictEqual(SB.cleanText(null, 10), null);
    assert.strictEqual(SB.cleanText(5, 10), null);
    assert.strictEqual(SB.cleanText("  \n\t ", 10), null);
    assert.strictEqual(SB.cleanText(" a \n b  c ", 10), "a b c");
    assert.strictEqual(SB.cleanText("abcdef", 4), "abc…");
    assert.strictEqual(SB.cleanText("abcd", 4), "abcd");
    assert.strictEqual(SB.cleanText("\u{1F600}\u{1F600}\u{1F600}", 2), "\u{1F600}…", "characters, not UTF-16 units");
    assert.strictEqual(SB.cleanText("a\u202Eb\u0000c\u2069d", 10), "abcd");
});

t("parseTime", () => {
    const t0 = Date.UTC(2026, 9, 19, 18, 36);
    assert.strictEqual(SB.parseTime("2026-10-19T18:36:00Z"), t0);
    assert.strictEqual(SB.parseTime("2026-10-19T18:36Z"), t0);
    assert.strictEqual(SB.parseTime("2026-10-19T20:36:00+02:00"), t0);
    assert.strictEqual(SB.parseTime("2026-10-19T18:36:00.123456Z"), t0 + 123);
    ["2026-10-19", "2026-10-19 18:36:00Z", "2026-13-40T99:99:00Z", "2026-10-19T18:36:00", "yesterday", "", 1760900000, null]
        .forEach(x => assert.strictEqual(SB.parseTime(x), null, JSON.stringify(x)));
});

t("the state of the items (contract, States)", () => {
    const s = (...states) => SB.stateOfItems(states.map(state => ({ state })));
    assert.strictEqual(s(), "none");
    assert.strictEqual(s("none", "none"), "none");
    assert.strictEqual(s("none", "ok"), "ok");
    assert.strictEqual(s("ok", "info"), "info");
    assert.strictEqual(s("info", "danger", "warning"), "danger");
});

t("every state has a label that the shared design files style", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "src", "azentrius.css"), "utf8");
    assert.deepStrictEqual(Object.keys(SB.LABEL_CLASS).sort(), SB.STATES.slice().sort());
    for (const state of SB.STATES) {
        const classes = SB.LABEL_CLASS[state].split(" ");
        assert.strictEqual(classes[0], "az-label", state);
        for (const cls of classes) {
            assert.ok(new RegExp("\\." + cls + "\\s*\\{").test(css), state + ": azentrius.css has no rule for ." + cls);
        }
    }
    assert.strictEqual(SB.LABEL_CLASS.ok, "az-label az-label--success", "ok is the status language's good");
});

t("the most important item", () => {
    const st = SB.validateStatus(JSON.stringify({ schema: 1, addon: "x", state: "warning", items: [
        { id: "a", state: "warning", title: "A" },
        { id: "b", state: "warning", title: "B", value: "2" },
        { id: "c", state: "info", title: "C", value: "9" },
    ] }), "x").status;
    assert.strictEqual(SB.evaluate(st, NOW).key.id, "b", "the most severe, one with a value first");
});

/* ---------- the entries a tile folds out ---------- */

t("every entry in the add-on's order, with its state at the time", () => {
    const st = SB.validateStatus(read("status/real-security.json"), "security").status;
    const ev = SB.evaluate(st, NOW);
    assert.deepStrictEqual(ev.items.map(i => [i.id, i.state, i.word, i.link, i.staleAt]), [
        ["exposure", "warning", "warning", "#/exposure", null],
        ["ssh", "info", "info", "#/ssh", null],
        ["logins", "ok", "ok", "#/logins", null],
        ["containers", "danger", "danger", "#/containers", null],
        ["scan", "ok", "ok", null, null],
    ]);
    assert.deepStrictEqual(ev.items.map(i => [i.title, i.value]).slice(0, 2), [["Reachable from the internet", "10"], ["SSH", null]]);
    /* an hour after the check every entry is out of date: at least a warning, a danger stays one */
    const later = SB.evaluate(st, NOW + 3600e3);
    assert.deepStrictEqual(later.items.map(i => [i.id, i.state, i.word]), [
        ["exposure", "warning", "warning"], ["ssh", "warning", "stale"], ["logins", "warning", "stale"],
        ["containers", "danger", "danger"], ["scan", "warning", "stale"],
    ]);
    assert.ok(later.items.every(i => i.staleAt === Date.UTC(2026, 9, 19, 19, 52)), "out of date since checked_at + stale_after");
    assert.deepStrictEqual(st.items.map(i => i.state), ["warning", "info", "ok", "danger", "ok"], "the answer itself stays as it came");
});

t("an entry out of date on its own", () => {
    const st = SB.validateStatus(read("status/good-image-updates-stale.json"), "image-updates").status;
    const ev = SB.evaluate(st, NOW);
    assert.deepStrictEqual(ev.items.map(i => [i.id, i.state, i.word]), [["updates", "warning", "stale"]]);
    assert.strictEqual(ev.items[0].staleAt, ev.staleSince);
});

/* ---------- the optional parts of version 1: checks, findings, a host's profile ---------- */

const ext = file => SB.validateStatus(read("status/" + file), JSON.parse(read("status/" + file)).addon).status;

t("optional parts: an answer without them has none", () => {
    const st = ext("real-security.json");
    assert.deepStrictEqual([st.features, st.checks, st.profile, st.extDropped], [[], null, null, 0]);
    assert.ok(st.items.every(i => i.findings === null));
    assert.deepStrictEqual(st.items.map(i => SB.itemState(i, NOW)), st.items.map(i => i.state));
});

t("optional parts: checks and findings of the Security Monitor", () => {
    const st = ext("ext-good-security.json");
    assert.deepStrictEqual(st.features, ["checks", "findings"]);
    assert.deepStrictEqual(st.checks.map(c => [c.id, c.state, c.item]),
        [["exposure", "checked", "exposure"], ["containers", "partial", "containers"], ["fail2ban", "notapplicable", null]]);
    assert.deepStrictEqual([st.checks[0].checkedAt, st.checks[0].staleAfter, st.checks[2].reason],
        [Date.UTC(2026, 9, 19, 18, 50), 3600, "fail2ban is not installed"]);
    const exp = st.items[0].findings;
    assert.deepStrictEqual([exp.complete, exp.total], [true, 2]);
    assert.deepStrictEqual(exp.list.map(f => [f.fid, f.state, f.exposure, f.fix, f.exploited, f.acceptedUntil, f.link]), [
        ["port.5432-tcp", "danger", "internet", "available", null, null, "#/exposure/5432-tcp"],
        ["port.6379-tcp", "danger", "internet", "available", null, null, "#/exposure/6379-tcp"]]);
    assert.strictEqual(exp.list[1].since, Date.UTC(2026, 9, 17, 7, 30));
    assert.deepStrictEqual(st.items[1].findings, { complete: false, total: 0, list: [] }, "a list is complete only where its check is checked");
    assert.strictEqual(st.items[2].findings, null);
    assert.strictEqual(st.extDropped, 0);
});

t("optional parts: an acceptance that runs, and one that has ended", () => {
    const st = ext("ext-good-update-gaps.json");
    assert.strictEqual(st.items[0].findings.list[0].acceptedUntil, Date.UTC(2026, 9, 30));
    assert.deepStrictEqual(st.items.map(i => SB.itemState(i, NOW)), ["ok", "warning"]);
    assert.strictEqual(SB.itemState(st.items[0], Date.UTC(2026, 9, 30)), "warning", "on the day it ends the finding counts again");
    const ev = SB.evaluate(st, NOW);
    assert.deepStrictEqual(ev.items.map(i => [i.id, i.state, i.word]), [["held", "ok", "ok"], ["restart", "warning", "warning"]]);
    assert.strictEqual(ev.byAge, false);
    assert.deepStrictEqual(st.checks.map(c => c.state), ["checked", "checked", "unconfigured"]);
});

t("optional parts: a host's profile, only from Host Settings and only when declared", () => {
    const st = ext("ext-good-host-settings.json");
    assert.deepStrictEqual(st.profile, {
        roles: ["web"], expect: ["host-settings", "update-gaps", "security", "cronjobs", "image-updates"],
        skip: [{ check: "update-gaps/cve", reason: "network data off on purpose", until: null }], setAt: Date.UTC(2026, 9, 19, 9) });
    assert.strictEqual(st.checks[0].item, "run");
    const other = Object.assign(JSON.parse(read("status/ext-good-host-settings.json")), { addon: "security" });
    assert.strictEqual(SB.validateStatus(JSON.stringify(other), "security").status.profile, null, "from another add-on");
    const undeclared = Object.assign(JSON.parse(read("status/ext-good-host-settings.json")), { features: ["checks"] });
    assert.strictEqual(SB.validateStatus(JSON.stringify(undeclared), "host-settings").status.profile, null, "without the feature");
});

t("optional parts: only what features declares is read", () => {
    const doc = JSON.parse(read("status/ext-good-security.json"));
    for (const features of [undefined, null, "checks", { checks: true }, [], ["Checks"]]) {
        const st = SB.validateStatus(JSON.stringify(Object.assign({}, doc, { features })), "security").status;
        assert.deepStrictEqual([st.features, st.checks, st.items[0].findings, st.extDropped], [[], null, null, 0], JSON.stringify(features));
    }
    const checksOnly = SB.validateStatus(JSON.stringify(Object.assign({}, doc, { features: ["checks"] })), "security").status;
    assert.deepStrictEqual([checksOnly.checks.length, checksOnly.items[0].findings], [3, null]);
    const findingsOnly = SB.validateStatus(JSON.stringify(Object.assign({}, doc, { features: ["findings"] })), "security").status;
    assert.deepStrictEqual([findingsOnly.checks, findingsOnly.items[0].findings.list.length, findingsOnly.items[0].findings.complete], [null, 2, false],
        "without checks no list is complete");
});

t("optional parts: shapes the board cannot use are left out and counted", () => {
    const st = ext("ext-broken-shapes.json");
    assert.deepStrictEqual([st.checks, st.profile, st.extDropped], [null, null, 4]);
    assert.ok(st.items.every(i => i.findings === null));
});

t("optional parts: hostile checks and findings", () => {
    const st = ext("ext-hostile.json");
    assert.deepStrictEqual(st.features, ["checks", "findings", "profile"]);
    assert.strictEqual(st.checks.length, SB.MAX_CHECKS);
    assert.deepStrictEqual(st.checks.slice(0, 3).map(c => [c.id, c.state, c.item, c.link]),
        [["constructor", "checked", "constructor", null], ["exposure", "partial", "exposure", null], ["w", "checked", null, null]]);
    const [c, e] = st.items.map(i => i.findings);
    assert.deepStrictEqual(c.list.map(f => f.fid), ["constructor", "accept-far", "odd"]);
    assert.deepStrictEqual([c.complete, c.total], [false, 3], "a list with entries left out is not complete");
    assert.strictEqual(c.list[1].acceptedUntil, null, "an acceptance more than 90 days after the check does not count");
    const odd = c.list[2];
    assert.deepStrictEqual([odd.title, odd.exposure, odd.fix, odd.exploited, odd.since, odd.link], ["Oddddo", null, null, null, null, null]);
    assert.strictEqual(c.list.length + e.list.length, SB.MAX_FINDINGS);
    assert.deepStrictEqual([e.complete, e.total], [false, 120]);
    assert.strictEqual(st.profile, null, "a profile from another add-on than Host Settings is not read");
    /* checks: 5 broken or twice, 3 past 50; findings: 4 broken or twice, 23 past 100 */
    assert.strictEqual(st.extDropped, 35);
    assert.strictEqual(SB.itemState(st.items[0], NOW), "danger", "the acceptance ten years ahead hides nothing");
    assert.ok(({}).constructor === Object && Object.prototype.polluted === undefined, "names every object has are only data");
});

t("optional parts: a hostile profile", () => {
    const st = ext("ext-hostile-profile.json");
    assert.deepStrictEqual(st.profile.roles, ["web", "db", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
    assert.deepStrictEqual(st.profile.expect, ["security", "security/exposure", "constructor"]);
    assert.deepStrictEqual(st.profile.skip.map(s => [s.check, s.reason, s.until]),
        [["update-gaps/cve", "off", Date.UTC(2026, 10, 1)], ["security/fail2ban", "<b>CrowdSec</b> instead", null]]);
    assert.strictEqual(st.profile.setAt, null);
    assert.strictEqual(st.extDropped, 12);
});

t("optional parts: every text is cleaned and cut", () => {
    ["ext-good-security.json", "ext-good-update-gaps.json", "ext-good-host-settings.json", "ext-hostile.json", "ext-hostile-profile.json"].forEach(f => {
        const st = ext(f);
        const texts = [].concat(
            (st.checks || []).flatMap(c => [c.title, c.reason]),
            st.items.flatMap(i => (i.findings ? i.findings.list.map(x => x.title) : [])),
            st.profile ? st.profile.skip.map(s => s.reason) : []).filter(x => x !== null);
        texts.forEach(x => assert.ok(typeof x === "string" && SB.cleanText(x, 1000) === x && Array.from(x).length <= SB.LIMITS.detail, f + ": " + JSON.stringify(x)));
    });
});

/* ---------- when a list of findings is complete ---------- */

/* The shared fixtures test/fixtures/status/ext-complete-*.json: Host Settings keeps byte-identical
   copies, and its notifier must find the same complete and total for each. Every one is the
   Security Monitor's check "exposure", checked and in time at NOW, and its item; A is
   port.5432-tcp and B port.6379-tcp, the two findings ext-good-security.json lists completely, so
   each of them can follow that answer. Only a complete list says that a finding missing from it is
   gone. */
const FID_A = "port.5432-tcp";
const FID_B = "port.6379-tcp";
const COMPLETE = {
    /* counts one, lists none: A and B stay as they were */
    "ext-complete-total-1-empty.json": { complete: false, total: 1, fids: [], dropped: 0 },
    /* counts two, lists A: B stays as it was */
    "ext-complete-total-2-one.json": { complete: false, total: 2, fids: [FID_A], dropped: 0 },
    /* counts none, lists none, its check checked and in time: A and B are gone */
    "ext-complete-total-0-checked.json": { complete: true, total: 0, fids: [], dropped: 0 },
    /* no total: as before, the length of the list */
    "ext-complete-no-total.json": { complete: true, total: 2, fids: [FID_A, FID_B], dropped: 0 },
    /* B breaks the rules, a duplicate of A, B past the limit of 100: never complete */
    "ext-complete-invalid-entry.json": { complete: false, total: 1, fids: [FID_A], dropped: 1 },
    "ext-complete-duplicate-fid.json": { complete: false, total: 1, fids: [FID_A], dropped: 1 },
    "ext-complete-over-100.json": { complete: false, total: 100, fids: null, dropped: 1 },
};
const rawDoc = file => json("status/" + file);
const findingsOf = doc => SB.validateStatus(JSON.stringify(doc), "security").status.items[0].findings;

t("complete: every shared fixture has its expectation", () => {
    assert.deepStrictEqual(statusFiles.filter(f => f.startsWith("ext-complete-")), Object.keys(COMPLETE).sort());
});

for (const [file, want] of Object.entries(COMPLETE)) {
    t("complete: " + file, () => {
        const st = ext(file);
        const f = st.items[0].findings;
        assert.deepStrictEqual([f.complete, f.total, st.extDropped], [want.complete, want.total, want.dropped]);
        if (want.fids) assert.deepStrictEqual(f.list.map(x => x.fid), want.fids);
        assert.deepStrictEqual(st.checks.map(c => [c.id, c.state, c.item]), [["exposure", "checked", "exposure"]]);
        assert.deepStrictEqual(SB.checksCoverage(st, NOW).coverage, "checked", "the check is in time: only the list decides");
        assert.strictEqual(rawDoc(file).items[0].findings.complete, true, "every one of them says complete");
    });
}

t("complete: past the limit of 100 the rest is left out, B with it", () => {
    const f = ext("ext-complete-over-100.json").items[0].findings;
    assert.deepStrictEqual([f.list.length, f.list[0].fid, f.list.some(x => x.fid === FID_B)], [SB.MAX_FINDINGS, FID_A, false]);
    const sent = rawDoc("ext-complete-over-100.json").items[0].findings.list;
    assert.deepStrictEqual([sent.length, sent[sent.length - 1].fid], [SB.MAX_FINDINGS + 1, FID_B]);
});

t("complete: each fixture is complete without the one thing it tests", () => {
    const fix = (file, change) => {
        const doc = rawDoc(file);
        change(doc.items[0].findings, doc);
        return findingsOf(doc);
    };
    assert.deepStrictEqual(fix("ext-complete-total-1-empty.json", f => { delete f.total; }), { complete: true, total: 0, list: [] });
    assert.strictEqual(fix("ext-complete-total-2-one.json", f => { f.total = 1; }).complete, true);
    assert.strictEqual(fix("ext-complete-invalid-entry.json", f => { f.list.pop(); }).complete, true);
    assert.strictEqual(fix("ext-complete-duplicate-fid.json", f => { f.list.pop(); }).complete, true);
    assert.strictEqual(fix("ext-complete-over-100.json", f => { f.list.pop(); }).complete, true);
    assert.strictEqual(fix("ext-complete-no-total.json", f => { f.total = 2; }).complete, true, "a total that agrees");
    /* and the rules that were there before still hold */
    assert.strictEqual(fix("ext-complete-total-0-checked.json", (f, doc) => { doc.checks[0].state = "partial"; }).complete, false, "a check done in part");
    assert.strictEqual(fix("ext-complete-total-0-checked.json", (f, doc) => { doc.checks[0].item = "elsewhere"; }).complete, false, "no check that owns the item");
    assert.strictEqual(fix("ext-complete-total-0-checked.json", f => { f.complete = false; }).complete, false, "the add-on does not say so");
});

t("complete: a whole-number total past the findings taken over, whatever its size", () => {
    /* ext-complete-no-total.json (A and B, complete) with this total */
    const withTotal = total => {
        const doc = rawDoc("ext-complete-no-total.json");
        doc.items[0].findings.total = total;
        const f = findingsOf(doc);
        return [f.complete, f.total, f.list.length];
    };
    assert.deepStrictEqual(withTotal(3), [false, 3, 2]);
    assert.deepStrictEqual(withTotal(SB.MAX_TOTAL), [false, SB.MAX_TOTAL, 2]);
    assert.deepStrictEqual(withTotal(SB.MAX_TOTAL + 1), [false, 2, 2], "past the limit the total is not kept, and the list still is not complete");
    /* a total that is no whole number is left out, as before: the length of the list */
    for (const odd of ["3", -1, 2.5, null, true, [3], { n: 3 }]) {
        assert.deepStrictEqual(withTotal(odd), [true, 2, 2], JSON.stringify(odd));
    }
    assert.deepStrictEqual(withTotal(1), [true, 2, 2], "fewer than listed: the length of the list");
    assert.deepStrictEqual(withTotal(0), [true, 2, 2]);
    /* JSON has no integers of its own: 3.0 is the whole number 3 (Python reads it as a float) */
    const text = read("status/ext-complete-no-total.json").replace("\"complete\": true,", "\"complete\": true, \"total\": 3.0,");
    assert.ok(text.includes("\"total\": 3.0,"));
    const f = SB.validateStatus(text, "security").status.items[0].findings;
    assert.deepStrictEqual([f.complete, f.total], [false, 3]);
});

/* ---------- only what needs attention ---------- */

t("notable: notices, warnings and problems, and hosts still loading", () => {
    const tile = (kind, state) => ({ kind, state });
    assert.deepStrictEqual(
        [["status", "danger"], ["status", "warning"], ["status", "info"], ["status", "ok"], ["status", "none"],
         ["missing", "none"], ["nostatus", "none"], ["noaccess", "warning"], ["error", "warning"], ["rejected", "warning"],
         ["unreachable", "danger"], ["locked", "warning"], ["discovery", "warning"], ["loading", "none"]]
            .map(([k, s]) => SB.notable(tile(k, s))),
        [true, true, true, false, false, false, false, true, true, true, true, true, true, true]);
});

/* ---------- versions ---------- */

t("compareVersions", () => {
    const c = SB.compareVersions;
    assert.strictEqual(c("0.20.0", "0.3.0"), 1, "numbers, not text");
    assert.strictEqual(c("2.8.0", "2.8.1"), -1);
    assert.strictEqual(c("1.0.0", "1.0.0"), 0);
    assert.strictEqual(c("v1.2.3", "1.2.3"), 0);
    assert.strictEqual(c("0.1.0~dev.a5215aa", "0.1.0"), -1, "a build before the release");
    assert.strictEqual(c("0.1.0", "0.1.0-rc1"), 1);
    assert.strictEqual(c("0.1.0-rc1", "0.1.0-rc2"), -1);
    assert.strictEqual(c("0.2.0~dev", "0.1.9"), 1);
    ["", "1.2", "latest", "1.2.x", null, 3].forEach(x => assert.strictEqual(c(x, "1.0.0"), null, JSON.stringify(x)));
});

/* ---------- failed calls ---------- */

t("classifyFailure", () => {
    const c = SB.classifyFailure;
    assert.deepStrictEqual(c({ exit_status: 77, problem: null, message: "" }), { kind: "noaccess" });
    assert.deepStrictEqual(c({ problem: "access-denied", message: "" }), { kind: "noaccess" });
    assert.deepStrictEqual(c({ exit_status: 64, problem: null }), { kind: "unsupported" });
    assert.deepStrictEqual(c({ problem: "timeout", message: "" }), { kind: "timeout" });
    assert.deepStrictEqual(c({ problem: "not-found", message: "No such file or directory" }), { kind: "missing", message: "No such file or directory" });
    assert.deepStrictEqual(c({ exit_status: 1, problem: null, message: "Traceback\n  boom\u202E" }), { kind: "failed", exit: 1, message: "Traceback boom" });
    assert.deepStrictEqual(c({ problem: "terminated" }), { kind: "failed", exit: null, message: "terminated" });
    assert.deepStrictEqual(c(undefined), { kind: "failed", exit: null, message: null });
    assert.strictEqual(c({ exit_status: 2, message: "y".repeat(1000) }).message.length, SB.LIMITS.reason);
});

/* ---------- manifests ---------- */

t("packageOfManifestPath", () => {
    assert.strictEqual(SB.packageOfManifestPath("/usr/share/cockpit/cronjobs/manifest.json"), "cronjobs");
    assert.strictEqual(SB.packageOfManifestPath("/usr/share/cockpit/image-updates/manifest.json"), "image-updates");
    ["/usr/share/cockpit/Bad_Name/manifest.json", "/usr/share/cockpit/../etc/manifest.json", "/usr/share/cockpit/a/b/manifest.json",
     "/usr/local/share/cockpit/x/manifest.json", "/usr/share/cockpit/cronjobs/manifest.json\n", "/usr/share/cockpit/-x/manifest.json",
     "usr/share/cockpit/x/manifest.json", "", null].forEach(p => assert.strictEqual(SB.packageOfManifestPath(p), null, JSON.stringify(p)));
});

t("statusEntry of the manifest fixtures", () => {
    const m = name => json("manifests/" + name + ".json");
    assert.deepStrictEqual(SB.statusEntry(m("cronjobs")), { command: "/usr/lib/cockpit-cronjobs/cronjobs-status" });
    assert.deepStrictEqual(SB.statusEntry(m("image-updates")), { command: "/usr/lib/cockpit-image-updates/diun-update.py" });
    assert.deepStrictEqual(SB.statusEntry(m("update-gaps")), { command: "/usr/lib/cockpit-update-gaps/gaps-status.py" });
    /* the helper's folder need not be named after the package folder ("security") */
    assert.deepStrictEqual(SB.statusEntry(m("security")), { command: "/usr/lib/cockpit-security-monitor/security.py" });
    assert.deepStrictEqual(SB.statusEntry(m("host-settings")), { command: "/usr/lib/cockpit-host-settings/host-settings.py" });
    assert.strictEqual(SB.statusEntry(m("update-gaps-old")), null);
    assert.strictEqual(SB.statusEntry(m("system")), null);
    assert.strictEqual(SB.statusEntry(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "manifest.json"), "utf8"))), null,
        "the board reports no status itself");
    assert.deepStrictEqual(SB.statusEntry(m("hostile-sh")), { rejected: true });
    assert.deepStrictEqual(SB.statusEntry(m("hostile-dotdot")), { rejected: true });
    assert.deepStrictEqual(SB.statusEntry(m("hostile-shapes")), { rejected: true });
    assert.deepStrictEqual(SB.statusEntry(m("hostile-args")), { command: "/usr/lib/cockpit-extra/status-helper" });
    assert.strictEqual(SB.statusEntry(null), null);
    assert.strictEqual(SB.statusEntry({ azentrius: "status" }), null);
    assert.deepStrictEqual(SB.statusEntry({ azentrius: { status: [] } }), { rejected: true });
});

t("only commands below /usr/lib/cockpit-NAME/", () => {
    const ok = ["/usr/lib/cockpit-a/b", "/usr/lib/cockpit-image-updates/diun-update.py", "/usr/lib/cockpit-a/b/c/d", "/usr/lib/cockpit-a/_x"];
    const bad = ["/usr/lib/cockpit-/b", "/usr/lib/cockpit-a", "/usr/lib/cockpit-a/", "/usr/lib/cockpit-a/.hidden", "/usr/lib/cockpit-a/b/../c",
                 "/usr/lib/cockpit-a/..", "/usr/lib/cockpit-a//b", "/usr/lib/cockpit-a/b c", "/usr/lib/cockpit-a/b\n", "/usr/lib/cockpit-a/b/c/d/e",
                 "/usr/lib/cockpitx/b", "/usr/lib64/cockpit-a/b", "/usr/lib/cockpit-A/b", "usr/lib/cockpit-a/b", "/bin/sh",
                 "/usr/lib/cockpit-a/b;reboot", "/usr/lib/cockpit-a/$(reboot)"];
    ok.forEach(c => assert.ok(SB.COMMAND_RE.test(c), c));
    bad.forEach(c => assert.ok(!SB.COMMAND_RE.test(c), JSON.stringify(c)));
});

t("the status call takes only the command from the manifest", () => {
    const cmd = SB.statusEntry(json("manifests/hostile-args.json")).command;
    assert.deepStrictEqual(SB.statusArgv(cmd, "de"), [cmd, "status", "--lang", "de"]);
    assert.deepStrictEqual(SB.statusArgv(cmd, "en"), [cmd, "status", "--lang", "en"]);
    assert.deepStrictEqual(SB.statusArgv(cmd, "fr"), [cmd, "status", "--lang", "en"]);
});

t("menuLabel", () => {
    assert.strictEqual(SB.menuLabel(json("manifests/cronjobs.json")), "Cron Jobs");
    assert.strictEqual(SB.menuLabel(json("manifests/system.json")), "Overview");
    assert.strictEqual(SB.menuLabel(json("manifests/hostile-shapes.json")), "Shapes", "a label that is no text is skipped");
    assert.strictEqual(SB.menuLabel({}), null);
});

t("packagesOf", () => {
    const p = SB.packagesOf({ cronjobs: json("manifests/cronjobs.json"), Bad_Name: json("manifests/cronjobs.json"), system: json("manifests/system.json") },
                            { "update-gaps": "Permission denied\u0007", "../x": "no" });
    assert.deepStrictEqual(Object.keys(p), ["cronjobs", "system", "update-gaps"]);
    assert.deepStrictEqual(p.cronjobs, { label: "Cron Jobs", entry: { command: "/usr/lib/cockpit-cronjobs/cronjobs-status" } });
    assert.deepStrictEqual(p.system, { label: "Overview", entry: null });
    assert.deepStrictEqual(p["update-gaps"], { label: null, entry: { unreadable: true, message: "Permission denied" } });
    assert.deepStrictEqual(SB.packagesOf(null), {});
});

/* ---------- the host switcher's list ---------- */

/* As the bridge sends it over D-Bus: every attribute a variant. */
function variants(machines) {
    const out = {};
    Object.keys(machines).forEach(host => {
        out[host] = {};
        Object.keys(machines[host]).forEach(k => {
            const v = machines[host][k];
            out[host][k] = { t: typeof v === "boolean" ? "b" : "s", v };
        });
    });
    return out;
}

t("parseMachines: the fixture, plain and as D-Bus variants", () => {
    const raw = json("machines/99-webui.json");
    for (const input of [raw, variants(raw)]) {
        const m = SB.parseMachines(input);
        assert.deepStrictEqual(m.hosts.map(x => [x.key, x.connection, x.label]), [
            ["public-host", "stefan@public-host", null],
            ["build-host", "build-host", "build-host (CI)"],
            ["claw-host", "claw-host:2222", null],
            ["old-host", "old-host", null],
            ["locked-host", "locked-host", null],
        ]);
        assert.deepStrictEqual(m.skipped, ["bad host; rm -rf /", "bad-user"]);
        assert.strictEqual(m.localLabel, null);
    }
});

t("parseMachines: odd input", () => {
    assert.deepStrictEqual(SB.parseMachines(null), { hosts: [], skipped: [], localLabel: null });
    assert.deepStrictEqual(SB.parseMachines({ localhost: { label: "vpn-host", visible: true } }).localLabel, "vpn-host");
    const m = SB.parseMachines({ a: { visible: true, address: "b", port: 22 }, c: "x", d: { visible: true, port: "22; reboot" } });
    assert.deepStrictEqual(m.hosts.map(x => x.connection), ["b:22"]);
    assert.deepStrictEqual(m.skipped, ["d"]);
});

t("connectionString as the host switcher builds it", () => {
    assert.strictEqual(SB.connectionString(null, null, "a"), "a");
    assert.strictEqual(SB.connectionString("u", "22", "a"), "u@a:22");
    assert.strictEqual(SB.connectionString("u", null, "a"), "u@a");
});

t("reachOf", () => {
    assert.deepStrictEqual(SB.reachOf({ problem: "authentication-failed", error: "locked identity: /home/stefan/.ssh/id_ed25519" }),
        { reach: "locked", identity: "/home/stefan/.ssh/id_ed25519" });
    assert.deepStrictEqual(SB.reachOf({ problem: "authentication-failed", error: "authentication-failed" }),
        { reach: "unreachable", problem: "authentication-failed", message: null });
    assert.deepStrictEqual(SB.reachOf({ problem: "no-host", message: "[Errno -2] Name or service not known" }),
        { reach: "unreachable", problem: "no-host", message: "[Errno -2] Name or service not known" });
    assert.deepStrictEqual(SB.reachOf({}), { reach: "unreachable", problem: "disconnected", message: null });
    assert.strictEqual(SB.reachOf({ problem: "<script>" }).problem, "disconnected");
    assert.strictEqual(SB.reachOf(undefined).reach, "unreachable");
});

/* ---------- the board ---------- */

const status = file => ({ kind: "ok", status: SB.validateStatus(read("status/" + file), JSON.parse(read("status/" + file)).addon).status });
const manifests = names => Object.fromEntries(names.map(([pkg, file]) => [pkg, json("manifests/" + file + ".json")]));
const okHost = (key, own, names, results, label) => ({
    key, own, label: label || key, connection: own ? null : key,
    result: { reach: "ok", discovery: "ok", packages: SB.packagesOf(manifests(names)), results },
});

function board() {
    return SB.buildBoard(SB.sortHosts([
        okHost("public-host", false, [["cronjobs", "cronjobs"], ["image-updates", "image-updates"], ["update-gaps", "update-gaps"], ["system", "system"]],
               { cronjobs: status("good-cronjobs-danger.json"), "image-updates": status("good-image-updates.json"), "update-gaps": status("good-update-gaps.json") }),
        okHost("localhost", true, [["cronjobs", "cronjobs"], ["image-updates", "image-updates"]],
               { cronjobs: status("good-cronjobs-ok.json"), "image-updates": { kind: "noaccess" } }, "vpn-host"),
        okHost("claw-host", false, [["cronjobs", "cronjobs"], ["update-gaps", "update-gaps-old"]], { cronjobs: { kind: "timeout" } }),
        okHost("evil-host", false, [["image-updates", "hostile-sh"], ["cronjobs", "cronjobs"]], { cronjobs: { kind: "invalid", reason: "not-json", detail: null } }),
        { key: "old-host", own: false, label: "old-host", connection: "old-host", result: SB.reachOf({ problem: "no-host" }) },
        { key: "locked-host", own: false, label: "locked-host", connection: "locked-host", result: SB.reachOf({ problem: "authentication-failed", error: "locked identity: /k" }) },
        { key: "dark-host", own: false, label: "dark-host", connection: "dark-host", result: { reach: "ok", discovery: "failed", message: "find: timed out" } },
        { key: "new-host", own: false, label: "new-host", connection: "new-host", result: { reach: "loading" } },
    ]), NOW);
}
const row = (rows, key) => rows.find(r => r.host.key === key);
const kinds = r => r.tiles.map(x => [x.pkg || null, x.kind, x.state, x.word]);

t("buildBoard: hosts in the order of the host switcher, this host first", () => {
    assert.deepStrictEqual(board().map(r => r.host.key),
        ["localhost", "claw-host", "dark-host", "evil-host", "locked-host", "new-host", "old-host", "public-host"]);
});

t("buildBoard: one tile per add-on with a status entry, sorted by label", () => {
    const rows = board();
    assert.deepStrictEqual(kinds(row(rows, "public-host")), [
        ["cronjobs", "status", "danger", "danger"],
        ["image-updates", "status", "info", "info"],
        ["update-gaps", "status", "warning", "warning"],
    ]);
    assert.deepStrictEqual(row(rows, "public-host").tiles.map(x => x.label), ["Cron Jobs", "Image Update Monitor", "Update Gaps"]);
    assert.strictEqual(row(rows, "public-host").state, "danger");
});

t("buildBoard: not installed, no status entry, no access", () => {
    const rows = board();
    assert.deepStrictEqual(kinds(row(rows, "localhost")), [
        ["cronjobs", "status", "ok", "ok"],
        ["image-updates", "noaccess", "warning", "noaccess"],
        ["update-gaps", "missing", "none", "missing"],
    ]);
    assert.deepStrictEqual(kinds(row(rows, "claw-host")), [
        ["cronjobs", "error", "warning", "unreadable"],
        ["image-updates", "missing", "none", "missing"],
        ["update-gaps", "nostatus", "none", "nostatus"],
    ]);
    assert.strictEqual(row(rows, "claw-host").tiles[1].jump, false, "nothing to open where it is not installed");
});

t("buildBoard: a refused command and an unreadable answer", () => {
    const rows = board();
    assert.deepStrictEqual(kinds(row(rows, "evil-host")), [
        ["cronjobs", "error", "warning", "unreadable"],
        ["image-updates", "rejected", "warning", "rejected"],
        ["update-gaps", "missing", "none", "missing"],
    ]);
    assert.strictEqual(row(rows, "evil-host").tiles[0].error.reason, "not-json");
});

t("buildBoard: hosts that cannot be read", () => {
    const rows = board();
    assert.deepStrictEqual(kinds(row(rows, "old-host")), [[null, "unreachable", "danger", "unreachable"]]);
    assert.strictEqual(row(rows, "old-host").tiles[0].jump, "host");
    assert.strictEqual(row(rows, "old-host").tiles[0].problem, "no-host");
    assert.deepStrictEqual(kinds(row(rows, "locked-host")), [[null, "locked", "warning", "locked"]]);
    assert.strictEqual(row(rows, "locked-host").tiles[0].identity, "/k");
    assert.deepStrictEqual(kinds(row(rows, "dark-host")), [[null, "discovery", "warning", "discovery"]]);
    assert.deepStrictEqual(kinds(row(rows, "new-host")), [[null, "loading", "none", null]]);
});

t("buildBoard: the label comes from the add-on, else from its manifest, else the package", () => {
    const rows = SB.buildBoard([
        okHost("a", true, [["cronjobs", "cronjobs"], ["extra", "hostile-args"]], { cronjobs: { kind: "timeout" }, extra: { kind: "timeout" } }),
        okHost("b", false, [["image-updates", "hostile-sh"]], {}),
        { key: "c", own: false, label: "c", connection: "c", result: { reach: "ok", discovery: "ok", results: {},
          packages: { "no-label": { label: null, entry: { command: "/usr/lib/cockpit-x/y" } } } } },
    ], NOW);
    assert.deepStrictEqual(rows[0].tiles.map(x => [x.pkg, x.label]), [
        ["cronjobs", "Cron Jobs"], ["extra", "Extra Arguments"], ["image-updates", "Image Update Monitor"], ["no-label", "no-label"]]);
});

t("buildBoard: a host names only its own tiles", () => {
    const renamed = status("good-cronjobs-ok.json");
    renamed.status = Object.assign({}, renamed.status, { label: "Image Update Monitor" });
    const rows = SB.buildBoard([
        okHost("evil", false, [["cronjobs", "cronjobs"]], { cronjobs: renamed }),
        okHost("a", true, [["cronjobs", "cronjobs"]], { cronjobs: { kind: "timeout" } }),
        okHost("b", false, [["system", "system"]], {}),
    ], NOW);
    const tile = key => row(rows, key).tiles[0];
    assert.deepStrictEqual([tile("evil").label, tile("evil").sortLabel], ["Image Update Monitor", "Cron Jobs"]);
    assert.deepStrictEqual([tile("a").label, tile("a").sortLabel], ["Cron Jobs", "Cron Jobs"]);
    assert.deepStrictEqual([tile("b").label, tile("b").kind], ["Cron Jobs", "missing"], "named by this host, not by evil");
});

t("packagesOf: at most MAX_PACKAGES per host", () => {
    const many = {};
    for (let i = 0; i < SB.MAX_PACKAGES + 50; i++) many["p" + String(i).padStart(4, "0")] = json("manifests/cronjobs.json");
    assert.strictEqual(Object.keys(SB.packagesOf(many)).length, SB.MAX_PACKAGES);
});

t("buildBoard: an unreadable manifest is no tile of its own, but shows where the add-on is known", () => {
    const host = okHost("a", true, [["cronjobs", "cronjobs"]], { cronjobs: status("good-cronjobs-ok.json") });
    host.result.packages = SB.packagesOf(manifests([["cronjobs", "cronjobs"]]), { "update-gaps": "Permission denied", other: "x" });
    const other = okHost("b", false, [["update-gaps", "update-gaps"]], { "update-gaps": status("good-update-gaps.json") });
    const rows = SB.buildBoard([host, other], NOW);
    assert.deepStrictEqual(kinds(rows[0]), [["cronjobs", "status", "ok", "ok"], ["update-gaps", "error", "warning", "unreadable"]]);
    assert.strictEqual(rows[0].tiles[1].error.kind, "manifest");
    assert.ok(!rows.some(r => r.tiles.some(x => x.pkg === "other")));
});

t("buildBoard: nothing anywhere", () => {
    const rows = SB.buildBoard([okHost("a", true, [["system", "system"]], {})], NOW);
    assert.deepStrictEqual(rows.map(r => r.tiles.length), [0]);
});

t("buildBoard: an out-of-date tile says so", () => {
    const rows = SB.buildBoard([okHost("a", true, [["image-updates", "image-updates"]], { "image-updates": status("good-image-updates-stale.json") })], NOW);
    assert.deepStrictEqual(kinds(rows[0]), [["image-updates", "status", "warning", "stale"]]);
    assert.strictEqual(rows[0].tiles[0].coverage, "stale");
});

/* ---------- coverage ---------- */

t("buildBoard: an answer that rates nothing is a warning, Not checked", () => {
    const rows = SB.buildBoard([okHost("a", true, [["image-updates", "image-updates"]], { "image-updates": status("good-minimal.json") })], NOW);
    assert.deepStrictEqual(kinds(rows[0]), [["image-updates", "status", "warning", "unchecked"]]);
    assert.strictEqual(rows[0].tiles[0].coverage, "unchecked");
    assert.ok(SB.notable(rows[0].tiles[0]), "it stays with only what needs attention");
});

t("coverage of every tile of the board", () => {
    const rows = board();
    const cov = key => row(rows, key).tiles.map(x => [x.pkg || x.kind, x.coverage]);
    assert.deepStrictEqual(cov("localhost"), [["cronjobs", "checked"], ["image-updates", "noaccess"], ["update-gaps", null]]);
    assert.deepStrictEqual(cov("claw-host"), [["cronjobs", "unreadable"], ["image-updates", null], ["update-gaps", null]],
        "not installed and no status entry are no gap of a check");
    assert.deepStrictEqual(cov("evil-host"), [["cronjobs", "unreadable"], ["image-updates", "unreadable"], ["update-gaps", null]]);
    ["old-host", "locked-host", "dark-host", "new-host"].forEach(k => assert.deepStrictEqual(cov(k).map(c => c[1]), [null], k));
    /* good-cronjobs-ok has an entry in state none (jobs without recording): no gap */
    assert.ok(row(rows, "localhost").tiles[0].status.items.some(i => i.state === "none"));
});

t("coverage of every row", () => {
    const rows = board();
    assert.deepStrictEqual(row(rows, "localhost").coverage,
        { total: 2, checked: 1, gaps: [{ pkg: "image-updates", label: "Image Update Monitor", coverage: "noaccess" }] });
    assert.deepStrictEqual(row(rows, "public-host").coverage, { total: 3, checked: 3, gaps: [] });
    assert.deepStrictEqual(row(rows, "claw-host").coverage, { total: 1, checked: 0, gaps: [{ pkg: "cronjobs", label: "Cron Jobs", coverage: "unreadable" }] });
    ["old-host", "locked-host", "dark-host", "new-host"].forEach(k => assert.strictEqual(row(rows, k).coverage, null, k));
});

t("coverageSummary of the board", () => {
    assert.deepStrictEqual(SB.coverageSummary(board()), {
        total: 8, checked: 4, gaps: { unchecked: 0, stale: 0, noaccess: 1, unreadable: 3 }, unread: 3, unreadState: "danger" });
    const fine = SB.buildBoard([okHost("a", true, [["cronjobs", "cronjobs"]], { cronjobs: status("good-cronjobs-ok.json") })], NOW);
    assert.deepStrictEqual(SB.coverageSummary(fine), { total: 1, checked: 1, gaps: { unchecked: 0, stale: 0, noaccess: 0, unreadable: 0 }, unread: 0, unreadState: "none" });
    assert.deepStrictEqual(SB.coverageSummary([]).total, 0);
});

/* ---------- coverage from checks ---------- */

/* The add-ons of the optional parts on three hosts, next to answers without them, and two hosts
   that cannot be read: the scenario "tasks" of the browser tests. Host Settings sends the same
   profile on this host and on public-host (role web: the five add-ons, update-gaps/cve left out);
   build-host has no Host Settings, so no target profile. */
function suite(now) {
    return SB.buildBoard(SB.sortHosts([
        okHost("localhost", true, [["host-settings", "host-settings"], ["cronjobs", "cronjobs"]],
               { "host-settings": status("ext-good-host-settings.json"), cronjobs: status("good-cronjobs-ok.json") }, "vpn-host"),
        okHost("public-host", false, [["cronjobs", "cronjobs"], ["image-updates", "image-updates"], ["security", "security"], ["update-gaps", "update-gaps"],
                                      ["host-settings", "host-settings"], ["system", "system"]],
               { cronjobs: status("good-cronjobs-danger.json"), "image-updates": status("good-image-updates.json"),
                 security: status("ext-good-security.json"), "update-gaps": status("ext-good-update-gaps.json"),
                 "host-settings": status("ext-good-host-settings.json") }),
        okHost("build-host", false, [["cronjobs", "cronjobs"], ["image-updates", "image-updates"], ["system", "system"]],
               { cronjobs: { kind: "noaccess" }, "image-updates": status("good-image-updates-stale.json") }, "build-host (CI)"),
        { key: "old-host", own: false, label: "old-host", connection: "old-host", result: SB.reachOf({ problem: "no-host" }) },
        { key: "locked-host", own: false, label: "locked-host", connection: "locked-host", result: SB.reachOf({ problem: "authentication-failed", error: "locked identity: /k" }) },
    ]), now === undefined ? NOW : now);
}
/* An answer of the add-on x with the given checks (and an item that rates something). */
const withChecks = checks => SB.validateStatus(JSON.stringify({ schema: 1, addon: "x", state: "ok", features: ["checks"], checks,
    items: [{ id: "a", state: "ok", title: "A" }] }), "x").status;

t("checksCoverage: the worst check that applies, and every check with a gap", () => {
    const sec = ext("ext-good-security.json");
    const c = SB.checksCoverage(sec, NOW);
    assert.deepStrictEqual([c.coverage, c.worst.id, c.gaps.map(g => [g.id, g.coverage, g.staleAt])], ["partial", "containers", [["containers", "partial", null]]],
        "partial; fail2ban does not apply and does not count");
    /* an hour after the check both checks are out of date: the first of them shows it */
    const later = SB.checksCoverage(sec, NOW + 3600e3);
    assert.deepStrictEqual([later.coverage, later.worst.id, later.gaps.map(g => [g.id, g.coverage, g.staleAt])],
        ["stale", "exposure", [["exposure", "stale", Date.UTC(2026, 9, 19, 19, 50)], ["containers", "stale", Date.UTC(2026, 9, 19, 19, 50)]]]);
    assert.strictEqual(SB.checksCoverage(sec, Date.UTC(2026, 9, 19, 19, 50)).coverage, "partial", "on the dot it is not out of date yet");
    const gaps = SB.checksCoverage(ext("ext-good-update-gaps.json"), NOW);
    assert.deepStrictEqual([gaps.coverage, gaps.worst.title, gaps.gaps.length], ["unconfigured", "Open CVEs (network data)", 1]);
    const hs = ext("ext-good-host-settings.json");
    assert.deepStrictEqual([SB.checksCoverage(hs, NOW).coverage, SB.checksCoverage(hs, NOW).worst], ["checked", null]);
    assert.strictEqual(SB.checksCoverage(hs, Date.UTC(2026, 9, 19, 19, 11)).coverage, "stale", "Notifications, 15 minutes after 18:55");
});

t("checksCoverage: none without checks, or when no check applies", () => {
    ["real-security.json", "good-cronjobs-ok.json", "ext-broken-shapes.json"].forEach(f => assert.strictEqual(SB.checksCoverage(ext(f), NOW), null, f));
    assert.strictEqual(SB.checksCoverage(withChecks([{ id: "d", state: "notapplicable", title: "D", reason: "no Docker" }]), NOW), null);
    assert.strictEqual(SB.checksCoverage(withChecks([]), NOW), null);
});

t("checksCoverage: the order of the gaps, from partial to no access", () => {
    const order = ["partial", "stale", "unsupported", "failed", "unconfigured", "noaccess"];
    const check = (state, i) => (state === "stale" ? { id: "c" + i, state: "checked", title: "C" + i, checked_at: "2026-10-19T10:00:00Z", stale_after: 60 }
        : { id: "c" + i, state, title: "C" + i });
    for (let n = 1; n <= order.length; n++) {
        const states = order.slice(0, n);
        assert.strictEqual(SB.checksCoverage(withChecks(states.map(check)), NOW).coverage, states[n - 1], states.join(","));
        assert.strictEqual(SB.checksCoverage(withChecks(states.slice().reverse().map(check)), NOW).coverage, states[n - 1], "in any order");
    }
    /* a failed check is no better for being out of date as well */
    assert.strictEqual(SB.checksCoverage(withChecks([{ id: "f", state: "failed", title: "F", checked_at: "2026-10-19T10:00:00Z", stale_after: 60 }]), NOW).coverage, "failed");
});

t("coverage from checks: the tiles, the rows and the board", () => {
    const rows = suite();
    const cov = key => row(rows, key).tiles.filter(x => x.coverage).map(x => [x.pkg, x.coverage, x.gapCheck ? x.gapCheck.id : null, x.gapChecks.map(c => c.id)]);
    /* public-host's profile leaves out update-gaps/cve, which is not set up there: no gap */
    assert.deepStrictEqual(cov("public-host"), [
        ["cronjobs", "checked", null, []], ["host-settings", "checked", null, []], ["image-updates", "checked", null, []],
        ["security", "partial", "containers", ["containers"]], ["update-gaps", "checked", null, []]]);
    /* this host sends the same profile: three of the five add-ons it expects are not installed */
    assert.deepStrictEqual(cov("localhost"), [["cronjobs", "checked", null, []], ["host-settings", "checked", null, []],
        ["image-updates", "missing", null, []], ["security", "missing", null, []], ["update-gaps", "missing", null, []]]);
    assert.deepStrictEqual(row(rows, "public-host").coverage, { total: 5, checked: 4, gaps: [
        { pkg: "security", label: "Security Monitor", coverage: "partial", check: "Container hardening" }] });
    assert.deepStrictEqual(row(rows, "build-host").coverage, { total: 2, checked: 0, gaps: [
        { pkg: "cronjobs", label: "Cron Jobs", coverage: "noaccess" }, { pkg: "image-updates", label: "Image Update Monitor", coverage: "stale" }] },
        "answers without checks as before, with no check named");
    assert.deepStrictEqual(SB.coverageSummary(rows), {
        total: 12, checked: 6, gaps: { unchecked: 0, stale: 1, noaccess: 1, unreadable: 0, missing: 3, partial: 1 }, unread: 2, unreadState: "danger" });
    /* a single item in state none stays no gap: Security Monitor's containers counts through its check */
    assert.ok(row(rows, "public-host").tiles.find(x => x.pkg === "security").status.items.some(i => i.state === "none"));
    assert.strictEqual(row(rows, "public-host").tiles.find(x => x.pkg === "cronjobs").coverage, "checked", "Cron Jobs with an entry in none");
    assert.strictEqual(SB.coverageOf(row(rows, "public-host").tiles.find(x => x.pkg === "security"), NOW + 3600e3), "stale");
});

t("coverage from checks: every check applies or not, whatever the items say", () => {
    const answer = (checks, state) => ({ kind: "ok", status: SB.validateStatus(JSON.stringify({ schema: 1, addon: "x", state, features: ["checks"], checks,
        items: [{ id: "a", state, title: "A" }] }), "x").status });
    const tileFor = result => SB.buildBoard([okHost("a", true, [["x", "hostile-args"]], { x: result })], NOW)[0].tiles[0];
    assert.strictEqual(tileFor(answer([{ id: "c", state: "failed", title: "C" }], "ok")).coverage, "failed", "an answer in OK whose check failed");
    assert.strictEqual(tileFor(answer([{ id: "c", state: "notapplicable", title: "C" }], "ok")).coverage, "checked", "nothing applies: the items decide");
    assert.strictEqual(tileFor(answer([{ id: "c", state: "notapplicable", title: "C" }], "none")).coverage, "unchecked");
});

/* ---------- what needs attention ---------- */

const tasksOf = (rows, now) => SB.buildTasks(rows, now === undefined ? NOW : now);
const keys = m => m.tasks.map(x => x.key);

t("buildTasks: the order of the scenario (state, host not read, exposure, older first, host, add-on)", () => {
    const m = tasksOf(suite());
    assert.deepStrictEqual(m.tasks.map(x => [x.key, x.kind, x.state]), [
        ["old-host/unreachable", "host", "danger"],
        ["public-host/security/finding:port.6379-tcp", "finding", "danger"],
        ["public-host/security/finding:port.5432-tcp", "finding", "danger"],
        ["public-host/cronjobs/item:failed-runs", "item", "danger"],
        ["locked-host/locked", "host", "warning"],
        ["public-host/update-gaps/finding:restart.kernel", "finding", "warning"],
        ["localhost/image-updates/coverage", "coverage", "warning"],
        ["localhost/security/coverage", "coverage", "warning"],
        ["localhost/update-gaps/coverage", "coverage", "warning"],
        ["build-host/cronjobs/coverage", "coverage", "warning"],
        ["build-host/image-updates/coverage", "coverage", "warning"],
        ["public-host/security/coverage", "coverage", "warning"],
        ["build-host/profile", "profile", "info"],
        ["public-host/image-updates/item:updates", "item", "info"],
    ]);
    m.tasks.forEach(x => assert.ok(x.host && x.tile && typeof x.title === "string", x.key));
});

t("buildTasks: a finding with its reasons, its evidence and its place", () => {
    const m = tasksOf(suite());
    const f = key => m.tasks.find(x => x.key === key);
    const older = f("public-host/security/finding:port.6379-tcp");
    assert.deepStrictEqual([older.title, older.item.id, older.since, older.isNew, older.exposure, older.fix, older.exploited, older.link, older.evidence],
        ["6379/tcp redis", "exposure", Date.UTC(2026, 9, 17, 7, 30), false, "internet", "available", null, "#/exposure/6379-tcp",
         { at: Date.UTC(2026, 9, 19, 18, 50), complete: true }]);
    const fresh = f("public-host/security/finding:port.5432-tcp");
    assert.deepStrictEqual([fresh.since, fresh.isNew], [Date.UTC(2026, 9, 19, 18, 30), true], "seen half an hour ago: new");
    assert.strictEqual(tasksOf(suite(), Date.UTC(2026, 9, 20, 18, 30)).tasks.find(x => x.key === fresh.key).isNew, false, "a day later it is not");
    assert.strictEqual(tasksOf(suite(), Date.UTC(2026, 9, 20, 18, 30) - 1).tasks.find(x => x.key === fresh.key).isNew, true);
    const restart = f("public-host/update-gaps/finding:restart.kernel");
    assert.deepStrictEqual([restart.state, restart.fix, restart.exposure, restart.link, restart.evidence],
        ["warning", "available", null, "#/restart", { at: Date.UTC(2026, 9, 19, 18, 45), complete: true }],
        "its acceptance ended at noon: open again, although the item says OK");
});

t("buildTasks: items, summary only without any optional part", () => {
    const m = tasksOf(suite());
    const runs = m.tasks.find(x => x.key === "public-host/cronjobs/item:failed-runs");
    assert.deepStrictEqual([runs.title, runs.item.value, runs.summaryOnly, runs.link, runs.evidence, runs.since, runs.isNew],
        ["Failed runs (24 h)", "2", true, "", { at: Date.UTC(2026, 9, 19, 18, 50, 3), complete: null }, null, false]);
    assert.ok(m.tasks.filter(x => x.kind === "item").every(x => x.summaryOnly), "Cron Jobs and Image Update Monitor send no optional part");
    /* an answer with features, but nothing usable in them: its items are tasks, not summary only
       (next to the notice that the host sends no target profile) */
    const rows = SB.buildBoard([okHost("a", true, [["cronjobs", "cronjobs"]], { cronjobs: status("ext-broken-shapes.json") })], NOW);
    assert.deepStrictEqual(tasksOf(rows).tasks.filter(x => x.kind !== "profile").map(x => [x.key, x.kind, x.state, x.summaryOnly]),
        [["a/cronjobs/item:y", "item", "warning", false]]);
    /* an item a check owns: complete while the check is checked and in time */
    const owned = { kind: "ok", status: SB.validateStatus(JSON.stringify({ schema: 1, addon: "x", state: "warning", checked_at: "2026-10-19T18:00:00Z",
        features: ["checks"], checks: [{ id: "c", state: "partial", title: "C", item: "a", checked_at: "2026-10-19T18:40:00Z" }],
        items: [{ id: "a", state: "warning", title: "A" }, { id: "b", state: "info", title: "B" }] }), "x").status };
    const tasks = tasksOf(SB.buildBoard([okHost("h", true, [["x", "hostile-args"]], { x: owned })], NOW)).tasks;
    assert.deepStrictEqual(tasks.filter(x => x.kind === "item").map(x => [x.item.id, x.evidence]),
        [["a", { at: Date.UTC(2026, 9, 19, 18, 40), complete: false }], ["b", { at: Date.UTC(2026, 9, 19, 18), complete: null }]],
        "the owning check's time and completeness, else the answer's time");
});

t("buildTasks: gaps in the coverage, from checks and from tiles", () => {
    const m = tasksOf(suite());
    const gap = key => m.tasks.find(x => x.key === key);
    const sec = gap("public-host/security/coverage");
    assert.deepStrictEqual([sec.coverage, sec.check.id, sec.checks.map(c => c.id), sec.title, sec.link, sec.evidence],
        ["partial", "containers", ["containers"], "Container hardening", "#/containers", { at: Date.UTC(2026, 9, 19, 18, 50), complete: null }],
        "the check has no link: its item's");
    /* Open CVEs, not set up, is no gap on public-host, whose profile leaves it out; on a host
       without a profile it is one */
    assert.strictEqual(gap("public-host/update-gaps/coverage"), undefined);
    const bare = tasksOf(SB.buildBoard([okHost("public-host", false, [["update-gaps", "update-gaps"]], { "update-gaps": status("ext-good-update-gaps.json") })], NOW));
    const cve = bare.tasks.find(x => x.key === "public-host/update-gaps/coverage");
    assert.deepStrictEqual([cve.coverage, cve.check.reason, cve.link, cve.evidence.at], ["unconfigured", "the network data are not set up", "", Date.UTC(2026, 9, 19, 18, 45)],
        "no link and no item: the add-on's start; no time: the answer's");
    const old = gap("build-host/image-updates/coverage");
    assert.deepStrictEqual([old.coverage, old.check, old.checks, old.link, old.evidence.at], ["stale", null, [], null, Date.UTC(2026, 9, 18, 5, 12)],
        "an answer without checks: the tile's own link (null), the time of its data");
    const noaccess = gap("build-host/cronjobs/coverage");
    assert.deepStrictEqual([noaccess.coverage, noaccess.evidence, noaccess.tile.kind], ["noaccess", null, "noaccess"]);
    /* an entry out of date is a gap of its add-on, not a task of its own */
    assert.ok(!m.tasks.some(x => x.key.startsWith("build-host/image-updates/item:")));
    /* an hour later the Security Monitor's checks are out of date: still one task, now "stale" */
    const later = tasksOf(suite(NOW + 3600e3), NOW + 3600e3).tasks.filter(x => x.key === "public-host/security/coverage");
    assert.deepStrictEqual(later.map(x => [x.coverage, x.check.id, x.checks.map(c => [c.id, c.coverage])]),
        [["stale", "exposure", [["exposure", "stale"], ["containers", "stale"]]]]);
});

t("buildTasks: accepted findings and checks that do not apply", () => {
    const m = tasksOf(suite());
    assert.deepStrictEqual(m.accepted.map(a => [a.key, a.finding.title, a.host.key, a.tile.pkg, a.until]),
        [["public-host/update-gaps/finding:held.postgresql-16", "postgresql-16 is held", "public-host", "update-gaps", Date.UTC(2026, 9, 30)]]);
    assert.ok(!m.tasks.some(x => x.key === "public-host/update-gaps/finding:held.postgresql-16"), "accepted is no task");
    assert.deepStrictEqual(m.notApplicable.map(n => [n.host.key, n.tile.pkg, n.check.id, n.check.reason, n.check.byProfile || false]),
        [["public-host", "security", "fail2ban", "fail2ban is not installed", false],
         ["public-host", "update-gaps", "cve", "network data off on purpose", true]],
        "what the add-on finds itself, and what the host's profile leaves out");
    /* in the morning both acceptances ran: no finding of Update Gaps is a task */
    const morning = tasksOf(suite(Date.UTC(2026, 9, 19, 11)), Date.UTC(2026, 9, 19, 11));
    assert.deepStrictEqual(morning.accepted.map(a => a.finding.fid), ["restart.kernel", "held.postgresql-16"], "soonest end first");
    assert.ok(!morning.tasks.some(x => x.key.startsWith("public-host/update-gaps/finding:")));
    /* on the day the other one ends, that finding is open again */
    const end = Date.UTC(2026, 9, 30);
    assert.ok(tasksOf(suite(end), end).tasks.some(x => x.key === "public-host/update-gaps/finding:held.postgresql-16"));
    assert.deepStrictEqual(tasksOf(suite(end), end).accepted, []);
});

t("buildTasks: hosts that cannot be read, and the old fixtures", () => {
    const m = tasksOf(board());
    assert.deepStrictEqual(m.tasks.map(x => [x.key, x.kind, x.state]), [
        ["old-host/unreachable", "host", "danger"],
        ["public-host/cronjobs/item:failed-runs", "item", "danger"],
        ["dark-host/discovery", "host", "warning"],
        ["locked-host/locked", "host", "warning"],
        ["localhost/image-updates/coverage", "coverage", "warning"],
        ["claw-host/cronjobs/coverage", "coverage", "warning"],
        ["evil-host/cronjobs/coverage", "coverage", "warning"],
        ["evil-host/image-updates/coverage", "coverage", "warning"],
        ["public-host/update-gaps/item:held", "item", "warning"],
        ["public-host/update-gaps/item:reboot", "item", "warning"],
        ["localhost/profile", "profile", "info"],
        ["claw-host/profile", "profile", "info"],
        ["evil-host/profile", "profile", "info"],
        ["public-host/profile", "profile", "info"],
        ["public-host/image-updates/item:updates", "item", "info"],
        ["public-host/update-gaps/item:pro", "item", "info"],
    ], "a host still loading has no task yet; not installed and no status are none; no host sends a profile: a notice for each one read");
    assert.deepStrictEqual(m.tasks.filter(x => x.kind === "coverage").map(x => x.coverage), ["noaccess", "unreadable", "unreadable", "unreadable"]);
    assert.deepStrictEqual([m.accepted, m.notApplicable], [[], []]);
    /* single entries in state none (jobs without records, roll-out) are no tasks */
    assert.ok(!m.tasks.some(x => /unrecorded|rollout/.test(x.key)));
    assert.deepStrictEqual(tasksOf([]), { tasks: [], accepted: [], notApplicable: [] });
});

t("buildTasks: the order of findings within a state", () => {
    const f = (fid, extra) => Object.assign({ fid, state: "warning", title: fid.toUpperCase() }, extra);
    const answer = { kind: "ok", status: SB.validateStatus(JSON.stringify({ schema: 1, addon: "x", state: "danger", checked_at: "2026-10-19T18:00:00Z",
        features: ["findings"], items: [{ id: "a", state: "warning", title: "A", findings: { complete: true, list: [
            f("none-old", { since: "2026-10-01T00:00:00Z" }),
            f("local", { exposure: "local" }),
            f("internal", { exposure: "internal" }),
            f("restricted", { exposure: "restricted" }),
            f("internet-new", { exposure: "internet", since: "2026-10-19T18:00:00Z" }),
            f("internet-old", { exposure: "internet", since: "2026-10-10T00:00:00Z" }),
            f("internet-exploited", { exposure: "internet", exploited: "known", since: "2026-10-19T18:30:00Z" }),
            f("internet-plain", { exposure: "internet" }),
            f("danger-local", { state: "danger", exposure: "local" }),
            f("info-internet", { state: "info", exposure: "internet" }),
            f("ok-internet", { state: "ok", exposure: "internet" }),
        ] } }] }), "x").status };
    const rows = SB.buildBoard([okHost("h", true, [["x", "hostile-args"]], { x: answer }),
        { key: "gone", own: false, label: "gone", connection: "gone", result: SB.reachOf({ problem: "authentication-failed", error: "locked identity: /k" }) }], NOW);
    assert.deepStrictEqual(tasksOf(rows).tasks.map(x => x.key.replace(/^h\/x\/finding:/, "")), [
        "danger-local",
        "gone/locked", "internet-exploited", "internet-old", "internet-new", "internet-plain", "restricted", "internal", "local", "none-old",
        "info-internet", "h/profile",
    ], "a finding in OK is no task; no score: each step decides only on a tie of the one before");
});

t("buildTasks: an item whose findings say nothing open is a task of its own", () => {
    const answer = { kind: "ok", status: SB.validateStatus(JSON.stringify({ schema: 1, addon: "x", state: "warning", features: ["findings"],
        items: [{ id: "a", state: "warning", title: "A", findings: { complete: false, list: [{ fid: "f", state: "ok", title: "F" }] } }] }), "x").status };
    const tasks = tasksOf(SB.buildBoard([okHost("h", true, [["x", "hostile-args"]], { x: answer })], NOW)).tasks.filter(x => x.kind !== "profile");
    assert.deepStrictEqual(tasks.map(x => [x.key, x.kind, x.summaryOnly]), [["h/x/item:a", "item", false]]);
});

t("buildTasks: hostile findings stay data", () => {
    const rows = SB.buildBoard([okHost("h", true, [["security", "security"]], { security: status("ext-hostile.json") })], NOW);
    const m = tasksOf(rows);
    const fids = m.tasks.filter(x => x.kind === "finding").map(x => x.finding.fid);
    assert.ok(fids.includes("constructor") && fids.includes("accept-far") && fids.includes("odd"), "names every object has, and an acceptance ten years ahead, are open findings");
    assert.strictEqual(new Set(m.tasks.map(x => x.key)).size, m.tasks.length, "every key once");
    assert.deepStrictEqual(m.accepted, []);
    assert.strictEqual(m.tasks.find(x => x.kind === "finding" && x.finding.fid === "odd").link, "", "a link that leaves the page is none");
    assert.ok(({}).constructor === Object && Object.prototype.polluted === undefined);
});

t("buildTasks: the evidence of a finding says complete only for a complete list", () => {
    const tasksFor = file => tasksOf(SB.buildBoard([okHost("h", true, [["security", "security"]], { security: status(file) })], NOW)).tasks
        .filter(x => x.pkg === "security");
    const evidence = file => tasksFor(file).filter(x => x.kind === "finding").map(x => [x.finding.fid, x.evidence.complete]);
    assert.deepStrictEqual(evidence("ext-complete-no-total.json"), [[FID_B, true], [FID_A, true]]);
    assert.deepStrictEqual(evidence("ext-complete-total-2-one.json"), [[FID_A, false]]);
    assert.deepStrictEqual(evidence("ext-complete-invalid-entry.json"), [[FID_A, false]]);
    /* counts one and lists none: the item stays a task, in its own state */
    assert.deepStrictEqual(tasksFor("ext-complete-total-1-empty.json").map(x => [x.kind, x.state, x.title]),
        [["item", "danger", "Reachable from the internet"]]);
    assert.deepStrictEqual(tasksFor("ext-complete-total-0-checked.json"), [], "counts none, lists none: nothing to do");
});

/* ---------- a host's target profile ---------- */

/* Host Settings' answer (ext-good-host-settings.json) with another profile; without one it sends none. */
const hsWith = profile => {
    const doc = json("status/ext-good-host-settings.json");
    if (profile) doc.profile = profile;
    else doc.features = ["checks"];
    return { kind: "ok", status: SB.validateStatus(JSON.stringify(doc), "host-settings").status };
};
const HS = ["host-settings", "host-settings"];
const tileOn = (rows, key, pkg) => row(rows, key).tiles.find(x => x.pkg === pkg);
const brief = x => [x.pkg, x.kind, x.state, x.word, x.coverage, x.expected, x.gap];

t("expectationOf: the expected add-ons and checks, and the skips that run", () => {
    assert.strictEqual(SB.expectationOf(null, NOW), null);
    const e = SB.expectationOf(ext("ext-good-host-settings.json").profile, NOW);
    assert.deepStrictEqual([e.roles, Array.from(e.addons), Array.from(e.checks), Array.from(e.skips.keys())],
        [["web"], ["host-settings", "update-gaps", "security", "cronjobs", "image-updates"], [], ["update-gaps/cve"]]);
    const hostile = SB.expectationOf(ext("ext-hostile-profile.json").profile, NOW);
    assert.deepStrictEqual([Array.from(hostile.addons), Array.from(hostile.checks)], [["security", "constructor"], ["security/exposure"]],
        "a check makes its add-on expected; names every object has are plain names");
    assert.deepStrictEqual(Array.from(hostile.skips.keys()), ["update-gaps/cve", "security/fail2ban"]);
    const later = SB.expectationOf(ext("ext-hostile-profile.json").profile, Date.UTC(2026, 10, 1));
    assert.deepStrictEqual(Array.from(later.skips.keys()), ["security/fail2ban"], "a skip ends on its until, at the board's clock; one without until stays");
    const whole = SB.expectationOf({ roles: [], expect: [], skip: [{ check: "security", reason: "x", until: null }], setAt: null }, NOW);
    assert.strictEqual(whole.skips.size, 0, "a skip names a check; an add-on alone leaves out nothing");
});

t("gapRating: expected gaps are warnings, optional ones softer", () => {
    const cov = ["checked", "partial", "stale", "failed", "unconfigured", "noaccess", "unsupported", "unchecked", "unreadable", "missing", "notapplicable", null];
    assert.deepStrictEqual(cov.map(c => SB.gapRating(c, true)),
        [null, "warning", "warning", "warning", "warning", "warning", "warning", "warning", "warning", "warning", null, null]);
    assert.deepStrictEqual(cov.map(c => SB.gapRating(c, false)),
        [null, "info", "info", "info", null, null, null, null, "warning", null, null, null]);
    assert.strictEqual(SB.gapRating("constructor", false), null, "only the coverages it knows");
});

t("profile: without one every installed add-on with a status entry is expected, and none other", () => {
    const rows = board();
    rows.forEach(r => r.tiles.filter(x => x.pkg).forEach(x =>
        assert.strictEqual(x.expected, x.kind !== "missing" && x.kind !== "nostatus", r.host.key + "/" + x.pkg)));
    assert.deepStrictEqual(rows.map(r => [r.host.key, r.profile, r.noProfile]), [
        ["localhost", null, true], ["claw-host", null, true], ["dark-host", null, false], ["evil-host", null, true],
        ["locked-host", null, false], ["new-host", null, false], ["old-host", null, false], ["public-host", null, true]],
        "the notice only for hosts that could be read");
    assert.deepStrictEqual(brief(tileOn(rows, "claw-host", "update-gaps")), ["update-gaps", "nostatus", "none", "nostatus", null, false, null]);
    assert.deepStrictEqual(brief(tileOn(rows, "claw-host", "image-updates")), ["image-updates", "missing", "none", "missing", null, false, null]);
    assert.deepStrictEqual(brief(tileOn(rows, "localhost", "image-updates")), ["image-updates", "noaccess", "warning", "noaccess", "noaccess", true, "warning"]);
    /* nothing anywhere: no tiles, no notice */
    assert.deepStrictEqual(SB.buildBoard([okHost("a", true, [["system", "system"]], {})], NOW).map(r => r.noProfile), [false]);
});

t("profile: Host Settings decides for its own host: expected, missing, not expected", () => {
    const rows = suite();
    assert.deepStrictEqual([row(rows, "localhost").profile.roles, row(rows, "public-host").profile.roles, row(rows, "build-host").profile],
        [["web"], ["web"], null]);
    assert.deepStrictEqual(row(rows, "localhost").tiles.map(brief), [
        ["cronjobs", "status", "ok", "ok", "checked", true, null],
        ["host-settings", "status", "ok", "ok", "checked", true, null],
        ["image-updates", "missing", "warning", "absent", "missing", true, "warning"],
        ["security", "missing", "warning", "absent", "missing", true, "warning"],
        ["update-gaps", "missing", "warning", "absent", "missing", true, "warning"]]);
    assert.ok(row(rows, "localhost").tiles.every(x => x.kind !== "missing" || x.jump === false), "a missing add-on opens nothing");
    assert.ok(row(rows, "localhost").tiles.filter(x => x.kind === "missing").every(SB.notable), "and stays with only what needs attention");
    assert.strictEqual(row(rows, "localhost").state, "warning");
    /* the same tiles on build-host, which sends no profile: not installed, no gap */
    assert.deepStrictEqual(["host-settings", "security", "update-gaps"].map(p => brief(tileOn(rows, "build-host", p))), [
        ["host-settings", "missing", "none", "missing", null, false, null],
        ["security", "missing", "none", "missing", null, false, null],
        ["update-gaps", "missing", "none", "missing", null, false, null]], "a profile applies only to the row of the host that sends it");
    assert.deepStrictEqual(row(rows, "localhost").coverage, { total: 5, checked: 2, gaps: [
        { pkg: "image-updates", label: "Image Update Monitor", coverage: "missing" },
        { pkg: "security", label: "Security Monitor", coverage: "missing" },
        { pkg: "update-gaps", label: "Update Gaps", coverage: "missing" }] });
    assert.deepStrictEqual(rows.map(r => r.noProfile), [false, true, false, false, false], "only build-host lacks a profile");
});

t("profile: another add-on's profile is not read, and a host does not decide for another", () => {
    const fake = status("ext-good-security.json");
    fake.status = Object.assign({}, fake.status, { profile: ext("ext-good-host-settings.json").profile });
    const other = Object.assign(json("status/ext-good-host-settings.json"), { addon: "security" });
    const rows = SB.buildBoard([
        okHost("a", true, [["security", "security"], ["cronjobs", "cronjobs"]], { security: fake, cronjobs: status("good-cronjobs-ok.json") }),
        okHost("b", false, [["security", "security"]], { security: { kind: "ok", status: SB.validateStatus(JSON.stringify(other), "security").status } }),
        okHost("c", false, [HS], { "host-settings": hsWith({ roles: ["db"], expect: ["cronjobs", "security"], skip: [], set_at: "2026-10-19T09:00:00Z" }) }),
    ], NOW);
    assert.deepStrictEqual(rows.map(r => [r.host.key, r.profile ? r.profile.roles : null, r.noProfile]), [["a", null, true], ["b", null, true], ["c", ["db"], false]],
        "only Host Settings' own answer counts, from no other add-on");
    assert.ok(row(rows, "a").tiles.every(x => x.expected === (x.kind !== "missing")), "a: as without a profile");
    assert.deepStrictEqual(brief(tileOn(rows, "a", "host-settings")), ["host-settings", "missing", "none", "missing", null, false, null]);
    assert.deepStrictEqual(row(rows, "c").tiles.map(brief), [
        ["cronjobs", "missing", "warning", "absent", "missing", true, "warning"],
        ["host-settings", "status", "ok", "ok", "checked", false, null],
        ["security", "missing", "warning", "absent", "missing", true, "warning"]], "c expects what it names; its own Host Settings is optional there");
    assert.deepStrictEqual(row(rows, "c").coverage.total, 2, "only expected add-ons count");
});

t("profile: an expected add-on that no host reports gets a tile in that row only", () => {
    const rows = SB.buildBoard([
        okHost("a", true, [HS, ["system", "system"]], { "host-settings": status("ext-hostile-profile.json") }),
        okHost("b", false, [["cronjobs", "cronjobs"]], { cronjobs: status("good-cronjobs-ok.json") }),
    ], NOW);
    assert.deepStrictEqual(row(rows, "a").tiles.map(x => [x.pkg, x.label, x.kind, x.word, x.coverage, x.jump]), [
        ["constructor", "constructor", "missing", "absent", "missing", false],
        ["cronjobs", "Cron Jobs", "missing", "missing", null, false],
        ["host-settings", "Host Settings", "status", "ok", "checked", true],
        ["security", "security", "missing", "absent", "missing", false]], "named by the package; a name every object has is a plain name");
    assert.deepStrictEqual(row(rows, "b").tiles.map(x => [x.pkg, x.kind]), [["cronjobs", "status"], ["host-settings", "missing"]], "not on other hosts");
    assert.ok(({}).constructor === Object && Object.prototype.polluted === undefined);
    /* an expected package installed without a status entry that no host reports with one is a gap
       as well, even the board itself (the role bastion does not expect it; an extra expect in
       Host Settings would) */
    const self = SB.buildBoard([okHost("a", true, [HS, ["status-board", "system"]],
        { "host-settings": hsWith({ roles: ["bastion"], expect: ["host-settings", "status-board"], skip: [] }) })], NOW);
    assert.deepStrictEqual(self[0].tiles.map(brief), [
        ["host-settings", "status", "ok", "ok", "checked", true, null],
        ["status-board", "nostatus", "warning", "nostatus", "unsupported", true, "warning"]]);
    assert.deepStrictEqual([self[0].coverage.total, self[0].coverage.checked], [2, 1]);
});

/* ---------- every add-on a host's profile expects, installed or not ---------- */

/* Host Settings' answer with a profile of the role build that expects these add-ons. */
const expecting = (...addons) => hsWith({ roles: ["build"], expect: addons, skip: [] });
/* The manifest of an add-on in a version without the status entry: only its menu label. */
const oldManifest = label => ({ menu: { index: { label } } });
/* A host that could be read, its packages from manifests given as objects ({ pkg: manifest }),
   those that could not be read ({ pkg: message }) and the results of its status calls. */
const hostOf = (key, own, mans, results, unreadable) => ({ key, own, label: key, connection: own ? null : key,
    result: { reach: "ok", discovery: "ok", packages: SB.packagesOf(mans, unreadable), results } });
const HS_MANIFEST = () => json("manifests/host-settings.json");

t("expected: installed without a status entry, reported by no host, is a gap with a task", () => {
    /* Host Settings and the Security Monitor expected, only Host Settings can be checked */
    const rows = SB.buildBoard([hostOf("one-host", true, { "host-settings": HS_MANIFEST(), security: oldManifest("Security Monitor") },
        { "host-settings": expecting("host-settings", "security") })], NOW);
    assert.deepStrictEqual(rows[0].tiles.map(brief), [
        ["host-settings", "status", "ok", "ok", "checked", true, null],
        ["security", "nostatus", "warning", "nostatus", "unsupported", true, "warning"]]);
    assert.deepStrictEqual(rows[0].tiles.map(x => [x.label, x.sortLabel, x.jump]),
        [["Host Settings", "Host Settings", true], ["Security Monitor", "Security Monitor", true]], "named by its own manifest; it opens the add-on");
    assert.deepStrictEqual(rows[0].coverage, { total: 2, checked: 1, gaps: [{ pkg: "security", label: "Security Monitor", coverage: "unsupported" }] },
        "1 of 2 checked");
    assert.deepStrictEqual(SB.coverageSummary(rows),
        { total: 2, checked: 1, gaps: { unchecked: 0, stale: 0, noaccess: 0, unreadable: 0, unsupported: 1 }, unread: 0, unreadState: "none" });
    assert.deepStrictEqual([rows[0].state, rows[0].noProfile, SB.notable(rows[0].tiles[1])], ["warning", false, true]);
    assert.deepStrictEqual(tasksOf(rows).tasks.map(x => [x.key, x.kind, x.state, x.coverage, x.check, x.expected, x.roles, x.tile.jump]),
        [["one-host/security/coverage", "coverage", "warning", "unsupported", null, true, ["build"], true]]);
});

t("expected: not installed is missing; optional and not installed is no alarm", () => {
    const rows = SB.buildBoard([
        hostOf("one-host", true, { "host-settings": HS_MANIFEST() }, { "host-settings": expecting("host-settings", "security") }),
        okHost("two-host", false, [["cronjobs", "cronjobs"]], { cronjobs: status("good-cronjobs-ok.json") }),
    ], NOW);
    assert.deepStrictEqual(row(rows, "one-host").tiles.map(brief), [
        ["cronjobs", "missing", "none", "missing", null, false, null],
        ["host-settings", "status", "ok", "ok", "checked", true, null],
        ["security", "missing", "warning", "absent", "missing", true, "warning"]]);
    assert.deepStrictEqual(row(rows, "one-host").tiles.map(SB.notable), [false, false, true], "only the expected one needs attention");
    assert.deepStrictEqual(row(rows, "one-host").coverage, { total: 2, checked: 1, gaps: [{ pkg: "security", label: "security", coverage: "missing" }] },
        "the optional Cron Jobs does not count");
    assert.deepStrictEqual(tasksOf(rows).tasks.filter(x => x.host.key === "one-host").map(x => [x.key, x.state, x.coverage, x.tile.jump]),
        [["one-host/security/coverage", "warning", "missing", false]], "a task for the missing one, none for the optional one");
});

t("expected: a newer version with the status entry on another host gives no second tile", () => {
    const old = (key, own, profile) => hostOf(key, own, Object.assign({ security: oldManifest("Security Monitor") }, profile ? { "host-settings": HS_MANIFEST() } : {}),
        profile ? { "host-settings": expecting("host-settings", "security") } : {});
    const newer = okHost("two-host", false, [["security", "security"]], { security: status("ext-good-security.json") });
    const rows = SB.buildBoard([old("one-host", true, true), newer], NOW);
    assert.deepStrictEqual(row(rows, "one-host").tiles.map(x => x.pkg), ["host-settings", "security"], "one tile of the Security Monitor");
    assert.deepStrictEqual(brief(tileOn(rows, "one-host", "security")), ["security", "nostatus", "warning", "nostatus", "unsupported", true, "warning"]);
    assert.deepStrictEqual(brief(tileOn(rows, "two-host", "security")), ["security", "status", "danger", "danger", "partial", true, "warning"]);
    assert.deepStrictEqual(tasksOf(rows).tasks.filter(x => x.kind === "coverage").map(x => [x.key, x.coverage]),
        [["one-host/security/coverage", "unsupported"], ["two-host/security/coverage", "partial"]], "the gap stays on its host");
    /* without the newer host: every host whose profile expects it has its own gap, a host without
       a profile shows nothing for it */
    const alone = SB.buildBoard([old("one-host", true, true), old("three-host", false, true), old("four-host", false, false)], NOW);
    assert.deepStrictEqual(alone.map(r => [r.host.key, r.tiles.filter(x => x.pkg === "security").map(x => [x.kind, x.state, x.coverage])]), [
        ["one-host", [["nostatus", "warning", "unsupported"]]], ["three-host", [["nostatus", "warning", "unsupported"]]], ["four-host", []]]);
    assert.deepStrictEqual(tasksOf(alone).tasks.filter(x => x.kind === "coverage").map(x => x.key),
        ["one-host/security/coverage", "three-host/security/coverage"]);
});

t("expected: a manifest whose status cannot be read is a visible gap", () => {
    const one = (mans, results, unreadable) => SB.buildBoard([hostOf("one-host", true, Object.assign({ "host-settings": HS_MANIFEST() }, mans),
        Object.assign({ "host-settings": expecting("host-settings", "security") }, results), unreadable)], NOW)[0];
    const cases = {
        /* the manifest cannot be read, and no host reports the add-on */
        manifest: one({}, {}, { security: "Permission denied" }),
        /* a status command the board refuses to run */
        refused: one({ security: { menu: { index: { label: "Security Monitor" } }, azentrius: { status: ["/bin/sh", "status"] } } }, {}),
        /* an answer that is no JSON */
        answer: one({ security: json("manifests/security.json") }, { security: { kind: "invalid", reason: "not-json", detail: null } }),
    };
    assert.deepStrictEqual(Object.keys(cases).map(k => brief(cases[k].tiles.find(x => x.pkg === "security"))), [
        ["security", "error", "warning", "unreadable", "unreadable", true, "warning"],
        ["security", "rejected", "warning", "rejected", "unreadable", true, "warning"],
        ["security", "error", "warning", "unreadable", "unreadable", true, "warning"]]);
    assert.strictEqual(cases.manifest.tiles.find(x => x.pkg === "security").error.kind, "manifest");
    Object.keys(cases).forEach(k => {
        assert.deepStrictEqual([cases[k].coverage.total, cases[k].coverage.checked, cases[k].coverage.gaps.map(g => g.coverage)], [2, 1, ["unreadable"]], k);
        assert.ok(cases[k].tiles.filter(x => x.pkg === "security").every(SB.notable), k);
    });
    assert.deepStrictEqual(tasksOf([cases.manifest]).tasks.map(x => [x.key, x.state, x.coverage]), [["one-host/security/coverage", "warning", "unreadable"]]);
    /* not expected, an unreadable manifest that no host reports stays without a tile, as before */
    const optional = SB.buildBoard([hostOf("one-host", true, { "host-settings": HS_MANIFEST() }, { "host-settings": expecting("host-settings") },
        { security: "Permission denied" })], NOW)[0];
    assert.deepStrictEqual(optional.tiles.map(x => x.pkg), ["host-settings"]);
});

t("profile: expected in a version without the status entry is a gap; not expected it is not", () => {
    const rows = SB.buildBoard([
        okHost("a", true, [HS, ["update-gaps", "update-gaps-old"]], { "host-settings": hsWith({ roles: [], expect: ["update-gaps"], skip: [] }) }),
        okHost("b", false, [HS, ["update-gaps", "update-gaps-old"], ["cronjobs", "cronjobs"]],
               { "host-settings": hsWith({ roles: [], expect: ["cronjobs"], skip: [] }), cronjobs: status("good-cronjobs-ok.json") }),
        okHost("c", false, [["update-gaps", "update-gaps"]], { "update-gaps": status("good-update-gaps.json") }),
    ], NOW);
    assert.deepStrictEqual(brief(tileOn(rows, "a", "update-gaps")), ["update-gaps", "nostatus", "warning", "nostatus", "unsupported", true, "warning"]);
    assert.deepStrictEqual(brief(tileOn(rows, "b", "update-gaps")), ["update-gaps", "nostatus", "none", "nostatus", null, false, null]);
    const gap = tasksOf(rows).tasks.find(x => x.key === "a/update-gaps/coverage");
    assert.deepStrictEqual([gap.state, gap.coverage, gap.check, gap.evidence, gap.expected, gap.roles], ["warning", "unsupported", null, null, true, []]);
});

t("profile: gaps of add-ons the host is not expected to have are softer", () => {
    const onlyHs = hsWith({ roles: ["build"], expect: ["host-settings"], skip: [] });
    const rows = SB.buildBoard([okHost("a", true, [HS, ["cronjobs", "cronjobs"], ["image-updates", "image-updates"], ["security", "security"], ["update-gaps", "update-gaps"]], {
        "host-settings": onlyHs, cronjobs: { kind: "noaccess" }, "image-updates": status("good-image-updates-stale.json"),
        security: status("ext-good-security.json"), "update-gaps": { kind: "invalid", reason: "not-json", detail: null } })], NOW);
    assert.deepStrictEqual(rows[0].tiles.map(brief), [
        ["cronjobs", "noaccess", "none", "noaccess", "noaccess", false, null],
        ["host-settings", "status", "ok", "ok", "checked", true, null],
        ["image-updates", "status", "warning", "stale", "stale", false, "info"],
        ["security", "status", "danger", "danger", "partial", false, "info"],
        ["update-gaps", "error", "warning", "unreadable", "unreadable", false, "warning"]],
        "no access unrated (a neutral tile), out of date and partly checked a notice, unreadable still a warning; the tile's own state stays");
    assert.ok(!SB.notable(rows[0].tiles[0]), "an unrated tile leaves with only what needs attention");
    assert.deepStrictEqual(rows[0].coverage, { total: 1, checked: 1, gaps: [] }, "the host's line counts the expected add-ons");
    const m = tasksOf(rows);
    assert.deepStrictEqual(m.tasks.filter(x => x.kind === "coverage").map(x => [x.key, x.state, x.coverage, x.expected, x.roles]), [
        ["a/update-gaps/coverage", "warning", "unreadable", false, ["build"]],
        ["a/image-updates/coverage", "info", "stale", false, ["build"]],
        ["a/security/coverage", "info", "partial", false, ["build"]]]);
    assert.ok(m.tasks.some(x => x.key === "a/security/finding:port.5432-tcp" && x.state === "danger"), "its findings stay tasks as they are");
    /* an answer that rates nothing, and checks that failed or are not set up */
    const quiet = SB.buildBoard([okHost("a", true, [HS, ["image-updates", "image-updates"], ["update-gaps", "update-gaps"]], {
        "host-settings": onlyHs, "image-updates": status("good-minimal.json"), "update-gaps": status("ext-good-update-gaps.json") })], NOW);
    assert.deepStrictEqual(quiet[0].tiles.filter(x => x.pkg !== "host-settings").map(brief), [
        ["image-updates", "status", "none", "unchecked", "unchecked", false, null],
        ["update-gaps", "status", "warning", "warning", "unconfigured", false, null]]);
    assert.deepStrictEqual(tasksOf(quiet).tasks.filter(x => x.kind === "coverage"), []);
    const failed = { kind: "ok", status: SB.validateStatus(JSON.stringify({ schema: 1, addon: "security", state: "ok", features: ["checks"],
        checks: [{ id: "a", state: "noaccess", title: "A" }, { id: "b", state: "failed", title: "B" }], items: [{ id: "x", state: "ok", title: "X" }] }), "security").status };
    const worst = SB.buildBoard([okHost("a", true, [HS, ["security", "security"]], { "host-settings": onlyHs, security: failed })], NOW)[0].tiles[1];
    assert.deepStrictEqual([worst.coverage, worst.gapCheck.id, worst.gap], ["noaccess", "a", "info"], "a notice of one check is not hidden by an unrated worse one");
});

t("profile: a skip makes its check not applicable while it runs, at the board's clock", () => {
    const until = Date.UTC(2026, 9, 20);
    const profile = { roles: ["web"], expect: ["host-settings", "update-gaps", "security"],
        skip: [{ check: "update-gaps/cve", reason: "network data off on purpose", until: "2026-10-20T00:00:00Z" },
               { check: "security/fail2ban", reason: "CrowdSec instead" }] };
    const at = now => SB.buildBoard([okHost("a", true, [HS, ["update-gaps", "update-gaps"], ["security", "security"]], {
        "host-settings": hsWith(profile), "update-gaps": status("ext-good-update-gaps.json"), security: status("ext-good-security.json") })], now);
    const before = at(NOW);
    const gaps = tileOn(before, "a", "update-gaps");
    assert.deepStrictEqual([gaps.coverage, gaps.gap, gaps.status.checks.map(c => [c.id, c.state, c.reason, c.byProfile || false, c.until === undefined ? "-" : c.until])],
        ["checked", null, [["held", "checked", null, false, "-"], ["restart", "checked", null, false, "-"], ["cve", "notapplicable", "network data off on purpose", true, until]]]);
    assert.strictEqual(ext("ext-good-update-gaps.json").checks[2].state, "unconfigured", "the add-on's answer itself stays as it is");
    const fail2ban = tileOn(before, "a", "security").status.checks.find(c => c.id === "fail2ban");
    assert.deepStrictEqual([fail2ban.reason, fail2ban.byProfile], ["fail2ban is not installed", undefined], "what the add-on finds itself stays its own");
    const m = tasksOf(before);
    assert.ok(!m.tasks.some(x => x.key === "a/update-gaps/coverage"), "a skipped check is no gap");
    assert.deepStrictEqual(m.notApplicable.map(n => [n.tile.pkg, n.check.id, n.check.reason, n.check.byProfile || false]),
        [["security", "fail2ban", "fail2ban is not installed", false], ["update-gaps", "cve", "network data off on purpose", true]]);
    /* on the day the skip ends the check counts again */
    const after = at(until);
    assert.deepStrictEqual([tileOn(after, "a", "update-gaps").coverage, tileOn(after, "a", "update-gaps").gap], ["unconfigured", "warning"]);
    assert.ok(tasksOf(after, until).tasks.some(x => x.key === "a/update-gaps/coverage" && x.state === "warning"));
    assert.strictEqual(at(until - 1)[0].tiles.find(x => x.pkg === "update-gaps").coverage, "checked", "a moment before it still runs");
});

t("profile: a check in expect makes its add-on expected", () => {
    const rows = SB.buildBoard([
        okHost("a", true, [HS, ["security", "security"]], { "host-settings": hsWith({ roles: ["web"], expect: ["security/exposure"], skip: [] }),
                                                            security: status("ext-good-security.json") }),
        okHost("b", false, [HS], { "host-settings": hsWith({ roles: ["web"], expect: ["security/exposure"], skip: [] }) }),
    ], NOW);
    assert.deepStrictEqual(brief(tileOn(rows, "a", "security")), ["security", "status", "danger", "danger", "partial", true, "warning"],
        "expected: its gap is a warning, not a notice");
    assert.deepStrictEqual(brief(tileOn(rows, "b", "security")), ["security", "missing", "warning", "absent", "missing", true, "warning"]);
    assert.deepStrictEqual(brief(tileOn(rows, "a", "host-settings")), ["host-settings", "status", "ok", "ok", "checked", false, null]);
    assert.deepStrictEqual(rows.map(r => r.coverage), [
        { total: 1, checked: 0, gaps: [{ pkg: "security", label: "Security Monitor", coverage: "partial", check: "Container hardening" }] },
        { total: 1, checked: 0, gaps: [{ pkg: "security", label: "Security Monitor", coverage: "missing" }] }]);
});

t("buildTasks: an expected add-on that is missing", () => {
    const m = tasksOf(suite());
    const gap = m.tasks.find(x => x.key === "localhost/security/coverage");
    assert.deepStrictEqual([gap.kind, gap.state, gap.title, gap.coverage, gap.check, gap.checks, gap.link, gap.evidence, gap.expected, gap.roles, gap.tile.jump],
        ["coverage", "warning", "", "missing", null, [], null, null, true, ["web"], false]);
    assert.deepStrictEqual(m.tasks.filter(x => x.kind === "coverage" && x.roles).map(x => [x.key, x.expected]), [
        ["localhost/image-updates/coverage", true], ["localhost/security/coverage", true], ["localhost/update-gaps/coverage", true],
        ["public-host/security/coverage", true]], "the gaps of hosts with a profile carry its roles");
});

t("buildTasks: the notice of a host without a target profile", () => {
    const m = tasksOf(suite());
    const notice = m.tasks.filter(x => x.kind === "profile");
    assert.deepStrictEqual(notice.map(x => [x.key, x.state, x.title, x.host.key, x.tile.kind, x.tile.jump, x.pkg, x.link, x.evidence]),
        [["build-host/profile", "info", "", "build-host", "profile", false, null, null, null]], "never a warning; without Host Settings nothing to open");
    /* Host Settings installed in a version without the profile: the notice opens it */
    const rows = SB.buildBoard([okHost("a", true, [HS, ["cronjobs", "cronjobs"]], { "host-settings": hsWith(null), cronjobs: status("good-cronjobs-ok.json") })], NOW);
    const own = tasksOf(rows).tasks.filter(x => x.kind === "profile");
    assert.deepStrictEqual(own.map(x => [x.key, x.tile.pkg, x.tile.jump, x.pkg, x.link]), [["a/profile", "host-settings", true, "host-settings", ""]]);
    assert.deepStrictEqual(rows[0].coverage, { total: 2, checked: 2, gaps: [] }, "without a profile as before");
    assert.deepStrictEqual(tasksOf(SB.buildBoard([okHost("a", true, [["system", "system"]], {})], NOW)).tasks, [], "no notice where the board shows nothing");
});

t("coverageSummary: only expected add-ons count", () => {
    assert.deepStrictEqual(SB.coverageSummary(suite()), {
        total: 12, checked: 6, gaps: { unchecked: 0, stale: 1, noaccess: 1, unreadable: 0, missing: 3, partial: 1 }, unread: 2, unreadState: "danger" });
    const onlyHs = hsWith({ roles: [], expect: ["host-settings"], skip: [] });
    const rows = SB.buildBoard([okHost("a", true, [HS, ["cronjobs", "cronjobs"], ["image-updates", "image-updates"]],
        { "host-settings": onlyHs, cronjobs: { kind: "noaccess" }, "image-updates": status("good-image-updates-stale.json") })], NOW);
    assert.deepStrictEqual(SB.coverageSummary(rows), { total: 1, checked: 1, gaps: { unchecked: 0, stale: 0, noaccess: 0, unreadable: 0 }, unread: 0, unreadState: "none" },
        "add-ons the host is not expected to have are no gap of the board's coverage");
});

t("buildBoard: a tile says when another host runs a newer version", () => {
    const rows = SB.buildBoard([
        okHost("a", true, [["update-gaps", "update-gaps"], ["image-updates", "image-updates"]],
               { "update-gaps": status("good-update-gaps.json"), "image-updates": status("good-image-updates-stale.json") }),
        okHost("b", false, [["update-gaps", "update-gaps"], ["image-updates", "image-updates"]],
               { "update-gaps": status("real-update-gaps.json"), "image-updates": status("good-image-updates.json") }),
        okHost("c", false, [["image-updates", "image-updates"]], { "image-updates": status("real-image-updates.json") }),
    ], NOW);
    const newer = key => row(rows, key).tiles.map(x => [x.pkg, x.status.version, x.newer || null]);
    assert.deepStrictEqual(newer("a"), [["image-updates", "0.19.1", "0.24.1"], ["update-gaps", "0.1.0", "0.6.0"]]);
    assert.deepStrictEqual(newer("b"), [["image-updates", "0.20.0", "0.24.1"], ["update-gaps", "0.6.0", null]]);
    assert.deepStrictEqual(row(rows, "c").tiles.filter(x => x.kind === "status").map(x => x.newer || null), [null], "the newest says nothing");
});

t("buildBoard: versions it cannot compare say nothing", () => {
    const odd = version => {
        const s = status("good-cronjobs-ok.json");
        s.status = Object.assign({}, s.status, { version });
        return s;
    };
    const rows = SB.buildBoard([
        okHost("a", true, [["cronjobs", "cronjobs"]], { cronjobs: odd("latest") }),
        okHost("b", false, [["cronjobs", "cronjobs"]], { cronjobs: odd(null) }),
        okHost("c", false, [["cronjobs", "cronjobs"]], { cronjobs: odd("2.8.0") }),
        okHost("d", false, [["cronjobs", "cronjobs"]], { cronjobs: odd("2.8.0") }),
    ], NOW);
    assert.deepStrictEqual(rows.map(r => r.tiles[0].newer || null), [null, null, null, null]);
});

/* ---------- package names that every object inherits ---------- */

t("buildBoard: packages named like inherited properties (constructor, tostring) are plain packages", () => {
    const manifest = (label, name) => ({ menu: { index: { label } }, azentrius: { status: ["/usr/lib/cockpit-" + name + "/status", "status"] } });
    const answer = (pkg, label, state) => ({ kind: "ok", status: SB.validateStatus(JSON.stringify(
        { schema: 1, addon: pkg, label, state, items: [{ id: "x", state, title: "X", value: "1" }] }), pkg).status });
    const host = (key, own, mans, results) => ({ key, own, label: key, connection: own ? null : key,
        result: { reach: "ok", discovery: "ok", packages: SB.packagesOf(mans), results } });
    const rows = SB.buildBoard([
        host("a", true, { aaa: manifest("Alpha", "aaa"), constructor: manifest("Constructor", "constructor") },
             { aaa: answer("aaa", "Alpha", "info"), constructor: answer("constructor", "Constructor", "warning") }),
        host("b", false, { cronjobs: json("manifests/cronjobs.json") }, { cronjobs: status("good-cronjobs-ok.json") }),
        host("c", false, { tostring: manifest("To String", "tostring") }, {}),
    ], NOW);
    assert.deepStrictEqual(rows[0].tiles.map(x => [x.pkg, x.label, x.kind, x.state]),
        [["aaa", "Alpha", "status", "info"], ["constructor", "Constructor", "status", "warning"],
         ["cronjobs", "Cron Jobs", "missing", "none"], ["tostring", "To String", "missing", "none"]]);
    /* a host without them: not installed, not "no status" taken from Object.prototype */
    assert.deepStrictEqual(rows[1].tiles.map(x => [x.pkg, x.kind]),
        [["aaa", "missing"], ["constructor", "missing"], ["cronjobs", "status"], ["tostring", "missing"]]);
    /* its own package, but no result: the call failed, not a result inherited from Object */
    assert.deepStrictEqual(rows[2].tiles.find(x => x.pkg === "tostring").kind, "error");
    rows.forEach(r => r.tiles.forEach(x => assert.strictEqual(typeof x.sortLabel, "string", x.pkg)));
    assert.deepStrictEqual(Object.keys(SB.packagesOf({ constructor: manifest("C", "constructor"), valueof: manifest("V", "valueof") })), ["constructor", "valueof"]);
});

/* ---------- the output of a status call, as it streams in ---------- */

t("outputCollector: chunks join up to the limit, past it nothing is kept", () => {
    const c = SB.outputCollector(10);
    assert.strictEqual(c.add("abc"), true);
    assert.strictEqual(c.add("defg"), true);
    assert.strictEqual(c.add("hij"), true, "exactly at the limit is still fine");
    assert.deepStrictEqual([c.text(), c.size, c.tooLarge], ["abcdefghij", 10, false]);
    assert.strictEqual(c.add("k"), false, "one character more is too much");
    assert.deepStrictEqual([c.text(), c.tooLarge], ["", true], "and the buffer is dropped");
    assert.strictEqual(c.add("more"), false, "later chunks are ignored");
    assert.strictEqual(c.text(), "");
});

t("outputCollector: a valid answer in many chunks reads as in one, and the real limit is MAX_OUTPUT", () => {
    const text = read("status/real-security.json");
    const c = SB.outputCollector(SB.MAX_OUTPUT);
    for (let i = 0; i < text.length; i += 7) assert.ok(c.add(text.slice(i, i + 7)));
    assert.strictEqual(c.text(), text);
    assert.strictEqual(SB.validateStatus(c.text(), "security").ok, true);
    const big = SB.outputCollector(SB.MAX_OUTPUT);
    assert.ok(big.add("x".repeat(SB.MAX_OUTPUT)), "64 KiB exactly");
    assert.strictEqual(big.add("x"), false, "64 KiB and one");
    const huge = SB.outputCollector(SB.MAX_OUTPUT);
    let kept = 0;
    for (let i = 0; i < 100 && huge.add("y".repeat(16384)); i++) kept++;
    assert.deepStrictEqual([kept, huge.tooLarge, huge.text().length], [4, true, 0], "a helper that keeps printing is cut off after 64 KiB");
});

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
