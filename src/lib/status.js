/* Status Board: the rules for everything that comes from a host.
 *
 * The board reads three kinds of data: the host list of Cockpit's host switcher, the manifests
 * of the packages on each host, and the output of each add-on's `status` verb (the status
 * contract, docs/STATUS-CONTRACT.md). All of it is data, never code: this file checks it, removes
 * control characters, cuts every text to a fixed length and turns it into what the board shows.
 * Nothing here touches the DOM or Cockpit, so the unit tests load it in Node; the page sets every
 * text it takes from here with textContent.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
(function (root) {
    "use strict";

    /* The five states of the status language, from least to most severe. */
    const STATES = ["none", "ok", "info", "warning", "danger"];
    const RANK = { none: 0, ok: 1, info: 2, warning: 3, danger: 4 };
    /* Their labels in the shared design files (azentrius.css). "ok" is the status language's
       "good", whose class is az-label--success; "none" is the plain label. */
    const LABEL_CLASS = {
        none: "az-label", ok: "az-label az-label--success", info: "az-label az-label--info",
        warning: "az-label az-label--warning", danger: "az-label az-label--danger",
    };

    /* A package folder under /usr/share/cockpit, and the target of cockpit.jump(). */
    const PACKAGE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
    const ITEM_ID_RE = /^[a-z0-9-]{1,40}$/;
    /* A place inside the add-on's own page; nothing that leaves it. */
    const LINK_RE = /^#\/[A-Za-z0-9/_-]{0,80}$/;
    /* The status command of a manifest: below /usr/lib/cockpit-NAME/, one to three plain path
       segments. A segment cannot start with a dot, so "." and ".." never pass. */
    const COMMAND_RE = /^\/usr\/lib\/cockpit-[a-z0-9][a-z0-9-]{0,40}(?:\/[A-Za-z0-9_][A-Za-z0-9._-]{0,80}){1,3}$/;
    const MANIFEST_PATH_RE = /^\/usr\/share\/cockpit\/([a-z0-9][a-z0-9-]{0,40})\/manifest\.json$/;
    const TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
    /* Hosts of the host switcher: name or address, user, port. */
    const HOST_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,252}$/;
    const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,31}$/;
    const PORT_RE = /^[0-9]{1,5}$/;

    /* Longest texts in characters; longer ones end in "…". */
    const LIMITS = { label: 60, version: 40, summary: 200, title: 80, value: 40, detail: 200, host: 80, reason: 300 };
    const MAX_ITEMS = 50;
    /* Packages per host that count (a host has some twenty); more would only crowd the board. */
    const MAX_PACKAGES = 200;
    /* The output of one status call; anything longer is not read at all. */
    const MAX_OUTPUT = 64 * 1024;
    const MAX_STALE_AFTER = 10 * 366 * 86400;

    const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const rank = s => (own(RANK, s) ? RANK[s] : 0);
    const worse = (a, b) => (rank(b) > rank(a) ? b : a);
    const isState = s => typeof s === "string" && own(RANK, s);

    /* Control characters, zero-width characters and the bidirectional controls (which can make a
       text read differently than it is) go; line breaks and tabs become spaces. */
    const INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;

    /* A text from a host as the board shows it, or null when there is none. */
    function cleanText(value, max) {
        if (typeof value !== "string") return null;
        let s = value.replace(/[\t\n\r]+/g, " ").replace(INVISIBLE_RE, "").replace(/ {2,}/g, " ").trim();
        if (!s) return null;
        const chars = Array.from(s);
        if (chars.length > max) s = chars.slice(0, max - 1).join("").trimEnd() + "…";
        return s;
    }

    /* An ISO 8601 time with a zone ("2026-10-19T18:36:00Z") in ms, or null. */
    function parseTime(value) {
        if (typeof value !== "string") return null;
        const m = TIME_RE.exec(value);
        if (!m) return null;
        /* Date.parse reads three digits of a fraction for certain; Python writes six. */
        const ms = Date.parse(m[1] + (m[2] ? m[2].slice(0, 4) : "") + m[3]);
        return Number.isFinite(ms) ? ms : null;
    }

    /* ---------- the status contract, version 1 ---------- */

    const fail = (reason, detail) => ({ ok: false, reason, detail: detail === undefined ? null : detail });

    function validateItem(raw) {
        if (!isObject(raw)) return null;
        if (typeof raw.id !== "string" || !ITEM_ID_RE.test(raw.id)) return null;
        if (!isState(raw.state)) return null;
        const title = cleanText(raw.title, LIMITS.title);
        if (!title) return null;
        const value = typeof raw.value === "number" && Number.isFinite(raw.value) ? String(raw.value) : raw.value;
        return {
            id: raw.id,
            state: raw.state,
            title,
            value: cleanText(value, LIMITS.value),
            detail: cleanText(raw.detail, LIMITS.detail),
            link: typeof raw.link === "string" && LINK_RE.test(raw.link) ? raw.link : null,
            checkedAt: parseTime(raw.checked_at),
            staleAfter: Number.isInteger(raw.stale_after) && raw.stale_after > 0 && raw.stale_after <= MAX_STALE_AFTER
                ? raw.stale_after : null,
        };
    }

    /* The output of `status --lang xx` of the package pkg: { ok: true, status } with every field
       checked and cut, or { ok: false, reason, detail }. Unknown fields are ignored; an item that
       breaks the rules is left out (status.dropped counts them). */
    function validateStatus(output, pkg) {
        if (typeof output !== "string") return fail("not-text");
        if (output.length > MAX_OUTPUT) return fail("too-large");
        let data;
        try {
            data = JSON.parse(output);
        } catch (_) {
            return fail("not-json");
        }
        if (!isObject(data)) return fail("not-object");
        if (data.schema !== 1) {
            const v = data.schema;
            return fail("schema", typeof v === "number" || typeof v === "string" ? cleanText(String(v), 12) : null);
        }
        if (typeof data.addon !== "string" || !PACKAGE_RE.test(data.addon)) return fail("addon");
        if (pkg !== undefined && data.addon !== pkg) return fail("addon-mismatch", data.addon);
        if (!isState(data.state)) return fail("state");
        if (!Array.isArray(data.items)) return fail("items");

        const items = [];
        const seen = new Set();
        let dropped = 0;
        for (const raw of data.items) {
            const item = items.length < MAX_ITEMS ? validateItem(raw) : null;
            if (!item || seen.has(item.id)) {
                dropped++;
                continue;
            }
            seen.add(item.id);
            items.push(item);
        }
        return {
            ok: true,
            status: {
                addon: data.addon,
                label: cleanText(data.label, LIMITS.label),
                version: cleanText(data.version, LIMITS.version),
                checkedAt: parseTime(data.checked_at),
                state: data.state,
                summary: cleanText(data.summary, LIMITS.summary),
                items,
                dropped,
            },
        };
    }

    /* The state of an add-on from its items (contract, "States"): the most severe of danger,
       warning and info; else ok when one item is ok; else none. */
    function stateOfItems(items) {
        return items.reduce((s, it) => worse(s, it.state), "none");
    }

    /* What a tile of a valid status shows at the time now (ms):
         state       the add-on's state, never better than its items say, at least warning when
                     data is out of date (an item past checked_at + stale_after)
         staleSince  when the first item went out of date, or null
         byAge       true when only the age made it a warning
         key         the most important item: the most severe one (out of date counts as
                     warning), one with a value before one without, else the first
         checkedAt   the time of the data: the status's own, else the newest item's */
    function evaluate(status, now) {
        let staleSince = null;
        const ranked = status.items.map((item, index) => {
            let state = item.state;
            let staleAt = null;
            if (item.checkedAt !== null && item.staleAfter !== null) {
                const at = item.checkedAt + item.staleAfter * 1000;
                if (now > at) {
                    staleAt = at;
                    staleSince = staleSince === null ? at : Math.min(staleSince, at);
                    state = worse(state, "warning");
                }
            }
            return { item, index, state, staleAt };
        });
        const reported = worse(status.state, stateOfItems(status.items));
        const state = staleSince === null ? reported : worse(reported, "warning");
        const top = ranked.slice().sort((a, b) =>
            rank(b.state) - rank(a.state) || (b.item.value ? 1 : 0) - (a.item.value ? 1 : 0) || a.index - b.index)[0];
        const times = status.items.map(it => it.checkedAt).filter(t => t !== null);
        return {
            state,
            staleSince,
            byAge: staleSince !== null && rank(reported) < RANK.warning,
            key: top ? Object.assign({}, top.item, { state: top.state, staleAt: top.staleAt }) : null,
            checkedAt: status.checkedAt !== null ? status.checkedAt : (times.length ? Math.max.apply(null, times) : null),
        };
    }

    /* A status call that failed (a cockpit.spawn error) as a result for the board. */
    function classifyFailure(ex) {
        const e = ex || {};
        const message = cleanText(typeof e.message === "string" ? e.message : "", LIMITS.reason);
        if (e.exit_status === 77 || e.problem === "access-denied") return { kind: "noaccess" };
        if (e.exit_status === 64) return { kind: "unsupported" };
        if (e.problem === "timeout") return { kind: "timeout" };
        if (e.problem === "not-found") return { kind: "missing", message };
        if (typeof e.exit_status === "number") return { kind: "failed", exit: e.exit_status, message };
        return { kind: "failed", exit: null, message: message || cleanText(String(e.problem || ""), 60) };
    }

    /* ---------- manifests ---------- */

    /* The package of a path that `find /usr/share/cockpit -mindepth 2 -maxdepth 2 -name
       manifest.json` printed, or null for anything else. */
    function packageOfManifestPath(path) {
        const m = typeof path === "string" ? MANIFEST_PATH_RE.exec(path) : null;
        return m ? m[1] : null;
    }

    /* What a manifest says about the status contract:
         { command }   the status command, checked (contract, "Finding the add-ons")
         { rejected }  there is a status entry, but its command is not allowed
         null          no status entry */
    function statusEntry(manifest) {
        if (!isObject(manifest) || !isObject(manifest.azentrius) || !own(manifest.azentrius, "status")) return null;
        const argv = manifest.azentrius.status;
        const cmd = Array.isArray(argv) ? argv[0] : null;
        if (typeof cmd === "string" && COMMAND_RE.test(cmd)) return { command: cmd };
        return { rejected: true };
    }

    /* The first menu or tools label of a manifest (for a package that sends no label itself). */
    function menuLabel(manifest) {
        if (!isObject(manifest)) return null;
        for (const section of ["menu", "tools", "dashboard"]) {
            const entries = isObject(manifest[section]) ? manifest[section] : {};
            for (const k of Object.keys(entries)) {
                const label = isObject(entries[k]) ? cleanText(entries[k].label, LIMITS.label) : null;
                if (label) return label;
            }
        }
        return null;
    }

    /* The command line of a status call: only the checked command, then always
       "status --lang LANG", whatever else the manifest lists. */
    function statusArgv(command, lang) {
        return [command, "status", "--lang", lang === "de" ? "de" : "en"];
    }

    /* The packages of a host from its manifests ({ name: manifest }) and the manifests that could
       not be read ({ name: error message }), sorted by name; names that are not plain package
       folders are left out. entry is statusEntry(), or { unreadable, message }. */
    function packagesOf(manifests, unreadable) {
        const good = isObject(manifests) ? manifests : {};
        const bad = isObject(unreadable) ? unreadable : {};
        const out = {};
        Array.from(new Set(Object.keys(good).concat(Object.keys(bad)))).filter(name => PACKAGE_RE.test(name)).sort()
            .slice(0, MAX_PACKAGES).forEach(name => {
                out[name] = own(bad, name)
                    ? { label: null, entry: { unreadable: true, message: cleanText(String(bad[name] || ""), LIMITS.reason) } }
                    : { label: menuLabel(good[name]), entry: statusEntry(good[name]) };
            });
        return out;
    }

    /* ---------- the host switcher's list ---------- */

    /* D-Bus variants come as { t, v }. */
    const unwrap = v => (isObject(v) && own(v, "t") && own(v, "v") ? v.v : v);

    /* As the host switcher builds it (pkg/shell/machines/machines.js, generate_connection_string):
       the same string makes the bridge reuse the switcher's connection. */
    function connectionString(user, port, address) {
        return (user ? user + "@" : "") + address + (port ? ":" + port : "");
    }

    /* The Machines property of the bridge's cockpit.Machines (/etc/cockpit/machines.d/*.json)
       as { hosts, skipped, localLabel }: the visible hosts other than this one, the names that
       are left out because they are not plain host names, and the label of this host. */
    function parseMachines(raw) {
        const result = { hosts: [], skipped: [], localLabel: null };
        if (!isObject(raw)) return result;
        for (const key of Object.keys(raw)) {
            const attrs = isObject(raw[key]) ? raw[key] : {};
            const get = name => (own(attrs, name) ? unwrap(attrs[name]) : undefined);
            const label = cleanText(get("label"), LIMITS.host);
            if (key === "localhost" || key === "localhost.localdomain") {
                result.localLabel = result.localLabel || label;
                continue;
            }
            /* The switcher lists a host only while it is visible (a removed host stays on disk). */
            if (!get("visible")) continue;
            const address = typeof get("address") === "string" && get("address") ? get("address") : key;
            const user = get("user") === undefined || get("user") === null || get("user") === "" ? null : String(get("user"));
            const port = get("port") === undefined || get("port") === null || get("port") === "" ? null : String(get("port"));
            if (!HOST_RE.test(key) || !HOST_RE.test(address) || (user !== null && !USER_RE.test(user)) ||
                (port !== null && !PORT_RE.test(port))) {
                result.skipped.push(cleanText(key, LIMITS.host) || "?");
                continue;
            }
            result.hosts.push({ key, address, user, port, label, connection: connectionString(user, port, address) });
        }
        return result;
    }

    /* ---------- the board ---------- */

    const byName = (a, b) => a.sortLabel.localeCompare(b.sortLabel, "en", { sensitivity: "base" }) || (a.pkg < b.pkg ? -1 : a.pkg > b.pkg ? 1 : 0);

    /* What a host's tile of one add-on is, from the result of its status call. */
    function tileOf(pkg, label, sortLabel, result, now) {
        const tile = { pkg, label, sortLabel, jump: true };
        switch (result.kind) {
        case "ok": {
            const ev = evaluate(result.status, now);
            return Object.assign(tile, { kind: "status", state: ev.state, word: ev.byAge ? "stale" : ev.state, status: result.status, eval: ev });
        }
        case "noaccess":
            return Object.assign(tile, { kind: "noaccess", state: "none", word: "noaccess" });
        case "rejected":
            return Object.assign(tile, { kind: "rejected", state: "warning", word: "rejected" });
        default:
            /* invalid, unsupported, missing, failed, timeout: the add-on said nothing usable. */
            return Object.assign(tile, { kind: "error", state: "warning", word: "unreadable", error: result });
        }
    }

    /* The rows of the board from the hosts as loaded:
         hosts  [{ key, label, own, connection, result }] in the order the board shows them, with
                result one of
                  { reach: "loading" }
                  { reach: "unreachable", problem, message }  (no connection)
                  { reach: "locked", identity }               (the SSH key in the agent is locked)
                  { reach: "ok", discovery: "failed", message }
                  { reach: "ok", discovery: "ok", packages: packagesOf(…), results: { pkg: result } }
       Returns [{ host, state, tiles }]. An add-on with a status entry on one host gets a tile
       on every host it could be read from: "missing" where the package is not installed,
       "nostatus" where it is, in a version without the status entry.
       Names: a tile carries the label its own host sends (else the one of its manifest), so a
       host can name only its own tiles. Tiles are sorted, and "missing" tiles named, by the label
       of the first host that has one, this host first. */
    function buildBoard(hosts, now) {
        const readable = h => h.result.reach === "ok" && h.result.discovery === "ok";
        const nameOn = (r, pkg) => {
            const res = r.results[pkg];
            return (res && res.kind === "ok" && res.status.label) || (r.packages[pkg] && r.packages[pkg].label) || null;
        };
        const labels = {};
        hosts.filter(h => h.own).concat(hosts.filter(h => !h.own)).filter(readable).forEach(h => {
            const r = h.result;
            Object.keys(r.packages).forEach(pkg => {
                const entry = r.packages[pkg].entry;
                if (!entry || entry.unreadable) return;
                labels[pkg] = labels[pkg] || nameOn(r, pkg);
            });
        });
        Object.keys(labels).forEach(pkg => { labels[pkg] = labels[pkg] || pkg; });

        return hosts.map(host => {
            const r = host.result;
            let tiles;
            if (r.reach === "loading") tiles = [{ kind: "loading", state: "none", word: null, jump: false }];
            else if (r.reach === "unreachable") tiles = [{ kind: "unreachable", state: "danger", word: "unreachable", jump: "host", problem: r.problem, message: r.message }];
            else if (r.reach === "locked") tiles = [{ kind: "locked", state: "warning", word: "locked", jump: "host", identity: r.identity }];
            else if (r.discovery !== "ok") tiles = [{ kind: "discovery", state: "warning", word: "discovery", jump: false, message: r.message }];
            else {
                tiles = Object.keys(labels).map(pkg => {
                    const p = r.packages[pkg];
                    const sortLabel = labels[pkg];
                    const label = nameOn(r, pkg) || sortLabel;
                    if (!p) return { pkg, label, sortLabel, kind: "missing", state: "none", word: "missing", jump: false };
                    if (!p.entry) return { pkg, label, sortLabel, kind: "nostatus", state: "none", word: "nostatus", jump: true };
                    if (p.entry.unreadable) return tileOf(pkg, label, sortLabel, { kind: "manifest", message: p.entry.message }, now);
                    if (p.entry.rejected) return tileOf(pkg, label, sortLabel, { kind: "rejected" }, now);
                    return tileOf(pkg, label, sortLabel, r.results[pkg] || { kind: "failed", exit: null, message: null }, now);
                }).sort(byName);
            }
            const state = tiles.reduce((s, t) => worse(s, t.state), "none");
            return { host, state, tiles };
        });
    }

    /* The order of the hosts: this host first, then by label as in the host switcher. */
    function sortHosts(hosts) {
        return hosts.slice().sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0) ||
            a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    }

    /* How a failed connection is shown: { reach: "locked" } when the bridge could not use the SSH
       key because it is locked (pkg/shell/hosts_dialog.jsx reads the same "locked identity"),
       else { reach: "unreachable" } with Cockpit's problem code. */
    function reachOf(close) {
        const o = close || {};
        if (o.problem === "authentication-failed" && typeof o.error === "string" && o.error.startsWith("locked identity")) {
            return { reach: "locked", identity: cleanText(o.error.slice(o.error.indexOf(":") + 1), LIMITS.reason) };
        }
        return {
            reach: "unreachable",
            problem: typeof o.problem === "string" && /^[a-z0-9-]{1,40}$/.test(o.problem) ? o.problem : "disconnected",
            message: cleanText(typeof o.message === "string" ? o.message : "", LIMITS.reason),
        };
    }

    const api = {
        STATES, RANK, LABEL_CLASS, LIMITS, MAX_ITEMS, MAX_PACKAGES, MAX_OUTPUT,
        PACKAGE_RE, ITEM_ID_RE, LINK_RE, COMMAND_RE,
        rank, worse, cleanText, parseTime,
        validateStatus, stateOfItems, evaluate, classifyFailure,
        packageOfManifestPath, statusEntry, menuLabel, statusArgv, packagesOf,
        connectionString, parseMachines, buildBoard, sortHosts, reachOf,
    };
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.StatusBoard = api;
}(typeof self !== "undefined" ? self : this));
