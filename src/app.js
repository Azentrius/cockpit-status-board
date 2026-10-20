/* Status Board: Cockpit page.
 *
 * One row per host of Cockpit's host switcher, this host first; in each row one tile per
 * Azentrius add-on that has a status entry in its manifest. For every host the page
 *   1. connects: an echo channel with the host's connection string, as the host switcher opens
 *      it (other hosts only; a locked SSH key shows up here),
 *   2. finds the manifests: on this host cockpit.manifests (../manifests.js), on other hosts
 *      `find /usr/share/cockpit …` and cockpit.file() for each manifest.json,
 *   3. runs each add-on's status verb, `COMMAND status --lang xx`, with superuser "try",
 * and checks every answer with lib/status.js. What a host sends is data: its texts reach the page
 * through textContent only, and the page jumps only to checked package folders and links. The
 * board never asks for administrative access and changes nothing on any host.
 *
 * It loads on opening, on Refresh and, while the page is visible, every 5 minutes. It asks again
 * instead of watching files: cockpit.file().watch() ignores the host option and would watch the
 * file on this host.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
(function () {
    "use strict";

    const VERSION = "0.1.0";
    const SB = window.StatusBoard;
    const ICONS = window.AzIcons;
    const REFRESH_MS = 5 * 60 * 1000;
    const TICK_MS = 30 * 1000;
    const TIMEOUT_MS = { connect: 20000, find: 15000, read: 15000, status: 20000 };
    const FIND_ARGV = ["find", "/usr/share/cockpit", "-mindepth", "2", "-maxdepth", "2", "-name", "manifest.json"];
    const STATE_ICON = { none: "ban", ok: "check-circle", info: "info-circle", warning: "exclamation-triangle", danger: "exclamation-circle" };
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

    /* ---------- language ---------- */

    /* Like Cockpit: the choice in Cockpit's menu (cookie CockpitLang or cockpit.lang), else the
       language Cockpit serves through ../base1/po.js. Languages without a file in i18n/ fall back
       to English. */
    function cockpitLanguage() {
        let lang = null;
        try {
            const m = /(?:^|;\s*)CockpitLang=([^;]*)/.exec(document.cookie);
            if (m) lang = decodeURIComponent(m[1]);
        } catch (_) { /* no cookie */ }
        if (!lang) {
            try { lang = window.localStorage.getItem("cockpit.lang"); } catch (_) { /* no storage */ }
        }
        return lang || cockpit.language || "en";
    }
    const I18N = window.StatusBoardI18n || {};
    const WANTED = String(cockpitLanguage()).toLowerCase().split(/[-_.]/)[0];
    const LANG = own(I18N, WANTED) ? WANTED : "en";
    const T = I18N[LANG].ui;
    const LOCALE = I18N[LANG].locale;
    document.documentElement.lang = LANG;

    /* ---------- DOM ---------- */

    const $ = id => document.getElementById(id);

    function append(el, kid) {
        if (kid === null || kid === undefined || kid === false) return;
        if (Array.isArray(kid)) { kid.forEach(k => append(el, k)); return; }
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    /* An element; texts always become text nodes. */
    function h(tag, attrs) {
        const el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(k => {
            const v = attrs[k];
            if (v === null || v === undefined || v === false) return;
            if (k === "class") el.className = v;
            else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? "" : String(v));
        });
        for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
        return el;
    }
    function fill(el) {
        el.replaceChildren();
        for (let i = 1; i < arguments.length; i++) append(el, arguments[i]);
        return el;
    }
    /* One of the page's own texts: `…` marks code. Never used for what a host sends. */
    function rich(value) {
        return String(value).split("`").map((part, i) => (i % 2 ? h("code", null, part) : part)).filter(x => x !== "");
    }
    function icon(name) {
        const def = ICONS[name];
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("class", "az-icon");
        svg.setAttribute("viewBox", def.viewBox);
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", def.d);
        svg.append(path);
        return svg;
    }
    /* A label of the status language: colour, icon and word say the same. */
    function label(state, word, strong) {
        const cls = SB.LABEL_CLASS[state] + (strong ? " az-label--strong" : "");
        return h("span", { class: cls }, icon(STATE_ICON[state]), word);
    }

    /* ---------- time ---------- */

    const fmtClock = ms => new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
    const fmtFull = ms => new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(ms);
    /* "14:20" today, else with the day */
    function fmtWhen(ms) {
        const d = new Date(ms);
        const n = new Date();
        if (d.toDateString() === n.toDateString()) return fmtClock(ms);
        return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
                                                 year: d.getFullYear() !== n.getFullYear() ? "numeric" : undefined }).format(ms);
    }
    /* "5 minutes ago", "3 hours ago", "2 days ago" */
    function fmtAgo(ms) {
        const diff = Date.now() - ms;
        if (Math.abs(diff) < 60000) return T.justNow;
        const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "always" });
        const minutes = Math.round(diff / 60000);
        if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
        const hours = Math.round(diff / 3600000);
        if (Math.abs(hours) < 48) return rtf.format(-hours, "hour");
        return rtf.format(-Math.round(diff / 86400000), "day");
    }

    /* ---------- Cockpit ---------- */

    /* Channel options for a host: none for this host, else its connection string. */
    const at = (host, options) => (host ? Object.assign({ host }, options) : options);

    /* The promise, or a rejection { problem: "timeout" } after ms; then cancel() closes the channel. */
    function withTimeout(promise, ms, cancel) {
        let timer = null;
        const timeout = new Promise((resolve, reject) => {
            timer = window.setTimeout(() => {
                try { cancel(); } catch (_) { /* closed already */ }
                reject({ problem: "timeout", message: "" });
            }, ms);
        });
        return Promise.race([Promise.resolve(promise), timeout]).finally(() => window.clearTimeout(timer));
    }

    /* The hosts of the host switcher: the Machines property of the bridge's cockpit.Machines, which
       the switcher reads too (pkg/shell/machines/machines.js); the bridge merges it from
       /etc/cockpit/machines.d/*.json. */
    function readMachines() {
        const client = cockpit.dbus(null, { bus: "internal" });
        const proxy = client.proxy("cockpit.Machines", "/machines");
        return withTimeout(proxy.wait(), TIMEOUT_MS.read, () => client.close())
            .then(() => SB.parseMachines(proxy.Machines))
            .finally(() => client.close());
    }

    /* null once the host answers an echo, else what reachOf() makes of the closed channel. */
    function connect(host) {
        return new Promise(resolve => {
            let done = false;
            let timer = null;
            const channel = cockpit.channel({ payload: "echo", host });
            const finish = result => {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                resolve(result);
            };
            channel.addEventListener("message", () => { finish(null); channel.close(); });
            channel.addEventListener("close", (ev, options) => finish(SB.reachOf(options)));
            timer = window.setTimeout(() => { finish(SB.reachOf({ problem: "timeout" })); channel.close(); }, TIMEOUT_MS.connect);
            channel.send("x");
        });
    }

    function readFile(host, path, options) {
        const file = cockpit.file(path, at(host, options));
        return withTimeout(file.read(), TIMEOUT_MS.read, () => file.close()).finally(() => file.close());
    }

    function readHostname(host) {
        return readFile(host, "/proc/sys/kernel/hostname", {}).then(text => SB.cleanText(text, SB.LIMITS.host), () => null);
    }

    /* The packages of another host: the manifests below /usr/share/cockpit, each read as JSON. */
    function discover(host) {
        const proc = cockpit.spawn(FIND_ARGV, at(host, { err: "message" }));
        return withTimeout(proc, TIMEOUT_MS.find, () => proc.close("timeout")).then(output => {
            const names = Array.from(new Set(String(output).split("\n").map(SB.packageOfManifestPath).filter(Boolean)));
            const good = {};
            const bad = {};
            return Promise.all(names.map(name => readFile(host, "/usr/share/cockpit/" + name + "/manifest.json", { syntax: JSON })
                .then(m => { good[name] = m; }, ex => { bad[name] = (ex && (ex.message || ex.problem)) || ""; })))
                .then(() => SB.packagesOf(good, bad));
        });
    }

    /* The status of one add-on: always the checked command with "status --lang xx", unprivileged
       unless the session has administrative access on that host. */
    function callStatus(host, pkg, command) {
        const proc = cockpit.spawn(SB.statusArgv(command, LANG), at(host, { superuser: "try", err: "message" }));
        return withTimeout(proc, TIMEOUT_MS.status, () => proc.close("timeout")).then(output => {
            const v = SB.validateStatus(output, pkg);
            return v.ok ? { kind: "ok", status: v.status } : { kind: "invalid", reason: v.reason, detail: v.detail };
        }, SB.classifyFailure);
    }

    /* Everything of one host, as buildBoard() takes it. Never rejects. */
    async function loadHost(host) {
        const target = host.own ? undefined : host.connection;
        if (!host.own) {
            const failed = await connect(target);
            if (failed) return failed;
        }
        const hostname = readHostname(target);
        let packages;
        try {
            const manifests = cockpit.manifests;
            /* On this host ../manifests.js gives every manifest; without it, the same way as elsewhere. */
            packages = host.own && manifests && Object.keys(manifests).length ? SB.packagesOf(manifests) : await discover(target);
        } catch (ex) {
            return { reach: "ok", discovery: "failed", hostname: await hostname,
                     message: SB.cleanText(String((ex && (ex.message || ex.problem)) || ""), SB.LIMITS.reason) };
        }
        const results = {};
        await Promise.all(Object.keys(packages).filter(pkg => packages[pkg].entry && packages[pkg].entry.command)
            .map(pkg => callStatus(target, pkg, packages[pkg].entry.command).then(r => { results[pkg] = r; })));
        return { reach: "ok", discovery: "ok", packages, results, hostname: await hostname };
    }

    /* ---------- the page's state and loading ---------- */

    const state = { loading: false, loadedAt: 0, hosts: [], alerts: [] };

    const hostLabel = host => host.label || (host.result && host.result.hostname) || host.key;

    async function load() {
        if (state.loading) return;
        state.loading = true;
        setBusy(true);
        const alerts = [];
        let list = { hosts: [], skipped: [], localLabel: null };
        try {
            list = await readMachines();
        } catch (ex) {
            alerts.push({ kind: "machines", message: SB.cleanText(String((ex && (ex.message || ex.problem)) || ""), SB.LIMITS.reason) });
        }
        if (list.skipped.length) alerts.push({ kind: "skipped", names: list.skipped });

        /* Until a host has answered again, its row shows what it showed before. */
        const before = new Map(state.hosts.map(x => [x.key, x.result]));
        const hosts = [{ key: "localhost", own: true, connection: null, label: list.localLabel }]
            .concat(list.hosts.map(m => ({ key: m.key, own: false, connection: m.connection, label: m.label })));
        hosts.forEach(x => { x.result = before.get(x.key) || { reach: "loading" }; });
        state.hosts = hosts;
        state.alerts = alerts;
        render();

        await Promise.all(hosts.map(x => loadHost(x)
            .catch(ex => ({ reach: "ok", discovery: "failed", message: SB.cleanText(String((ex && ex.message) || ex), SB.LIMITS.reason) }))
            .then(result => {
                x.result = result;
                if (x.own && result.hostname) $("sig-host").textContent = result.hostname;
                render();
            })));
        state.loadedAt = Date.now();
        state.loading = false;
        setBusy(false);
        render();
    }

    /* ---------- rendering ---------- */

    function setBusy(busy) {
        const btn = $("refresh");
        btn.disabled = busy;
        btn.setAttribute("aria-busy", busy ? "true" : "false");
        $("refresh-label").textContent = busy ? T.refreshing : T.refresh;
    }

    function renderAlerts() {
        fill($("alerts"), state.alerts.map(a => {
            const title = a.kind === "machines" ? T.machinesFailed : T.skipped(a.names.join(", "));
            const body = a.kind === "machines" ? [T.machinesFailedBody, a.message].filter(Boolean).join(" ") : null;
            return h("div", { class: "az-alert az-alert--warning", role: "status" },
                h("span", { class: "az-alert__icon" }, icon("exclamation-triangle")),
                h("p", { class: "az-alert__title" }, title),
                body ? h("p", { class: "az-alert__body" }, body) : null);
        }));
    }

    function errorText(e) {
        switch (e.kind) {
        case "invalid": {
            const text = own(T.invalid, e.reason) ? T.invalid[e.reason] : T.invalid["not-json"];
            return typeof text === "function" ? text(e.detail) : text;
        }
        case "unsupported": return T.unsupported;
        case "missing": return T.missingCommand;
        case "timeout": return T.timeout;
        case "manifest": return T.manifest;
        default: return T.failed(typeof e.exit === "number" ? e.exit : null);
        }
    }

    const text = (...kids) => h("span", { class: "sb-tile__text" }, kids);
    const meta = (...kids) => h("span", { class: "sb-tile__meta" }, kids);

    function statusParts(tile) {
        const ev = tile.eval;
        const st = tile.status;
        const key = ev.key;
        const parts = [];
        if (key) {
            parts.push(h("span", { class: "sb-tile__metric" },
                key.value ? h("span", { class: "sb-tile__value" }, key.value) : null,
                h("span", { class: "sb-tile__title" }, key.title)));
        }
        const line = st.summary || (key && key.detail);
        if (line) parts.push(text(line));
        const facts = [];
        if (ev.checkedAt !== null) facts.push(T.checked(fmtAgo(ev.checkedAt)));
        if (ev.staleSince !== null) facts.push(T.staleSince(fmtWhen(ev.staleSince)));
        if (st.dropped) facts.push(T.dropped(st.dropped));
        if (facts.length) {
            const m = meta(facts.join(" · "));
            if (ev.checkedAt !== null) m.title = fmtFull(ev.checkedAt);
            parts.push(m);
        }
        return parts;
    }

    function tileParts(tile) {
        switch (tile.kind) {
        case "status": return statusParts(tile);
        case "missing": return [text(T.missingText)];
        case "nostatus": return [text(T.nostatusText)];
        case "noaccess": return [text(T.noaccessText)];
        case "rejected": return [text(rich(T.rejectedText))];
        case "error": return [text(rich(errorText(tile.error))), tile.error.message ? meta(tile.error.message) : null];
        case "unreachable":
            return [text(rich(own(T.reach, tile.problem) ? T.reach[tile.problem] : T.reach.other)),
                    tile.message ? meta(tile.message) : null, h("span", { class: "sb-tile__go" }, T.toHost)];
        case "locked":
            return [text(T.lockedText), tile.identity ? meta(h("code", null, tile.identity)) : null,
                    h("span", { class: "sb-tile__go" }, T.toHost)];
        case "discovery": return [text(T.discoveryText), tile.message ? meta(tile.message) : null];
        default: return [];
        }
    }

    function jumpTo(host, tile) {
        if (tile.jump === "host") {
            cockpit.jump("/system", host.key);
            return;
        }
        if (!SB.PACKAGE_RE.test(tile.pkg)) return;
        const link = tile.kind === "status" && tile.eval.key && tile.eval.key.link ? tile.eval.key.link : "";
        const path = "/" + tile.pkg + (SB.LINK_RE.test(link) ? link : "");
        if (host.own) cockpit.jump(path);
        else cockpit.jump(path, host.key);
    }

    function renderTile(host, tile) {
        const key = host.key + "/" + (tile.pkg || tile.kind);
        if (tile.kind === "loading") return h("div", { class: "az-card sb-tile", "data-key": key }, text(T.loading));
        const parts = [h("span", { class: "sb-tile__head" },
            h("span", { class: "sb-tile__name" }, tile.pkg ? tile.label : T.connection),
            label(tile.state, T.words[tile.word])), tileParts(tile)];
        if (!tile.jump) return h("div", { class: "az-card sb-tile", "data-key": key }, parts);
        return h("button", { class: "az-card sb-tile", type: "button", "data-key": key, onclick: () => jumpTo(host, tile) }, parts);
    }

    /* quiet: no note for a row without tiles (the empty state above says it for all rows) */
    function renderRow(row, index, quiet) {
        const host = row.host;
        const id = "host-" + index;
        const sub = host.own ? T.thisHost : (host.connection !== host.label ? host.connection : null);
        const addons = row.tiles.some(t => t.pkg);
        return h("section", { class: "sb-host", "aria-labelledby": id, "data-host": host.key },
            h("div", { class: "sb-host__header" },
                h("h2", { class: "sb-host__title", id }, host.label),
                sub ? h("span", { class: "az-meta" }, sub) : null,
                addons && row.state !== "none" ? label(row.state, T.words[row.state], true) : null),
            row.tiles.length ? h("div", { class: "sb-tiles" }, row.tiles.map(t => renderTile(host, t)))
                : quiet ? null : h("p", { class: "sb-note" }, T.hostEmpty));
    }

    function render() {
        const hosts = SB.sortHosts(state.hosts.map(x => Object.assign({}, x, { label: hostLabel(x) })));
        const rows = SB.buildBoard(hosts, Date.now());
        const active = document.activeElement;
        const focusKey = active && active.dataset ? active.dataset.key : null;

        renderAlerts();
        const board = $("board");
        /* No add-on with a status anywhere (yet): say so once, and still show the hosts, so that
           it shows which of them answer. */
        const nothing = rows.length > 0 && rows.every(r => r.tiles.every(t => !t.pkg && t.kind !== "loading"));
        fill(board,
            nothing ? h("section", { class: "az-card" }, h("div", { class: "az-empty" },
                h("span", { class: "az-empty__icon" }, icon("info-circle")),
                h("h2", { class: "az-empty__title" }, T.emptyTitle),
                h("p", { class: "az-empty__body" }, T.emptyBody))) : null,
            rows.map((r, i) => renderRow(r, i, nothing)));
        board.setAttribute("aria-busy", state.loading ? "true" : "false");
        if (focusKey) {
            const el = Array.from(board.querySelectorAll("[data-key]")).find(x => x.dataset.key === focusKey);
            if (el && el.tagName === "BUTTON") el.focus();
        }
        $("meta").textContent = state.loadedAt ? T.loadedAt(fmtClock(state.loadedAt)) + " · " + T.hostCount(state.hosts.length) : "";
    }

    /* ---------- start ---------- */

    function translateStatic() {
        document.querySelectorAll("[data-t]").forEach(el => fill(el, rich(T[el.dataset.t])));
        document.querySelectorAll("[data-t-label]").forEach(el => el.setAttribute("aria-label", T[el.dataset.tLabel]));
        document.querySelectorAll("[data-icon]").forEach(el => el.replaceWith(icon(el.dataset.icon)));
        $("sig-version").textContent = "Status Board " + VERSION;
    }

    function init() {
        translateStatic();
        $("refresh").addEventListener("click", () => load());

        const visible = () => !(cockpit.hidden !== undefined ? cockpit.hidden : document.hidden);
        const due = () => Date.now() - state.loadedAt >= REFRESH_MS;
        /* Every half minute: load when the last load is 5 minutes old, else show the times again
           ("5 minutes ago", out of date). Nothing while the page is hidden. */
        window.setInterval(() => {
            if (state.loading || !visible()) return;
            if (due()) load();
            else render();
        }, TICK_MS);
        const onVisible = () => { if (visible() && !state.loading && due()) load(); };
        document.addEventListener("visibilitychange", onVisible);
        if (typeof cockpit.addEventListener === "function") cockpit.addEventListener("visibilitychange", onVisible);

        load();
    }

    init();
}());
