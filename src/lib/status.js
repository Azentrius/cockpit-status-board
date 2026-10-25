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
    const linkOf = v => (typeof v === "string" && LINK_RE.test(v) ? v : null);
    const staleAfterOf = v => (Number.isInteger(v) && v > 0 && v <= MAX_STALE_AFTER ? v : null);

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
            link: linkOf(raw.link),
            checkedAt: parseTime(raw.checked_at),
            staleAfter: staleAfterOf(raw.stale_after),
            findings: null,
        };
    }

    /* ---------- the optional parts of version 1: checks, findings, a host's profile ---------- */

    /* What an add-on declares in `features`; only what it declares is read. */
    const FEATURES = ["checks", "findings", "profile"];
    /* How a check went: what the board knows from it (its coverage). */
    const CHECK_STATES = ["checked", "partial", "failed", "unconfigured", "noaccess", "unsupported", "notapplicable"];
    /* A finding's id: the add-on's rule and the resource it is about ("port.5432-tcp"), never a
       text, a count or a time, so that it stays the same in every language and order. */
    const FID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
    /* An add-on ("security") or one of its checks ("security/exposure") in a profile. */
    const EXPECT_RE = /^[a-z0-9][a-z0-9-]{0,40}(?:\/[a-z0-9-]{1,40})?$/;
    const ROLE_RE = /^[a-z0-9-]{1,40}$/;
    const EXPOSURES = ["internet", "restricted", "internal", "local"];
    const FIXES = ["available", "none", "unknown"];
    const MAX_CHECKS = 50;
    /* findings per answer, over all its items; more go to a verb of their own later */
    const MAX_FINDINGS = 100;
    /* the largest findings.total that is kept */
    const MAX_TOTAL = 1000000;
    const MAX_ROLES = 10;
    const MAX_EXPECT = 100;
    const MAX_SKIP = 50;
    /* An acceptance counts for at most 90 days after the check, as Update Gaps takes them. */
    const MAX_ACCEPT_MS = 90 * 86400 * 1000;

    /* One check of `checks`, or null. item: the id of the item that shows its result, kept only
       when the answer has that item. */
    function validateCheck(raw, itemIds) {
        if (!isObject(raw)) return null;
        if (typeof raw.id !== "string" || !ITEM_ID_RE.test(raw.id)) return null;
        if (typeof raw.state !== "string" || !CHECK_STATES.includes(raw.state)) return null;
        const title = cleanText(raw.title, LIMITS.title);
        if (!title) return null;
        return {
            id: raw.id,
            state: raw.state,
            title,
            item: typeof raw.item === "string" && itemIds.has(raw.item) ? raw.item : null,
            checkedAt: parseTime(raw.checked_at),
            staleAfter: staleAfterOf(raw.stale_after),
            reason: cleanText(raw.reason, LIMITS.detail),
            link: linkOf(raw.link),
        };
    }

    /* One finding of an item, or null. ref: the time of its check (ms), which an acceptance may
       not run more than MAX_ACCEPT_MS beyond; without it no acceptance counts. */
    function validateFinding(raw, ref) {
        if (!isObject(raw)) return null;
        if (typeof raw.fid !== "string" || !FID_RE.test(raw.fid)) return null;
        if (!isState(raw.state)) return null;
        const title = cleanText(raw.title, LIMITS.title);
        if (!title) return null;
        const until = parseTime(raw.accepted_until);
        return {
            fid: raw.fid,
            state: raw.state,
            title,
            since: parseTime(raw.since),
            exposure: EXPOSURES.includes(raw.exposure) ? raw.exposure : null,
            fix: FIXES.includes(raw.fix) ? raw.fix : null,
            exploited: raw.exploited === "known" ? "known" : null,
            acceptedUntil: until !== null && ref !== null && until <= ref + MAX_ACCEPT_MS ? until : null,
            link: linkOf(raw.link),
        };
    }

    /* The profile of a host (only Host Settings sends one): { roles, expect, skip, setAt }, or
       null. Entries that break the rules, come twice or go past the limits are left out and
       counted in drop.n. */
    function validateProfile(raw, drop) {
        if (!isObject(raw)) return null;
        const list = (v, re, max) => {
            const all = Array.isArray(v) ? v : [];
            const kept = Array.from(new Set(all.filter(x => typeof x === "string" && re.test(x)))).slice(0, max);
            drop.n += all.length - kept.length;
            return kept;
        };
        const skip = [];
        const seen = new Set();
        const rawSkip = Array.isArray(raw.skip) ? raw.skip : [];
        rawSkip.forEach(s => {
            if (skip.length >= MAX_SKIP || !isObject(s) || typeof s.check !== "string" || !EXPECT_RE.test(s.check) || seen.has(s.check)) return;
            seen.add(s.check);
            skip.push({ check: s.check, reason: cleanText(s.reason, LIMITS.detail), until: parseTime(s.until) });
        });
        drop.n += rawSkip.length - skip.length;
        return { roles: list(raw.roles, ROLE_RE, MAX_ROLES), expect: list(raw.expect, EXPECT_RE, MAX_EXPECT), skip, setAt: parseTime(raw.set_at) };
    }

    /* The optional parts of a valid answer (contract, "Optional: checks, findings and a host's
       profile"), set on status; `raws` are the answer's items in the order of status.items.
       What breaks the rules is left out and counted (status.extDropped); it never makes the
       answer unreadable. */
    function validateExtension(data, status, raws) {
        const features = Array.isArray(data.features) ? FEATURES.filter(f => data.features.includes(f)) : [];
        const drop = { n: 0 };
        let checks = null;
        if (features.includes("checks")) {
            if (Array.isArray(data.checks)) {
                checks = [];
                const ids = new Set();
                const itemIds = new Set(status.items.map(i => i.id));
                data.checks.forEach(raw => {
                    const c = checks.length < MAX_CHECKS ? validateCheck(raw, itemIds) : null;
                    if (!c || ids.has(c.id)) {
                        drop.n++;
                        return;
                    }
                    ids.add(c.id);
                    checks.push(c);
                });
            } else {
                drop.n++;
            }
        }
        if (features.includes("findings")) {
            /* complete only where the add-on says so, a check of state "checked" shows the item's
               result, every entry of the list was taken over, and a whole-number total counts no
               more findings than were taken over */
            const owner = new Map((checks || []).filter(c => c.item !== null).map(c => [c.item, c]));
            const fids = new Set();
            let listed = 0;
            status.items.forEach((item, i) => {
                const raw = raws[i].findings;
                if (raw === undefined) return;
                if (!isObject(raw) || typeof raw.complete !== "boolean" || !Array.isArray(raw.list)) {
                    drop.n++;
                    return;
                }
                const ref = item.checkedAt !== null ? item.checkedAt : status.checkedAt;
                const list = [];
                let complete = raw.complete;
                raw.list.forEach(r => {
                    const f = listed < MAX_FINDINGS ? validateFinding(r, ref) : null;
                    if (!f || fids.has(f.fid)) {
                        drop.n++;
                        complete = false;
                        return;
                    }
                    fids.add(f.fid);
                    list.push(f);
                    listed++;
                });
                const check = owner.get(item.id);
                if (!check || check.state !== "checked") complete = false;
                /* the answer itself counts findings that are not in the list ("complete": true,
                   "total": 1, "list": []); so does a total past MAX_TOTAL, which is not kept */
                if (Number.isInteger(raw.total) && raw.total > list.length) complete = false;
                const total = Number.isInteger(raw.total) && raw.total >= list.length && raw.total <= MAX_TOTAL ? raw.total : list.length;
                item.findings = { complete, total, list };
            });
        }
        let profile = null;
        if (features.includes("profile") && data.addon === "host-settings") {
            profile = validateProfile(data.profile, drop);
            if (!profile) drop.n++;
        }
        return Object.assign(status, { features, checks, profile, extDropped: drop.n });
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
        const raws = [];
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
            raws.push(raw);
        }
        return {
            ok: true,
            status: validateExtension(data, {
                addon: data.addon,
                label: cleanText(data.label, LIMITS.label),
                version: cleanText(data.version, LIMITS.version),
                checkedAt: parseTime(data.checked_at),
                state: data.state,
                summary: cleanText(data.summary, LIMITS.summary),
                items,
                dropped,
            }, raws),
        };
    }

    /* The state of an add-on from its items (contract, "States"): the most severe of danger,
       warning and info; else ok when one item is ok; else none. */
    function stateOfItems(items) {
        return items.reduce((s, it) => worse(s, it.state), "none");
    }

    /* An item's state at the time now (ms), never better than its open findings: those not
       accepted, and those whose acceptance has ended (contract, "Findings"). */
    function itemState(item, now) {
        if (!item.findings) return item.state;
        return item.findings.list.reduce((s, f) => (f.acceptedUntil === null || f.acceptedUntil <= now ? worse(s, f.state) : s), item.state);
    }

    /* What a tile of a valid status shows at the time now (ms):
         state       the add-on's state, never better than its items say, at least warning when
                     data is out of date (an item past checked_at + stale_after)
         staleSince  when the first item went out of date, or null
         byAge       true when only the age made it a warning
         key         the most important item: the most severe one (out of date counts as
                     warning), one with a value before one without, else the first
         items       every item in the add-on's order, each with its state at that time (out of
                     date: at least warning), staleAt (or null) and the word of its label
         checkedAt   the time of the data: the status's own, else the newest item's
       An item with findings is never better than its open ones (itemState). */
    function evaluate(status, now) {
        let staleSince = null;
        const ranked = status.items.map((item, index) => {
            const own = itemState(item, now);
            let state = own;
            let staleAt = null;
            if (item.checkedAt !== null && item.staleAfter !== null) {
                const at = item.checkedAt + item.staleAfter * 1000;
                if (now > at) {
                    staleAt = at;
                    staleSince = staleSince === null ? at : Math.min(staleSince, at);
                    state = worse(state, "warning");
                }
            }
            return { item, index, own, state, staleAt, word: staleAt !== null && rank(own) < RANK.warning ? "stale" : state };
        });
        const reported = ranked.reduce((s, r) => worse(s, r.own), status.state);
        const state = staleSince === null ? reported : worse(reported, "warning");
        const top = ranked.slice().sort((a, b) =>
            rank(b.state) - rank(a.state) || (b.item.value ? 1 : 0) - (a.item.value ? 1 : 0) || a.index - b.index)[0];
        const times = status.items.map(it => it.checkedAt).filter(t => t !== null);
        return {
            state,
            staleSince,
            byAge: staleSince !== null && rank(reported) < RANK.warning,
            key: top ? Object.assign({}, top.item, { state: top.state, staleAt: top.staleAt }) : null,
            items: ranked.map(r => Object.assign({}, r.item, { state: r.state, staleAt: r.staleAt, word: r.word })),
            checkedAt: status.checkedAt !== null ? status.checkedAt : (times.length ? Math.max.apply(null, times) : null),
        };
    }

    /* The output of a status call as it arrives in chunks, never more than max characters (the
       same count validateStatus() checks). add() returns false once the output went past max: the
       caller then closes the channel, and what was kept is dropped, so the buffer stays bounded. */
    function outputCollector(max) {
        let parts = [];
        let size = 0;
        let over = false;
        return {
            add(data) {
                if (over) return false;
                const s = typeof data === "string" ? data : String(data);
                size += s.length;
                if (size > max) {
                    over = true;
                    parts = [];
                    return false;
                }
                parts.push(s);
                return true;
            },
            get tooLarge() { return over; },
            get size() { return size; },
            text() { return parts.join(""); },
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

    /* A version as add-ons send it: "0.20.0", "2.8.1", "0.1.0~dev.a5215aa". */
    const VERSION_RE = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(.*)$/;

    /* -1, 0 or 1 as version a comes before, equals or follows b; null when one of them is no such
       version. A suffix ("~dev…", "-rc1") comes before the same version without one. */
    function compareVersions(a, b) {
        const x = typeof a === "string" ? VERSION_RE.exec(a) : null;
        const y = typeof b === "string" ? VERSION_RE.exec(b) : null;
        if (!x || !y) return null;
        for (let i = 1; i <= 3; i++) {
            const d = Number(x[i]) - Number(y[i]);
            if (d) return d < 0 ? -1 : 1;
        }
        if (x[4] === y[4]) return 0;
        if (!x[4] || !y[4]) return x[4] ? -1 : 1;
        return x[4] < y[4] ? -1 : 1;
    }

    /* Whether a tile needs attention: a notice, a warning or a problem (out of date included), or
       a host still loading. OK, Unknown, Not installed and No status do not. No access and an
       answer that rates nothing are warnings (gaps in what the board knows), so they do, unless
       the host's profile does not expect the add-on; so does an expected add-on that is missing. */
    const notable = tile => tile.kind === "loading" || rank(tile.state) >= RANK.info;

    /* ---------- a host's target profile ---------- */

    /* The add-on that sends a host's profile; validateExtension() reads it from no other. */
    const PROFILE_ADDON = "host-settings";

    /* What a host is expected to have, from its profile at the time now (ms), or null without one:
         roles   the profile's roles, as it sends them
         addons  the expected add-ons: every add-on of `expect`, and the add-on of every check in it
         checks  the checks `expect` names ("security/exposure")
         skips   the checks left out on purpose whose `until` has not passed (none: for good), by
                 "addon/check"; an entry that names an add-on alone leaves out nothing */
    function expectationOf(profile, now) {
        if (!profile) return null;
        const addons = new Set();
        const checks = new Set();
        profile.expect.forEach(e => {
            const at = e.indexOf("/");
            addons.add(at < 0 ? e : e.slice(0, at));
            if (at >= 0) checks.add(e);
        });
        const skips = new Map();
        profile.skip.forEach(s => {
            if (s.check.indexOf("/") >= 0 && (s.until === null || s.until > now)) skips.set(s.check, s);
        });
        return { roles: profile.roles, addons, checks, skips };
    }

    /* How a gap of the coverage counts (the table "Coverage" in docs/INTERNALS.md): for an add-on
       the host is expected to have always a warning; for one it is not expected to have a notice
       where something ran and is incomplete (partial, stale, failed), a warning where nothing can
       be read (unreadable), else nothing (unconfigured, noaccess, unsupported, unchecked). null for
       no gap (checked, or no coverage at all). */
    const OPTIONAL_GAP = { partial: "info", stale: "info", failed: "info", unreadable: "warning" };
    function gapRating(coverage, expected) {
        if (!coverage || coverage === "checked" || coverage === "notapplicable") return null;
        if (expected) return "warning";
        return own(OPTIONAL_GAP, coverage) ? OPTIONAL_GAP[coverage] : null;
    }

    /* The gaps a check can show, worst first (contract, "Checks and coverage"); a check that is
       "checked" and in time shows none, one that is "notapplicable" does not count. */
    const CHECK_GAPS = ["noaccess", "unconfigured", "failed", "unsupported", "stale", "partial"];
    const checkRank = coverage => (coverage === "checked" ? 0 : CHECK_GAPS.length - CHECK_GAPS.indexOf(coverage));

    /* What one check says at the time now: its state as coverage, "stale" for a checked or partial
       check past checked_at + stale_after (staleAt: since when), else null for staleAt. */
    function checkCoverage(check, now) {
        const at = check.checkedAt !== null && check.staleAfter !== null ? check.checkedAt + check.staleAfter * 1000 : null;
        const stale = at !== null && now > at && (check.state === "checked" || check.state === "partial");
        return { coverage: stale ? "stale" : check.state, staleAt: stale ? at : null };
    }

    /* The coverage of a valid answer from its checks at the time now: the worst of the checks that
       apply (all but "notapplicable"), the check that shows it (worst, the first of the worst in the
       add-on's order, or null) and every check with a gap (gaps, in the add-on's order, each with
       its coverage and staleAt). null when the answer has no checks, or none that applies: then
       its items decide, as for answers without checks. */
    function checksCoverage(status, now) {
        if (!Array.isArray(status.checks)) return null;
        const judged = status.checks.filter(c => c.state !== "notapplicable").map(c => Object.assign({}, c, checkCoverage(c, now)));
        if (!judged.length) return null;
        const gaps = judged.filter(c => c.coverage !== "checked");
        const worst = gaps.reduce((w, c) => (w === null || checkRank(c.coverage) > checkRank(w.coverage) ? c : w), null);
        return { coverage: worst ? worst.coverage : "checked", worst, gaps };
    }

    /* What the board knows about an add-on on a host (its coverage), from its tile at the time now:
         checked       a valid answer that rates something, in time (with checks: every check that
                       applies is checked and in time)
         unchecked     a valid answer that rates nothing (every item none, or none at all)
         stale         a valid answer out of date (with checks: a checked or partial check past its
                       checked_at + stale_after)
         noaccess      nothing readable without administrative access (exit 77, or a check in
                       state noaccess)
         unreadable    no usable answer (Status unreadable, Command refused)
         partial, failed, unconfigured
                       only from checks: the state of the worst check
         unsupported   from checks, or an expected add-on installed in a version without the
                       status entry (No status)
         missing       an expected add-on that is not installed
       An answer with checks takes the worst of its checks that apply (checksCoverage()); an answer
       without them is judged by its tile as before. tile.expected says whether the host is
       expected to have the add-on (buildBoard()).
       null for a tile that is no installed add-on with a status entry and not expected either (Not
       installed, No status) and for a host that cannot be read: no check of an add-on is missing
       there.
       A single item in state none is no gap: add-ons use none for "nothing to rate" as well (Cron
       Jobs' jobs without recording, Image Update Monitor's rollout), so contract version 1 cannot
       tell it from "could not check"; only a check in state partial says that. */
    function coverageOf(tile, now) {
        switch (tile.kind) {
        case "status": {
            const fromChecks = checksCoverage(tile.status, now);
            if (fromChecks) return fromChecks.coverage;
            return tile.word === "unchecked" ? "unchecked" : tile.eval.staleSince !== null ? "stale" : "checked";
        }
        case "noaccess": return "noaccess";
        case "error":
        case "rejected": return "unreadable";
        case "missing": return tile.expected ? "missing" : null;
        case "nostatus": return tile.expected ? "unsupported" : null;
        default: return null;
        }
    }

    /* The coverage of the whole board: how many add-ons the hosts that could be read are expected
       to have (total; without a profile every installed add-on with a status entry), how many of
       them answered in time with something rated (checked), the others by coverage (gaps: the four
       kinds of answers without checks always, missing, partial, failed, unconfigured and
       unsupported once one of them occurs), and how many hosts could not be read at all (unread:
       unreachable, locked key, find failed; hosts still loading do not count). An add-on a host
       is not expected to have does not count here. */
    function coverageSummary(rows) {
        const out = { total: 0, checked: 0, gaps: { unchecked: 0, stale: 0, noaccess: 0, unreadable: 0 }, unread: 0, unreadState: "none" };
        rows.forEach(row => row.tiles.forEach(t => {
            if (t.kind === "unreachable" || t.kind === "locked" || t.kind === "discovery") {
                out.unread++;
                out.unreadState = worse(out.unreadState, t.state);
            } else if (t.coverage && t.expected) {
                out.total++;
                if (t.coverage === "checked") out.checked++;
                else out.gaps[t.coverage] = (out.gaps[t.coverage] || 0) + 1;
            }
        }));
        return out;
    }

    const byName = (a, b) => a.sortLabel.localeCompare(b.sortLabel, "en", { sensitivity: "base" }) || (a.pkg < b.pkg ? -1 : a.pkg > b.pkg ? 1 : 0);

    /* What a host's tile of one add-on is, from the result of its status call. */
    function tileOf(pkg, label, sortLabel, result, now) {
        const tile = { pkg, label, sortLabel, jump: true };
        switch (result.kind) {
        case "ok": {
            const ev = evaluate(result.status, now);
            /* An answer that rates nothing has checked nothing yet: a gap, not Unknown. */
            if (ev.state === "none") return Object.assign(tile, { kind: "status", state: "warning", word: "unchecked", status: result.status, eval: ev });
            return Object.assign(tile, { kind: "status", state: ev.state, word: ev.byAge ? "stale" : ev.state, status: result.status, eval: ev });
        }
        case "noaccess":
            /* Nothing is readable without root: usually the add-on has not checked yet. */
            return Object.assign(tile, { kind: "noaccess", state: "warning", word: "noaccess" });
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
       Returns [{ host, state, tiles, coverage, profile, noProfile }]: every tile carries its
       coverage (coverageOf()), whether the host is expected to have the add-on (expected), how a
       gap counts (gap: gapRating(), or null), and for an answer with checks the check that shows a
       gap (gapCheck, or null) and every check with a gap (gapChecks, else []); the row's coverage
       is { total, checked, gaps: [{ pkg, label, coverage, check? }] } over the expected add-ons,
       or null.
       An add-on with a status entry on one host gets a tile on every host it could be read
       from: "missing" where the package is not installed, "nostatus" where it is, in a version
       without the status entry.
       Profile: a host's own Host Settings may send its target profile (profile, else null); it
       decides for that host's row only. With it the expected add-ons are those of
       expectationOf(); a check it leaves out (skips) is "notapplicable" in that row, with the
       profile's reason (byProfile, until; tile.status is then a copy with those checks); an
       expected add-on no host reports gets a "missing" tile in that row only, named by its
       package. Without a profile every installed add-on with a status entry is expected and none
       other; noProfile is true for a host that could be read while the board has tiles.
       Expected and missing, or installed in a version without the status entry, the tile is a
       warning; not expected, No access and an answer that rates nothing are not rated (none).
       Names: a tile carries the label its own host sends (else the one of its manifest), so a
       host can name only its own tiles. Tiles are sorted, and "missing" tiles named, by the label
       of the first host that has one, this host first.
       Versions: a status tile whose add-on is older than the newest version of the same add-on
       on another host carries that version as `newer`. */
    function buildBoard(hosts, now) {
        const readable = h => h.result.reach === "ok" && h.result.discovery === "ok";
        /* Package names are keys from the hosts: "constructor" or "tostring" are valid ones, so a
           lookup takes only what the host itself has (own properties), never what objects inherit. */
        const pkgOf = (r, pkg) => (isObject(r.packages) && own(r.packages, pkg) ? r.packages[pkg] : null);
        const resultOf = (r, pkg) => (isObject(r.results) && own(r.results, pkg) ? r.results[pkg] : null);
        const nameOn = (r, pkg) => {
            const res = resultOf(r, pkg);
            const p = pkgOf(r, pkg);
            return (res && res.kind === "ok" && res.status.label) || (p && p.label) || null;
        };
        const labels = new Map();
        hosts.filter(h => h.own).concat(hosts.filter(h => !h.own)).filter(readable).forEach(h => {
            const r = h.result;
            Object.keys(r.packages).forEach(pkg => {
                const entry = r.packages[pkg].entry;
                if (!entry || entry.unreadable) return;
                if (!labels.get(pkg)) labels.set(pkg, nameOn(r, pkg));
            });
        });
        labels.forEach((label, pkg) => { if (!label) labels.set(pkg, pkg); });
        /* The profile of a host that could be read: only what its own Host Settings sends. */
        const profileOn = r => {
            const res = resultOf(r, PROFILE_ADDON);
            return res && res.kind === "ok" && res.status.addon === PROFILE_ADDON && res.status.profile ? res.status.profile : null;
        };

        const rows = hosts.map(host => {
            const r = host.result;
            let tiles;
            let profile = null;
            let expect = null;
            if (r.reach === "loading") tiles = [{ kind: "loading", state: "none", word: null, jump: false }];
            else if (r.reach === "unreachable") tiles = [{ kind: "unreachable", state: "danger", word: "unreachable", jump: "host", problem: r.problem, message: r.message }];
            else if (r.reach === "locked") tiles = [{ kind: "locked", state: "warning", word: "locked", jump: "host", identity: r.identity }];
            else if (r.discovery !== "ok") tiles = [{ kind: "discovery", state: "warning", word: "discovery", jump: false, message: r.message }];
            else {
                profile = profileOn(r);
                expect = expectationOf(profile, now);
                const pkgs = Array.from(labels.keys());
                /* an add-on the profile expects that no host reports: a tile in this row only (one
                   installed here without a status entry has nothing to judge) */
                if (expect) expect.addons.forEach(pkg => { if (!labels.has(pkg) && !pkgOf(r, pkg)) pkgs.push(pkg); });
                tiles = pkgs.map(pkg => {
                    const p = pkgOf(r, pkg);
                    const sortLabel = labels.get(pkg) || pkg;
                    const label = nameOn(r, pkg) || sortLabel;
                    if (!p) return { pkg, label, sortLabel, kind: "missing", state: "none", word: "missing", jump: false };
                    if (!p.entry) return { pkg, label, sortLabel, kind: "nostatus", state: "none", word: "nostatus", jump: true };
                    if (p.entry.unreadable) return tileOf(pkg, label, sortLabel, { kind: "manifest", message: p.entry.message }, now);
                    if (p.entry.rejected) return tileOf(pkg, label, sortLabel, { kind: "rejected" }, now);
                    return tileOf(pkg, label, sortLabel, resultOf(r, pkg) || { kind: "failed", exit: null, message: null }, now);
                }).sort(byName);
            }
            tiles.forEach(t => {
                t.expected = !t.pkg ? false : expect ? expect.addons.has(t.pkg) : t.kind !== "missing" && t.kind !== "nostatus";
                if (t.expected && t.kind === "missing") Object.assign(t, { state: "warning", word: "absent" });
                else if (t.expected && t.kind === "nostatus") t.state = "warning";
                else if (!t.expected && (t.kind === "noaccess" || t.word === "unchecked")) t.state = "none";
                if (expect && t.kind === "status" && Array.isArray(t.status.checks) &&
                    t.status.checks.some(c => c.state !== "notapplicable" && expect.skips.has(t.pkg + "/" + c.id))) {
                    t.status = Object.assign({}, t.status, { checks: t.status.checks.map(c => {
                        const s = c.state !== "notapplicable" ? expect.skips.get(t.pkg + "/" + c.id) : null;
                        return s ? Object.assign({}, c, { state: "notapplicable", reason: s.reason, byProfile: true, until: s.until }) : c;
                    }) });
                }
                const fromChecks = t.kind === "status" ? checksCoverage(t.status, now) : null;
                t.coverage = coverageOf(t, now);
                t.gapCheck = fromChecks ? fromChecks.worst : null;
                t.gapChecks = fromChecks ? fromChecks.gaps : [];
                /* with checks, the gap counts as its worst check would (a notice of a partial check
                   is not hidden by an unrated one) */
                const rated = !t.coverage || t.coverage === "checked" ? "none" : t.expected ? "warning"
                    : fromChecks ? fromChecks.gaps.reduce((s, c) => worse(s, gapRating(c.coverage, false) || "none"), "none")
                    : gapRating(t.coverage, false) || "none";
                t.gap = rated === "none" ? null : rated;
            });
            const state = tiles.reduce((s, t) => worse(s, t.state), "none");
            const covered = tiles.filter(t => t.coverage && t.expected);
            /* null where no expected add-on could be read (the host's tile says why); a gap that
               comes from a check names it (check: its title) */
            const coverage = covered.length ? {
                total: covered.length,
                checked: covered.filter(t => t.coverage === "checked").length,
                gaps: covered.filter(t => t.coverage !== "checked").map(t =>
                    Object.assign({ pkg: t.pkg, label: t.label, coverage: t.coverage }, t.gapCheck ? { check: t.gapCheck.title } : {})),
            } : null;
            const noProfile = r.reach === "ok" && r.discovery === "ok" && !profile && tiles.length > 0;
            return { host, state, tiles, coverage, profile, noProfile };
        });

        const versioned = [].concat(...rows.map(row => row.tiles))
            .filter(t => t.kind === "status" && compareVersions(t.status.version, t.status.version) === 0);
        const newest = {};
        versioned.forEach(t => {
            if (!own(newest, t.pkg) || compareVersions(t.status.version, newest[t.pkg]) > 0) newest[t.pkg] = t.status.version;
        });
        versioned.forEach(t => {
            if (compareVersions(t.status.version, newest[t.pkg]) < 0) t.newer = newest[t.pkg];
        });
        return rows;
    }

    /* ---------- what needs attention: the tasks over all hosts ---------- */

    /* A finding is new for a day after the add-on first saw it. */
    const NEW_MS = 86400 * 1000;
    const EXPOSURE_ORDER = { internet: 0, restricted: 1, internal: 2, local: 3 };
    const UNREAD_KINDS = ["unreachable", "locked", "discovery"];
    const exposureOrder = e => (typeof e === "string" && own(EXPOSURE_ORDER, e) ? EXPOSURE_ORDER[e] : 4);
    const byText = (a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
    /* older first; without a time after those with one */
    const bySince = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);

    /* The order of the tasks (no score): state (Problem, Warning, Notice); then a host that cannot
       be read, which hides everything else on it; exposure (internet, restricted, internal, local,
       unknown); known to be exploited; older first; then host (in the board's order), add-on (in
       the board's order of tiles) and title. */
    function compareTasks(a, b) {
        return rank(b.state) - rank(a.state) ||
            (b.kind === "host" ? 1 : 0) - (a.kind === "host" ? 1 : 0) ||
            exposureOrder(a.exposure) - exposureOrder(b.exposure) ||
            (b.exploited === "known" ? 1 : 0) - (a.exploited === "known" ? 1 : 0) ||
            bySince(a.since, b.since) ||
            a.hostIndex - b.hostIndex ||
            byText(a.sortLabel, b.sortLabel) ||
            byText(a.title, b.title) ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    }

    /* What needs attention on all hosts, from the rows of buildBoard() at the time now:
         tasks          in the order of compareTasks(), each one of
           kind "finding"   an open finding of item.findings (not accepted, or its acceptance has
                            ended) in state info or worse
           kind "item"      an item in state info or worse that is shown by no finding (an add-on
                            without findings, or none of its findings is open or accepted);
                            summaryOnly when the add-on sends no optional part at all
           kind "coverage"  a gap in the coverage of an add-on of a host that could be read
                            (coverageOf(): from its checks or from its tile), as tile.gap rates
                            it: a warning for an expected add-on, missing ones included, a notice
                            or a warning for one the host's profile does not expect, nothing for
                            an unrated gap; expected (tile.expected) and roles (the profile's, or
                            null without one) say why
           kind "profile"   a host that could be read sends no target profile (row.noProfile),
                            a notice; tile is its Host Settings where installed, else one that
                            opens nothing
           kind "host"      a host that cannot be read (Unreachable, Key locked, Add-ons
                            unreadable), in the state of its tile
         accepted       the findings in state info or worse whose acceptance runs, soonest end first
         notApplicable  the checks in state notapplicable, with their reason (check.byProfile and
                        check.until for one the host's profile leaves out)
       Every task carries host, tile (for the jump), key (unique on the board), state, title (a
       text of the host, or "" where the page names it), since (or null), isNew (since less than a
       day ago), exposure, exploited and fix (findings only, else null), link (the place in the
       add-on: the finding's, else its item's; the item's; the gap check's, else the link of its
       item; null: the tile's own) and evidence ({ at, complete }: the time of the owning check,
       else the item's, else the answer's; complete true or false when a check owns the item, null
       without one). An item's state is its own: out of date is a gap of the coverage, not a task
       per item. Nothing here is a text of the page; nothing of a host is used as a key of an
       object. */
    function buildTasks(rows, now) {
        const tasks = [];
        const accepted = [];
        const notApplicable = [];
        /* the tasks of one tile of a row */
        function tileTasks(row, hostIndex, tile) {
            const host = row.host;
            const base = { host, tile, hostIndex, sortLabel: tile.sortLabel || "", pkg: tile.pkg || null, since: null, isNew: false,
                           exposure: null, exploited: null, fix: null, link: null, evidence: null };
            const add = extra => tasks.push(Object.assign({}, base, extra));
            if (UNREAD_KINDS.includes(tile.kind)) {
                add({ kind: "host", key: host.key + "/" + tile.kind, state: tile.state, title: "" });
                return;
            }
            if (!tile.coverage) return;
            const st = tile.kind === "status" ? tile.status : null;
            const items = st ? st.items : [];
            const linkOfItem = id => {
                const item = items.find(i => i.id === id);
                return item ? item.link : null;
            };
            if (tile.gap) {
                const check = tile.gapCheck;
                add({ kind: "coverage", key: host.key + "/" + tile.pkg + "/coverage", state: tile.gap, title: check ? check.title : "",
                      coverage: tile.coverage, check, checks: tile.gapChecks, expected: tile.expected, roles: row.profile ? row.profile.roles : null,
                      link: check ? check.link || (check.item !== null ? linkOfItem(check.item) : null) || "" : null,
                      evidence: st ? { at: check && check.checkedAt !== null ? check.checkedAt : tile.eval.checkedAt, complete: null } : null });
            }
            if (!st) return;
            const checks = st.checks || [];
            checks.filter(c => c.state === "notapplicable").forEach(c => notApplicable.push({ host, tile, hostIndex, check: c }));
            const owner = new Map(checks.filter(c => c.item !== null).map(c => [c.item, c]));
            const summaryOnly = st.features.length === 0;
            items.forEach(item => {
                const check = owner.has(item.id) ? owner.get(item.id) : null;
                const at = check && check.checkedAt !== null ? check.checkedAt : item.checkedAt !== null ? item.checkedAt : st.checkedAt;
                let shown = false;
                if (item.findings) {
                    item.findings.list.forEach(f => {
                        if (rank(f.state) < RANK.info) return;
                        shown = true;
                        if (f.acceptedUntil !== null && f.acceptedUntil > now) {
                            accepted.push({ host, tile, hostIndex, item, finding: f, until: f.acceptedUntil, key: host.key + "/" + tile.pkg + "/finding:" + f.fid });
                            return;
                        }
                        add({ kind: "finding", key: host.key + "/" + tile.pkg + "/finding:" + f.fid, state: f.state, title: f.title, item, finding: f,
                              since: f.since, isNew: f.since !== null && now - f.since < NEW_MS,
                              exposure: f.exposure, exploited: f.exploited, fix: f.fix, link: f.link || item.link || "",
                              evidence: at !== null ? { at, complete: item.findings.complete } : null });
                    });
                }
                if (shown || rank(item.state) < RANK.info) return;
                add({ kind: "item", key: host.key + "/" + tile.pkg + "/item:" + item.id, state: item.state, title: item.title, item, summaryOnly,
                      link: item.link || "",
                      evidence: at !== null ? { at, complete: check ? checkCoverage(check, now).coverage === "checked" : null } : null });
            });
        }
        rows.forEach((row, hostIndex) => {
            if (row.noProfile) {
                /* first among the host's tasks of its state: no add-on, no title of a host */
                const hs = row.tiles.find(t => t.pkg === PROFILE_ADDON && t.kind !== "missing") || null;
                tasks.push({ kind: "profile", key: row.host.key + "/profile", state: "info", title: "", host: row.host,
                             tile: hs || { kind: "profile", pkg: null, label: null, sortLabel: "", jump: false }, hostIndex, sortLabel: "",
                             pkg: hs ? hs.pkg : null, since: null, isNew: false, exposure: null, exploited: null, fix: null,
                             link: hs ? "" : null, evidence: null });
            }
            row.tiles.forEach(tile => tileTasks(row, hostIndex, tile));
        });
        tasks.sort(compareTasks);
        accepted.sort((a, b) => a.until - b.until || a.hostIndex - b.hostIndex || byText(a.tile.sortLabel, b.tile.sortLabel) ||
            byText(a.finding.title, b.finding.title));
        notApplicable.sort((a, b) => a.hostIndex - b.hostIndex || byText(a.tile.sortLabel, b.tile.sortLabel) || byText(a.check.title, b.check.title));
        return { tasks, accepted, notApplicable };
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
        FEATURES, CHECK_STATES, FID_RE, EXPECT_RE, MAX_CHECKS, MAX_FINDINGS, MAX_TOTAL, MAX_ACCEPT_MS,
        rank, worse, cleanText, parseTime,
        validateStatus, stateOfItems, itemState, evaluate, classifyFailure, outputCollector,
        packageOfManifestPath, statusEntry, menuLabel, statusArgv, packagesOf,
        connectionString, parseMachines, buildBoard, sortHosts, reachOf, compareVersions, notable,
        coverageOf, coverageSummary, checksCoverage, buildTasks, expectationOf, gapRating,
    };
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.StatusBoard = api;
}(typeof self !== "undefined" ? self : this));
