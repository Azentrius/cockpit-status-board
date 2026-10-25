// SPDX-License-Identifier: Apache-2.0
/* Stand-in for cockpit.js in the browser tests of Status Board.
 *
 * A bastion (this host, "vpn-host") with the host switcher's list and hosts behind it. What the
 * hosts answer comes from test/fixtures (window.__FIXTURES, put in front of this file by
 * test/serve.py): the manifests, and the output of each add-on's status verb, the German one
 * when there is a .de.json and the page asks with --lang de.
 *
 * Query parameters: scenario=default|real|tasks|edge|hostile|broken|empty, chunk (characters per streamed chunk), badhosts=1 (the invalid names of the
 * machines fixture stay in the list), delay (ms per answer). Tests change window.__mock at run
 * time and read what the page did from it: calls, jumps, watches, unexpected, locations (every
 * cockpit.location.go()). The page's location is its hash (#/hosts), as in Cockpit. */
(function () {
    "use strict";
    const params = new URLSearchParams(location.search);
    const FIX = window.__FIXTURES || {};
    const FIND = ["find", "/usr/share/cockpit", "-mindepth", "2", "-maxdepth", "2", "-name", "manifest.json"];

    function fixture(name) {
        if (!Object.prototype.hasOwnProperty.call(FIX, name)) throw new Error("no fixture " + name);
        return FIX[name];
    }
    const clone = v => JSON.parse(JSON.stringify(v));

    /* A package on a host: its manifest (a fixture in manifests/) and what its status verb answers:
         "name"               the fixture status/name.json (status/name.de.json for --lang de)
         { exit, message }    exits with that code, message on stderr
         { problem }          the channel fails (e.g. not-found: the command does not exist)
         { hang: true }       never answers; only closing the channel ends it
         { huge: true }       an answer longer than 64 KiB
       unreadable: true makes reading its manifest fail. */
    const pkg = (manifest, status, extra) => Object.assign({ manifest, status }, extra || {});
    const cockpitPackages = () => ({ system: pkg("system", null), "status-board": pkg("status-board", null) });
    const host = (hostname, packages, extra) => Object.assign({ reach: "ok", hostname, packages }, extra || {});

    function machinesFixture() {
        const m = JSON.parse(fixture("machines/99-webui.json"));
        if (params.get("badhosts") !== "1") Object.keys(m).filter(k => k.startsWith("bad")).forEach(k => delete m[k]);
        return m;
    }

    const SCENARIOS = {
        /* The four hosts of the fixture that answer, and two that do not. */
        default: () => ({
            machines: machinesFixture(),
            hosts: {
                localhost: host("vpn-host", Object.assign(cockpitPackages(), {
                    cronjobs: pkg("cronjobs", "good-cronjobs-ok"),
                    "image-updates": pkg("image-updates", "good-image-updates"),
                })),
                "stefan@public-host": host("public-host", {
                    system: pkg("system", null),
                    cronjobs: pkg("cronjobs", "good-cronjobs-danger"),
                    "image-updates": pkg("image-updates", "good-image-updates"),
                    "update-gaps": pkg("update-gaps", "good-update-gaps"),
                }),
                "build-host": host("build-host", {
                    system: pkg("system", null),
                    cronjobs: pkg("cronjobs", { exit: 77, message: "" }),
                    "image-updates": pkg("image-updates", "good-image-updates-stale"),
                    "update-gaps": pkg("update-gaps-old", null),
                }),
                "claw-host:2222": host("claw-host", {
                    system: pkg("system", null),
                    cronjobs: pkg("cronjobs", "good-cronjobs-ok"),
                    "update-gaps": pkg("update-gaps", { exit: 1, message: "Traceback (most recent call last):\n  File \"/usr/lib/cockpit-update-gaps/gaps-status.py\", line 12\nPermissionError: [Errno 13] Permission denied" }),
                }),
                "old-host": { reach: "no-host" },
                "locked-host": { reach: "locked" },
            },
        }),
        /* The four add-ons with the answers they give (status/real-*.json): all four on public-host,
           the Security Monitor on its recordings of the other hosts, the rest from the good
           fixtures; the README's screenshots. */
        real: () => {
            const machines = machinesFixture();
            delete machines["old-host"];
            delete machines["locked-host"];
            return {
                machines,
                hosts: {
                    localhost: host("vpn-host", Object.assign(cockpitPackages(), {
                        cronjobs: pkg("cronjobs", "good-cronjobs-ok"),
                        "image-updates": pkg("image-updates", "good-image-updates"),
                        security: pkg("security", "real-security-edge"),
                        "update-gaps": pkg("update-gaps", "good-update-gaps"),
                    })),
                    "stefan@public-host": host("public-host", {
                        system: pkg("system", null),
                        cronjobs: pkg("cronjobs", "real-cronjobs"),
                        "image-updates": pkg("image-updates", "real-image-updates"),
                        security: pkg("security", "real-security"),
                        "update-gaps": pkg("update-gaps", "real-update-gaps"),
                    }),
                    "build-host": host("build-host", {
                        system: pkg("system", null),
                        cronjobs: pkg("cronjobs", "good-cronjobs-ok"),
                        "image-updates": pkg("image-updates", "good-image-updates-stale"),
                        security: pkg("security", "real-security-ci"),
                        "update-gaps": pkg("update-gaps", "good-update-gaps"),
                    }),
                    "claw-host:2222": host("claw-host", {
                        system: pkg("system", null),
                        cronjobs: pkg("cronjobs", "good-cronjobs-ok"),
                        security: pkg("security", "real-security-ipv6"),
                        "update-gaps": pkg("update-gaps", "good-update-gaps"),
                    }),
                },
            };
        },
        /* The optional parts of the contract next to answers without them, for the tab "Needs
           attention": Security Monitor and Update Gaps with checks and findings (two ports
           reachable from the internet, a check done in part, an acceptance that runs and one that
           has ended, a check not set up, one that does not apply), Host Settings with checks and a
           profile; Cron Jobs and Image Update Monitor as before (summary only, no access, out of
           date); a host that cannot be reached and one with a locked key. The profile (role web,
           five add-ons, update-gaps/cve left out) comes from Host Settings on this host, which
           lacks three of the add-ons it expects, and on public-host, where Open CVEs is then not
           applicable; build-host has no Host Settings, so no target profile. */
        tasks: () => {
            const machines = machinesFixture();
            delete machines["claw-host"];
            return {
                machines,
                hosts: {
                    localhost: host("vpn-host", Object.assign(cockpitPackages(), {
                        "host-settings": pkg("host-settings", "ext-good-host-settings"),
                        cronjobs: pkg("cronjobs", "good-cronjobs-ok"),
                    })),
                    "stefan@public-host": host("public-host", {
                        system: pkg("system", null),
                        cronjobs: pkg("cronjobs", "good-cronjobs-danger"),
                        "image-updates": pkg("image-updates", "good-image-updates"),
                        security: pkg("security", "ext-good-security"),
                        "update-gaps": pkg("update-gaps", "ext-good-update-gaps"),
                        "host-settings": pkg("host-settings", "ext-good-host-settings"),
                    }),
                    "build-host": host("build-host", {
                        system: pkg("system", null),
                        cronjobs: pkg("cronjobs", { exit: 77, message: "" }),
                        "image-updates": pkg("image-updates", "good-image-updates-stale"),
                    }),
                    "old-host": { reach: "no-host" },
                    "locked-host": { reach: "locked" },
                },
            };
        },
        /* Package names that are also names of what every object inherits ("constructor"), and
           status output at and past the limit of 64 KiB, streamed in chunks; one host that is fine. */
        edge: () => ({
            machines: { "big-host": { visible: true }, "fine-host": { visible: true } },
            hosts: {
                localhost: host("vpn-host", Object.assign(cockpitPackages(), {
                    aaa: pkg("edge-aaa", { doc: { label: "Alpha", state: "info", items: [{ id: "a", state: "info", title: "A things", value: "1" }] } }),
                    constructor: pkg("edge-constructor", { doc: { label: "Constructor", state: "warning", items: [{ id: "c", state: "warning", title: "C things", value: "2" }] } }),
                })),
                "big-host": host("big-host", {
                    exact: pkg("edge-exact", { size: 65536 }),
                    over: pkg("edge-over", { size: 65537 }),
                    flood: pkg("edge-flood", { flood: 16384 }),
                }),
                "fine-host": host("fine-host", { cronjobs: pkg("cronjobs", "good-cronjobs-ok") }),
            },
        }),
        /* Hosts that send what they should not. */
        hostile: () => ({
            machines: {
                "evil-host": { visible: true, label: "<img src=x onerror=window.__pwned='host'>" },
                "bidi-host": { visible: true },
            },
            hosts: {
                localhost: host("vpn-host", Object.assign(cockpitPackages(), { cronjobs: pkg("cronjobs", "good-cronjobs-ok") })),
                "evil-host": host("evil-host", {
                    cronjobs: pkg("cronjobs", "hostile-markup"),
                    "image-updates": pkg("hostile-sh", "good-image-updates"),
                    dotdot: pkg("hostile-dotdot", "good-cronjobs-ok"),
                    extra: pkg("hostile-args", { huge: true }),
                    "update-gaps": pkg("update-gaps", "hostile-long"),
                }, { findJunk: ["/usr/share/cockpit/Bad_Name/manifest.json", "/usr/share/cockpit/../../etc/manifest.json", "/etc/passwd", ""] }),
                "bidi-host": host("bidi-host<script>", {
                    cronjobs: pkg("cronjobs", "hostile-proto"),
                    "update-gaps": pkg("update-gaps", "hostile-bidi"),
                }),
            },
        }),
        /* Answers that are broken, and hosts that cannot be read in other ways. */
        broken: () => ({
            machines: {
                "broken-host": { visible: true },
                "half-host": { visible: true },
                "dark-host": { visible: true },
                "nobridge-host": { visible: true },
                "hostkey-host": { visible: true },
                "changedkey-host": { visible: true },
            },
            hosts: {
                localhost: host("vpn-host", cockpitPackages()),
                "broken-host": host("broken-host", {
                    cronjobs: pkg("cronjobs", { text: fixture("status/broken-not-json.txt") }),
                    "image-updates": pkg("image-updates", "broken-schema-2"),
                    "update-gaps": pkg("update-gaps", "broken-wrong-addon"),
                    extra: pkg("hostile-args", { problem: "not-found", message: "" }),
                }),
                "half-host": host("half-host", { cronjobs: pkg("cronjobs", "good-cronjobs-ok", { unreadable: true }) }),
                "dark-host": host("dark-host", {}, { findFails: "find: '/usr/share/cockpit': Permission denied" }),
                "nobridge-host": { reach: "no-cockpit" },
                "hostkey-host": { reach: "unknown-host" },
                "changedkey-host": { reach: "invalid-hostkey" },
            },
        }),
        /* No add-on with a status anywhere yet: one host answers, one does not. */
        empty: () => ({
            machines: { localhost: { visible: true }, "quiet-host": { visible: true }, "old-host": { visible: true } },
            hosts: {
                localhost: host("vpn-host", cockpitPackages()),
                "quiet-host": host("quiet-host", { system: pkg("system", null) }),
                "old-host": { reach: "no-host" },
            },
        }),
    };

    const scenario = (SCENARIOS[params.get("scenario") || "default"] || SCENARIOS.default)();
    const M = window.__mock = {
        machines: scenario.machines,
        hosts: scenario.hosts,
        failMachines: false,
        delay: +(params.get("delay") || 30),
        /* characters per chunk of a streamed status answer; closes: every channel the page closed */
        chunk: +(params.get("chunk") || 1000),
        closes: [],
        calls: [],
        jumps: [],
        watches: [],
        unexpected: [],
        locations: [],
        dbusOpen: 0,
        listeners: [],
        locationListeners: [],
        /* cockpit.manifests of this host, as ../manifests.js gives them */
        localManifests() {
            const out = {};
            const h = M.hosts.localhost;
            Object.keys(h.packages).forEach(name => { out[name] = JSON.parse(fixture("manifests/" + h.packages[name].manifest + ".json")); });
            return out;
        },
        setHidden(value) {
            window.cockpit.hidden = value;
            M.listeners.forEach(f => f());
        },
        clone,
    };

    function fail(o) {
        return Object.assign(new Error(o.message || o.problem || ""), { problem: null, exit_status: null }, o);
    }
    /* What the bridge sends when it cannot reach a host (src/cockpit/remote.py). */
    function closeOf(reach) {
        switch (reach) {
        case "locked": return { problem: "authentication-failed", error: "locked identity: /home/stefan/.ssh/id_ed25519",
                                "auth-method-results": { publickey: "not-provided" } };
        case "no-host": return { problem: "no-host", message: "[Errno -2] Name or service not known" };
        default: return { problem: reach };
        }
    }
    const hostOf = opts => (opts && opts.host) || "localhost";
    const reachable = h => h && (!h.reach || h.reach === "ok");
    const commandOf = p => {
        const m = JSON.parse(fixture("manifests/" + p.manifest + ".json"));
        return m.azentrius && Array.isArray(m.azentrius.status) ? m.azentrius.status[0] : null;
    };

    /* size: a valid answer of exactly that many characters (padded), for the limit of 64 KiB. */
    function answer(status, lang, name) {
        if (typeof status === "string") {
            const de = "status/" + status + "." + lang + ".json";
            return Object.prototype.hasOwnProperty.call(FIX, de) ? FIX[de] : fixture("status/" + status + ".json");
        }
        if (!status) throw fail({ problem: "not-found", message: "" });
        if (status.text !== undefined) return status.text;
        if (status.huge) return JSON.stringify({ schema: 1, addon: "extra", state: "ok", items: [], pad: "x".repeat(70000) });
        if (status.doc) return JSON.stringify(Object.assign({ schema: 1, addon: name }, status.doc));
        if (status.size) {
            const doc = { schema: 1, addon: name, label: "Exact " + status.size, state: "ok", summary: "padded", items: [], pad: "" };
            doc.pad = "x".repeat(status.size - JSON.stringify(doc).length);
            return JSON.stringify(doc);
        }
        if (status.exit !== undefined) throw fail({ exit_status: status.exit, message: status.message || "" });
        throw fail({ problem: status.problem, message: status.message || "" });
    }

    function spawn(args, opts) {
        const target = hostOf(opts);
        M.calls.push({ kind: "spawn", host: target, args: args.slice(), opts: clone(opts || {}) });
        let settle = null;
        let closed = false;
        let streamer = null;
        let streamed = 0;
        const p = new Promise((resolve, reject) => { settle = { resolve, reject }; });
        const proc = {
            then: (a, b) => p.then(a, b),
            catch: f => p.catch(f),
            finally: f => p.finally(f),
            /* As cockpit.js: with a stream callback the data goes there in chunks and the promise
               resolves with nothing; without one, all of it comes when the channel ends. */
            stream(fn) { streamer = fn; return proc; },
            input() { return proc; },
            close(problem) {
                if (closed) return;
                closed = true;
                M.closes.push({ host: target, args: args.slice(), problem: problem || null, streamed, at: Date.now() });
                setTimeout(() => settle.reject(fail({ problem: problem || "terminated", message: "" })), 5);
            },
        };
        /* the answer of a status command: all at once, or in chunks of M.chunk to the stream */
        const deliver = text => setTimeout(() => {
            if (closed) return;
            if (!streamer) { closed = true; settle.resolve(text); return; }
            let pos = 0;
            const next = () => {
                if (closed) return;
                if (pos >= text.length) { closed = true; settle.resolve(""); return; }
                const piece = text.slice(pos, pos + M.chunk);
                pos += piece.length;
                streamed += piece.length;
                streamer(piece);
                setTimeout(next, 1);
            };
            next();
        }, M.delay);
        const later = fn => setTimeout(() => {
            if (closed) return;
            closed = true;
            try { settle.resolve(fn()); } catch (ex) { settle.reject(ex); }
        }, M.delay);
        const h = M.hosts[target];
        if (!reachable(h)) {
            later(() => { throw fail(h ? closeOf(h.reach) : { problem: "no-host" }); });
            return proc;
        }
        if (JSON.stringify(args) === JSON.stringify(FIND)) {
            if (h.findFails) later(() => { throw fail({ exit_status: 1, message: h.findFails }); });
            else later(() => Object.keys(h.packages).map(n => "/usr/share/cockpit/" + n + "/manifest.json").concat(h.findJunk || []).join("\n") + "\n");
            return proc;
        }
        if (args.length === 4 && args[1] === "status" && args[2] === "--lang") {
            const name = Object.keys(h.packages).find(n => commandOf(h.packages[n]) === args[0]);
            if (!name) {
                later(() => { throw fail({ problem: "not-found", message: "No such file or directory" }); });
                return proc;
            }
            const status = h.packages[name].status;
            if (status && status.hang) return proc;
            /* flood: a helper that keeps printing chunks of that size until the channel is closed */
            if (status && status.flood) {
                const piece = "x".repeat(status.flood);
                const tick = () => {
                    if (closed) return;
                    streamed += piece.length;
                    if (streamer) streamer(piece);
                    setTimeout(tick, 2);
                };
                setTimeout(tick, M.delay);
                return proc;
            }
            let text;
            try { text = answer(status, args[3], name); } catch (ex) { later(() => { throw ex; }); return proc; }
            deliver(text);
            return proc;
        }
        M.unexpected.push({ host: target, args: args.slice() });
        later(() => { throw fail({ problem: "not-found", message: "unexpected command" }); });
        return proc;
    }

    function file(path, opts) {
        const target = hostOf(opts);
        const o = opts || {};
        M.calls.push({ kind: "file", host: target, path, opts: { host: o.host, superuser: o.superuser, syntax: o.syntax === JSON ? "JSON" : o.syntax } });
        return {
            read() {
                return new Promise((resolve, reject) => setTimeout(() => {
                    const h = M.hosts[target];
                    if (!reachable(h)) { reject(fail(h ? closeOf(h.reach) : { problem: "no-host" })); return; }
                    if (path === "/proc/sys/kernel/hostname") {
                        if (h.hostname === undefined) reject(fail({ problem: "not-found" }));
                        else resolve(h.hostname + "\n");
                        return;
                    }
                    const m = /^\/usr\/share\/cockpit\/([^/]+)\/manifest\.json$/.exec(path);
                    const p = m ? h.packages[m[1]] : null;
                    if (!p) { resolve(null); return; }     /* like Cockpit: a missing file reads as null */
                    if (p.unreadable) { reject(fail({ problem: "access-denied", message: "Permission denied" })); return; }
                    const text = fixture("manifests/" + p.manifest + ".json");
                    try { resolve(o.syntax ? o.syntax.parse(text) : text); } catch (ex) { reject(ex); }
                }, M.delay));
            },
            watch() {
                M.watches.push({ host: target, path });
                if (o.host) throw new Error("cockpit.file().watch() ignores the host option; the board must not use it");
                return { remove() {} };
            },
            close() {},
        };
    }

    /* An echo channel answers what it is sent, once the host is reachable. */
    function channel(opts) {
        const target = hostOf(opts);
        M.calls.push({ kind: "channel", host: target, payload: opts.payload, opts: clone(opts) });
        const listeners = { message: [], close: [] };
        let closed = false;
        const fire = (type, ...rest) => (listeners[type] || []).slice().forEach(f => f({ type }, ...rest));
        const shut = options => {
            if (closed) return;
            closed = true;
            fire("close", options);
        };
        return {
            addEventListener(type, f) { (listeners[type] = listeners[type] || []).push(f); },
            removeEventListener(type, f) { listeners[type] = (listeners[type] || []).filter(x => x !== f); },
            send(data) {
                setTimeout(() => {
                    if (closed) return;
                    const h = M.hosts[target];
                    if (!h) { shut({ problem: "no-host", message: "" }); return; }
                    if (h.reach === "hang") return;
                    if (!reachable(h)) { shut(closeOf(h.reach)); return; }
                    if (opts.payload === "echo") fire("message", data);
                }, M.delay);
            },
            close(problem) { setTimeout(() => shut(problem ? { problem } : {}), 0); },
        };
    }

    /* D-Bus variants, as the bridge sends the Machines property: a{sa{sv}} */
    function variants(machines) {
        const out = {};
        Object.keys(machines).forEach(h => {
            out[h] = {};
            Object.keys(machines[h]).forEach(k => {
                const v = machines[h][k];
                out[h][k] = { t: typeof v === "boolean" ? "b" : "s", v };
            });
        });
        return out;
    }

    function dbus(name, opts) {
        if (name !== null || !opts || opts.bus !== "internal") throw new Error("unexpected D-Bus " + name + " " + JSON.stringify(opts));
        M.calls.push({ kind: "dbus", host: hostOf(opts), opts: clone(opts) });
        M.dbusOpen++;
        let open = true;
        return {
            proxy(iface, path) {
                if (iface !== "cockpit.Machines" || path !== "/machines") throw new Error("unexpected proxy " + iface + " " + path);
                const proxy = { valid: false };
                proxy.wait = () => new Promise((resolve, reject) => setTimeout(() => {
                    if (M.failMachines) { reject(fail({ problem: "not-found", message: "cockpit.Machines: not-found" })); return; }
                    proxy.valid = true;
                    proxy.Machines = variants(M.machines);
                    resolve();
                }, M.delay));
                return proxy;
            },
            close() {
                if (open) M.dbusOpen--;
                open = false;
            },
        };
    }

    /* cockpit.location as cockpit.js keeps it: the path of the page's hash ("#/hosts" is
       ["hosts"], an empty hash []); go() sets the hash. Every change of the hash (go(), Back, the
       shell) fires "locationchanged". */
    function currentLocation() {
        const href = window.location.hash.replace(/^#/, "");
        const q = href.indexOf("?");
        return {
            href,
            path: (q === -1 ? href : href.slice(0, q)).split("/").filter(Boolean).map(decodeURIComponent),
            options: {},
            go(path) {
                const target = "/" + (Array.isArray(path) ? path.map(encodeURIComponent).join("/") : String(path).replace(/^\//, ""));
                M.locations.push(target);
                window.location.hash = "#" + target;
            },
        };
    }
    window.addEventListener("hashchange", () => M.locationListeners.slice().forEach(f => f({ type: "locationchanged" })));

    window.cockpit = {
        language: "en",
        transport: { host: "localhost" },
        hidden: false,
        manifests: {},
        spawn,
        file,
        channel,
        dbus,
        jump: (path, target) => M.jumps.push([path, target === undefined ? null : target]),
        addEventListener: (type, f) => {
            if (type === "visibilitychange") M.listeners.push(f);
            else if (type === "locationchanged") M.locationListeners.push(f);
        },
    };
    Object.defineProperty(window.cockpit, "location", { get: currentLocation, enumerable: true });
}());
