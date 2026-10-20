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
        ["image-updates", "noaccess", "none", "noaccess"],
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
});

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
