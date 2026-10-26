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
 * through textContent only, and the page jumps only to checked package folders and links, to other
 * hosts only while the shell has its host switcher (AllowMultiHost). The board never asks for
 * administrative access and changes nothing on any host.
 *
 * It loads on opening, on Refresh and, while the page is visible, every 5 minutes. It asks again
 * instead of watching files: cockpit.file().watch() ignores the host option and would watch the
 * file on this host.
 *
 * Two tabs, part of the page's location (#/tasks, #/hosts): "Needs attention" lists what to do on
 * all hosts in one order (open findings, rated items, gaps in the coverage, hosts that cannot be
 * read; lib/status.js, buildTasks), each with its reasons, its evidence and a button into the
 * add-on; "Hosts and coverage" is the board of rows and tiles. A tile folds out every entry of its
 * answer, each opening its own place in the add-on; a switch on that tab shows only what needs
 * attention (kept in the browser), and a tile says when the same add-on runs in a newer version
 * on another host. Above both tabs, and below each host's name, the page says how many of the
 * add-ons a host is expected to have answered in time with something rated (coverage), whatever
 * the switch; below each host's name also its roles from the target profile that its Host
 * Settings sends, or that it has none, and folded the areas the suite does not cover yet (planned:
 * never counted, never a task).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
(function () {
    "use strict";

    const VERSION = "0.3.0";
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
    /* A reason of a task: neutral and outlined, so that it never reads as a state. */
    function chip(word, strong) {
        return h("span", { class: "sb-chip" + (strong ? " sb-chip--strong" : "") }, word);
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

    /* Whether the shell opens pages of other hosts: "yes", "no", or "unknown" when the page has no
       shell around it or cannot read its document. The shell decides by the meta tag
       allow-multihost that cockpit-ws writes into the shell's document from AllowMultiHost
       (src/ws/cockpitchannelresponse.c). Without "yes" it has no host switcher and turns every
       jump to another host into one to this host, with the same path (pkg/shell/state.tsx,
       init_config and update): a click on another host's tile would open the add-on of this host. */
    function shellOpensOtherHosts() {
        try {
            if (window.parent === window) return "unknown";
            const meta = window.parent.document.head.querySelector("meta[name='allow-multihost']");
            return meta && meta.content === "yes" ? "yes" : "no";
        } catch (_) {
            return "unknown";
        }
    }
    const MULTIHOST = shellOpensOtherHosts();
    const OTHER_HOSTS = MULTIHOST !== "no";

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
       unless the session has administrative access on that host. The output is read as a stream
       (without .stream() cockpit.spawn keeps all of it until the channel ends): once it goes past
       SB.MAX_OUTPUT the channel is closed at once and the answer counts as too large. */
    function callStatus(host, pkg, command) {
        const proc = cockpit.spawn(SB.statusArgv(command, LANG), at(host, { superuser: "try", err: "message" }));
        const output = SB.outputCollector(SB.MAX_OUTPUT);
        let tooLarge = null;
        const overflow = new Promise(resolve => { tooLarge = resolve; });
        proc.stream(data => {
            if (output.add(data)) return;
            try { proc.close("too-large"); } catch (_) { /* closed already */ }
            tooLarge({ kind: "invalid", reason: "too-large", detail: null });
        });
        const done = withTimeout(proc, TIMEOUT_MS.status, () => proc.close("timeout")).then(() => {
            if (output.tooLarge) return { kind: "invalid", reason: "too-large", detail: null };
            const v = SB.validateStatus(output.text(), pkg);
            return v.ok ? { kind: "ok", status: v.status } : { kind: "invalid", reason: v.reason, detail: v.detail };
        }, ex => (output.tooLarge ? { kind: "invalid", reason: "too-large", detail: null } : SB.classifyFailure(ex)));
        return Promise.race([overflow, done]);
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

    /* The switch "only what needs attention" is the user's choice in this browser; without
       storage (private window, blocked) it starts off each time. */
    const NOTABLE_KEY = "status-board:only-notable";
    function readOnlyNotable() {
        try { return window.localStorage.getItem(NOTABLE_KEY) === "1"; } catch (_) { return false; }
    }
    function saveOnlyNotable(on) {
        try { window.localStorage.setItem(NOTABLE_KEY, on ? "1" : "0"); } catch (_) { /* no storage */ }
    }

    /* open: the tiles whose entries are folded out, by data-key; folds: the folded sections that
       are open (of the tasks "accepted", "notapplicable"; of a host "limits:" and its key); both
       stay open across loads. tab: the tab shown, from the location. */
    const state = { loading: false, loadedAt: 0, hosts: [], alerts: [], open: new Set(), folds: new Set(), onlyNotable: readOnlyNotable(), tab: "tasks" };

    /* The tab is part of the page's location, as Cockpit's own pages keep theirs: #/tasks (also
       an empty or unknown location) or #/hosts. The shell keeps it in its address, so Back, a
       reload and a jump to /status-board#/hosts open that tab. */
    const TABS = ["tasks", "hosts"];
    function tabOfLocation() {
        const loc = cockpit.location;
        const first = loc && Array.isArray(loc.path) ? loc.path[0] : null;
        return TABS.includes(first) ? first : "tasks";
    }
    function selectTab(tab) {
        if (tab !== state.tab) {
            state.tab = tab;
            render();
        }
        if (tabOfLocation() !== tab && cockpit.location && typeof cockpit.location.go === "function") cockpit.location.go([tab]);
    }
    /* The tabs with the keyboard, as tabs work everywhere: arrows, Home and End. */
    const TAB_KEYS = { ArrowLeft: -1, ArrowRight: 1, Home: "first", End: "last" };
    function onTabKey(ev) {
        if (!own(TAB_KEYS, ev.key)) return;
        ev.preventDefault();
        const step = TAB_KEYS[ev.key];
        const i = step === "first" ? 0 : step === "last" ? TABS.length - 1 : (TABS.indexOf(state.tab) + step + TABS.length) % TABS.length;
        selectTab(TABS[i]);
        $("tab-" + TABS[i]).focus();
    }

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
        if (!OTHER_HOSTS && list.hosts.length) alerts.push({ kind: "noswitcher" });

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
            if (a.kind === "noswitcher") {
                return h("div", { class: "az-alert", role: "status" },
                    h("span", { class: "az-alert__icon" }, icon("info-circle")),
                    h("p", { class: "az-alert__title" }, T.noSwitcher),
                    h("p", { class: "az-alert__body" }, rich(T.noSwitcherBody)));
            }
            const title = a.kind === "machines" ? T.machinesFailed : T.skipped(a.names.join(", "));
            const body = a.kind === "machines" ? [T.machinesFailedBody, a.message].filter(Boolean).join(" ") : null;
            return h("div", { class: "az-alert az-alert--warning", role: "status" },
                h("span", { class: "az-alert__icon" }, icon("exclamation-triangle")),
                h("p", { class: "az-alert__title" }, title),
                body ? h("p", { class: "az-alert__body" }, body) : null);
        }));
    }

    /* The gaps of the coverage in the order the page names them: what says least first. */
    const GAP_ORDER = ["unreadable", "missing", "noaccess", "unconfigured", "failed", "unsupported", "unchecked", "stale", "partial"];

    /* The coverage of the board, above both tabs and outside the switch: how many of the add-ons
       the hosts are expected to have answered in time with something rated, what keeps the others
       from it, how many hosts could not be read, and as a notice how many send no target profile;
       last, as a neutral chip, how many areas the suite does not cover yet (planned, on the hosts
       tab below each host's name). Hidden while no host has an add-on with a status (the empty
       state says so). */
    function renderCoverage(rows, nothing) {
        const c = SB.coverageSummary(rows);
        const noProfile = rows.filter(r => r.noProfile).length;
        const limited = rows.find(r => r.limits);
        const box = $("coverage");
        box.hidden = nothing || (c.total === 0 && c.unread === 0);
        if (box.hidden) {
            box.replaceChildren();
            return;
        }
        const gaps = GAP_ORDER.filter(k => c.gaps[k])
            .map(k => label("warning", T.coverageGap(c.gaps[k], T.coverageWords[k])));
        fill(box,
            h("h2", { class: "sb-coverage__title", id: "coverage-title" }, T.coverage),
            h("span", { class: "sb-coverage__figure" }, T.coverageCount(c.checked, c.total)),
            gaps,
            c.unread ? label(c.unreadState, T.coverageHosts(c.unread)) : null,
            noProfile ? label("info", T.coverageNoProfile(noProfile)) : null,
            !state.loading && !gaps.length && !c.unread ? label("ok", T.coverageComplete) : null,
            limited ? h("span", { class: "sb-chip sb-coverage__limits" }, T.limitsToggle(limited.limits.length)) : null);
    }

    /* What the suite does not cover yet on a host (row.limits), below its coverage line: a toggle
       that names the number of areas as planned, and while it is open each area with what is
       missing and, where an add-on on that host covers a part of it, that part. Only texts of the
       page; it counts nowhere and is no task. It stays whatever the switch, as the coverage line
       does, and stays open when the board loads again (state.folds). */
    function renderLimits(row, index) {
        if (!row.limits) return null;
        const id = "limits:" + row.host.key;
        const open = state.folds.has(id);
        const bodyId = "limits-" + index;
        return h("div", { class: "sb-limits", "data-limits": row.host.key },
            h("button", {
                class: "az-btn az-btn--link az-btn--sm sb-limits__toggle", type: "button", "data-focus": id,
                "aria-expanded": open ? "true" : "false", "aria-controls": open ? bodyId : null,
                onclick: () => {
                    if (state.folds.has(id)) state.folds.delete(id);
                    else state.folds.add(id);
                    render();
                },
            }, icon(open ? "angle-down" : "angle-right"), h("span", null, T.limitsToggle(row.limits.length))),
            open ? h("div", { class: "sb-limits__body", id: bodyId },
                h("p", { class: "sb-limits__note" }, T.limitsNote),
                h("dl", { class: "sb-limits__list" }, row.limits.map(l => [
                    h("dt", { class: "sb-limits__area", "data-area": l.area }, T.limitAreas[l.area]),
                    h("dd", { class: "sb-limits__text" }, T.limitGaps[l.area],
                        l.part ? h("span", { class: "sb-limits__part" }, T.limitParts[l.area]) : null)]))) : null);
    }

    /* One gap: "Cron Jobs: no access", or with the check that shows it, "Security Monitor:
       Container hardening partly checked". */
    const gapText = g => g.label + ": " + (g.check ? T.checkGap[g.coverage](g.check) : T.coverageWords[g.coverage]);
    /* A host's coverage below its name: "2 of 3 expected add-ons checked · Cron Jobs: no access". */
    const coverageLine = c => [T.hostCoverage(c.checked, c.total)].concat(c.gaps.map(gapText)).join(" · ");
    /* Below a host's name: its coverage, then the roles of its target profile as neutral chips (a
       host's own words, as text), or the notice that it sends no profile. Nothing for a host that
       could not be read. */
    function hostCoverage(row) {
        const line = row.coverage ? coverageLine(row.coverage) : "";
        const profile = row.profile ? row.profile.roles.map(r => chip(T.role(r))) : row.noProfile ? [label("info", T.noProfile)] : [];
        if (!line && !profile.length) return null;
        return h("div", { class: "sb-host__coverage" }, line ? h("span", { class: "sb-host__figure" }, line) : null,
            profile.length ? h("span", { class: "sb-host__profile" }, profile) : null);
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
        if (tile.newer) parts.push(h("span", { class: "sb-tile__hint" }, icon("arrow-circle-up"), T.newerElsewhere(tile.newer)));
        const facts = [];
        if (ev.checkedAt !== null) facts.push(T.checked(fmtAgo(ev.checkedAt)));
        if (ev.staleSince !== null) facts.push(T.staleSince(fmtWhen(ev.staleSince)));
        if (st.dropped) facts.push(T.dropped(st.dropped));
        if (st.version) facts.push(T.version(st.version));
        if (facts.length) {
            const m = meta(facts.join(" · "));
            if (ev.checkedAt !== null) m.title = fmtFull(ev.checkedAt);
            parts.push(m);
        }
        return parts;
    }

    /* Why a host cannot be reached, by Cockpit's problem code. */
    const reachText = tile => (!OTHER_HOSTS && own(T.reachNoSwitcher, tile.problem) ? T.reachNoSwitcher[tile.problem]
        : own(T.reach, tile.problem) ? T.reach[tile.problem] : T.reach.other);
    const lockedText = () => (OTHER_HOSTS ? T.lockedText : T.lockedTextNoSwitcher);

    /* go: a click on the tile opens something */
    function tileParts(tile, go) {
        const toHost = go ? h("span", { class: "sb-tile__go" }, T.toHost) : null;
        switch (tile.kind) {
        case "status": return statusParts(tile);
        case "missing": return [text(tile.expected ? T.missingExpectedText : T.missingText)];
        case "nostatus": return [text(T.nostatusText)];
        case "noaccess": return [text(T.noaccessText)];
        case "rejected": return [text(rich(T.rejectedText))];
        case "error": return [text(rich(errorText(tile.error))), tile.error.message ? meta(tile.error.message) : null];
        case "unreachable": return [text(rich(reachText(tile))), tile.message ? meta(tile.message) : null, toHost];
        case "locked":
            return [text(rich(lockedText())), tile.identity ? meta(h("code", null, tile.identity)) : null, toHost];
        case "discovery": return [text(T.discoveryText), tile.message ? meta(tile.message) : null];
        default: return [];
        }
    }

    /* link: the place of one entry, finding or check ("" for the add-on's start); without one
       (undefined, null) the key item's */
    function jumpTo(host, tile, link) {
        if (!host.own && !OTHER_HOSTS) return;
        if (tile.jump === "host") {
            cockpit.jump("/system", host.key);
            return;
        }
        if (!SB.PACKAGE_RE.test(tile.pkg)) return;
        const place = typeof link === "string" ? link : tile.kind === "status" && tile.eval.key && tile.eval.key.link ? tile.eval.key.link : "";
        const path = "/" + tile.pkg + (SB.LINK_RE.test(place) ? place : "");
        if (host.own) cockpit.jump(path);
        else cockpit.jump(path, host.key);
    }

    /* One entry of an answer as a row of the table: its title (a button to its place when it has
       one), its value, its label, its detail and since when it is out of date where that differs
       from the tile's own "out of date since". An empty cell stays empty (the stacked view on a
       phone leaves it out); data-focus lets render() put the focus back. */
    function renderItem(host, tile, key, item, go) {
        const since = item.staleAt !== null && item.staleAt !== tile.eval.staleSince ? T.staleSince(fmtWhen(item.staleAt)) : null;
        const name = go && item.link
            ? h("button", { class: "az-btn az-btn--link az-btn--sm sb-item__link", type: "button", "data-focus": key + "#" + item.id,
                            onclick: () => jumpTo(host, tile, item.link) }, item.title)
            : h("span", { class: "sb-item__title" }, item.title);
        return h("tr", { class: "sb-item", "data-item": item.id },
            h("td", { class: "sb-item__name", "data-label": T.colEntry }, name),
            h("td", { class: "sb-item__value", "data-label": T.colValue }, item.value),
            h("td", { class: "sb-item__state az-nowrap", "data-label": T.colState }, label(item.state, T.words[item.word])),
            h("td", { class: "sb-item__detail", "data-label": T.colDetail }, item.detail,
                since ? h("span", { class: "az-cell-sub" }, since) : null));
    }

    /* The toggle below a tile that has more than its key item; it opens or closes the panel. */
    function renderToggle(tile, key, open, panelId) {
        return h("div", { class: "sb-tile__more" }, h("button", {
            class: "az-btn az-btn--link az-btn--sm sb-tile__toggle", type: "button", "data-focus": key + "#items",
            "aria-expanded": open ? "true" : "false", "aria-controls": open ? panelId : null,
            onclick: () => {
                if (state.open.has(key)) state.open.delete(key);
                else state.open.add(key);
                render();
            },
        }, icon(open ? "angle-down" : "angle-right"), open ? T.itemsHide : T.itemsShow(tile.eval.items.length)));
    }

    /* Every entry of an answer, in a panel across the whole row below the tile's row of cards: the
       cards keep their size, so nothing in the row moves when it opens or closes. The entries are a
       table with fixed columns (entry, value, state, detail), one row each; on a phone each row
       stacks (az-table--stack). The panel exists only while it is open (a hidden button would still
       count). */
    function renderPanel(host, tile, key, go, panelId) {
        const titleId = panelId + "-title";
        const head = [T.colEntry, T.colValue, T.colState, T.colDetail].map(t => h("th", { scope: "col" }, t));
        return h("section", { class: "az-card sb-panel", id: panelId, "data-items-for": key, "aria-labelledby": titleId },
            h("div", { class: "az-card__header" }, h("h3", { class: "az-card__title", id: titleId }, T.itemsOf(tile.label))),
            h("div", { class: "az-card__body--flush" }, h("div", { class: "az-table-wrap" },
                h("table", { class: "az-table az-table--stack sb-items" }, h("thead", null, h("tr", null, head)),
                    h("tbody", null, tile.eval.items.map(item => renderItem(host, tile, key, item, go)))))));
    }

    /* A card per tile: the tile itself (a button when a click opens something), then the toggle of
       its entries; while they are open, the panel follows the card in the grid. */
    function renderTile(host, tile, id) {
        const key = host.key + "/" + (tile.pkg || tile.kind);
        if (tile.kind === "loading") return h("div", { class: "az-card sb-cell" }, h("div", { class: "sb-tile", "data-key": key }, text(T.loading)));
        /* Without the host switcher the shell would open another host's add-on on this host. */
        const go = !!tile.jump && (host.own || OTHER_HOSTS);
        const parts = [h("span", { class: "sb-tile__head" },
            h("span", { class: "sb-tile__name" }, tile.pkg ? tile.label : T.connection),
            label(tile.state, T.words[tile.word])), tileParts(tile, go)];
        const main = go ? h("button", { class: "sb-tile", type: "button", "data-key": key, onclick: () => jumpTo(host, tile) }, parts)
            : h("div", { class: "sb-tile", "data-key": key }, parts);
        const entries = tile.kind === "status" && tile.eval.items.length >= 2;
        const open = entries && state.open.has(key);
        const panelId = "items-" + id;
        const card = h("div", { class: "az-card sb-cell" + (open ? " sb-cell--open" : "") }, main,
            entries ? renderToggle(tile, key, open, panelId) : null);
        return open ? [card, renderPanel(host, tile, key, go, panelId)] : card;
    }

    /* The row's label: the most severe state of its add-ons, or why the host could not be read. */
    function rowLabel(row) {
        if (row.tiles.some(t => t.pkg)) return row.state !== "none" ? label(row.state, T.words[row.state], true) : null;
        const fault = row.tiles.find(t => t.kind === "unreachable" || t.kind === "locked" || t.kind === "discovery");
        return fault ? label(fault.state, T.words[fault.word], true) : null;
    }

    /* quiet: no note for a row without tiles (the empty state above says it for all rows).
       The label always says the whole row; with "only what needs attention" the tiles that do not
       are left out, and a row left without any says so. The coverage line stays either way, right
       after the header. */
    function renderRow(row, index, quiet, nextId) {
        const host = row.host;
        const id = "host-" + index;
        const sub = host.own ? T.thisHost : (host.connection !== host.label ? host.connection : null);
        const tiles = state.onlyNotable ? row.tiles.filter(SB.notable) : row.tiles;
        const note = row.tiles.length ? T.nothingNotable : T.hostEmpty;
        return h("section", { class: "sb-host", "aria-labelledby": id, "data-host": host.key },
            h("div", { class: "sb-host__header" },
                h("h2", { class: "sb-host__title", id }, host.label),
                sub ? h("span", { class: "az-meta" }, sub) : null,
                rowLabel(row)),
            hostCoverage(row),
            renderLimits(row, index),
            tiles.length ? h("div", { class: "sb-tiles" }, tiles.map(t => renderTile(host, t, nextId())))
                : quiet ? null : h("p", { class: "sb-note" }, note));
    }

    /* ---------- needs attention ---------- */

    function emptyCard(title, body, iconName) {
        return h("section", { class: "az-card" }, h("div", { class: "az-empty" },
            h("span", { class: "az-empty__icon" }, icon(iconName)),
            h("h2", { class: "az-empty__title" }, title),
            h("p", { class: "az-empty__body" }, body)));
    }

    /* What a task says beyond its title: [detail, line below it], both may be null. Texts of the
       page go through rich(), texts of hosts stay text. */
    function taskDetail(task) {
        const tile = task.tile;
        switch (task.kind) {
        case "item": return [task.item.detail, null];
        case "profile": return [T.noProfileText, null];
        case "host":
            if (tile.kind === "unreachable") return [rich(reachText(tile)), tile.message];
            if (tile.kind === "locked") return [rich(lockedText()), tile.identity ? h("code", null, tile.identity) : null];
            return [T.discoveryText, tile.message];
        case "coverage":
            if (task.check) {
                return [task.checks.map(c => c.title + (c.reason ? ": " + c.reason : "") +
                    (c.staleAt !== null ? " (" + T.staleSince(fmtWhen(c.staleAt)) + ")" : "")).join("; "), null];
            }
            switch (task.coverage) {
            case "missing": return [T.missingExpectedText, null];
            /* without a check only from a version without the status entry */
            case "unsupported": return [T.nostatusText, null];
            case "noaccess": return [T.noaccessText, null];
            case "unchecked": return [T.uncheckedText, null];
            case "stale": return [T.staleText(fmtWhen(tile.eval.staleSince)), null];
            default: return tile.kind === "rejected" ? [rich(T.rejectedText), null] : [rich(errorText(tile.error)), tile.error.message];
            }
        default: return [null, null];
        }
    }

    /* One task: its label, title and "new"; host and add-on (and the item a finding belongs to);
       the reasons for its place in the list (for a gap of a host with a target profile, whether
       the profile expects the add-on); what the add-on says; since when, the evidence and what
       resolves it; and a button that opens the add-on on its host at the finding's, item's or
       check's place, through jumpTo() like a tile (nothing for another host without the host
       switcher, nor for an add-on that is missing). The notice "No target profile" opens the
       host's Host Settings where it is installed. */
    function renderTask(task, id) {
        const tile = task.tile;
        const host = task.host;
        const go = !!tile.jump && (host.own || OTHER_HOSTS);
        const titleId = "task-" + id;
        const title = task.kind === "host" ? T.words[tile.word]
            : task.kind === "profile" ? T.noProfile
            : task.kind === "coverage" && task.coverage === "missing" ? T.missingTitle(tile.label)
            : task.kind === "coverage" ? gapText({ label: tile.label, coverage: task.coverage, check: task.check ? task.check.title : null })
            : task.kind === "item" && task.item.value ? task.item.title + ": " + task.item.value : task.title;
        const where = [h("strong", null, host.label), tile.pkg ? " · " + tile.label : null, task.kind === "finding" ? " · " + task.item.title : null];
        const why = [
            task.exposure === "internet" || task.exposure === "restricted" ? chip(T.chips[task.exposure], true) : null,
            task.exploited === "known" ? chip(T.chips.exploited, true) : null,
            task.fix === "available" ? chip(T.chips.fix) : null,
            task.summaryOnly ? chip(T.chips.summary) : null,
            task.kind === "host" ? chip(T.chips.unknown, true) : null,
            task.kind === "coverage" && task.roles ? chip(task.expected ? T.chips.expected(task.roles.length, task.roles.join(", ")) : T.chips.optional) : null,
        ].filter(Boolean);
        const [detail, sub] = taskDetail(task);
        const ev = task.evidence;
        const facts = [
            task.since !== null ? [T.factSince, fmtWhen(task.since), fmtFull(task.since)] : null,
            ev ? [T.factEvidence, ev.complete === null ? T.checked(fmtWhen(ev.at)) : T.evidence[ev.complete ? "complete" : "partial"](fmtWhen(ev.at)), fmtFull(ev.at)] : null,
            [T.factResolved, T.resolved[task.kind === "coverage" && task.coverage === "missing" ? "missing" : task.kind], null],
        ].filter(Boolean);
        return h("article", { class: "az-card sb-task", "data-task": task.key, "aria-labelledby": titleId },
            h("div", { class: "sb-task__main" },
                h("div", { class: "sb-task__head" }, label(task.state, T.words[task.state]),
                    h("h3", { class: "sb-task__title", id: titleId }, title),
                    task.isNew ? h("span", { class: "sb-chip sb-chip--new" }, T.newMark) : null),
                h("p", { class: "sb-task__where" }, where),
                why.length ? h("div", { class: "sb-task__why" }, why) : null,
                detail ? h("p", { class: "sb-task__detail" }, detail) : null,
                sub ? h("p", { class: "sb-task__sub" }, sub) : null,
                h("dl", { class: "sb-task__facts" }, facts.map(f => [h("dt", null, f[0]), h("dd", { title: f[2] }, f[1])]))),
            go ? h("div", { class: "sb-task__act" }, h("button", {
                class: "az-btn az-btn--secondary az-btn--sm", type: "button", "data-focus": "task:" + task.key,
                onclick: () => jumpTo(task.host, task.tile, task.link),
            }, task.kind === "host" ? T.toHost : T.openIn(tile.label))) : null);
    }

    /* A folded section below the tasks (accepted findings, checks that do not apply): a toggle,
       and while it is open a table (az-table--stack). Left out while it has nothing. */
    function renderFold(id, title, cols, cells) {
        if (!cells.length) return null;
        const open = state.folds.has(id);
        const bodyId = "fold-" + id;
        return h("section", { class: "az-card sb-fold", "data-fold": id },
            h("h2", { class: "sb-fold__title" }, h("button", {
                class: "sb-fold__toggle", type: "button", "data-focus": "fold:" + id,
                "aria-expanded": open ? "true" : "false", "aria-controls": open ? bodyId : null,
                onclick: () => {
                    if (state.folds.has(id)) state.folds.delete(id);
                    else state.folds.add(id);
                    render();
                },
            }, icon(open ? "angle-down" : "angle-right"), h("span", null, title), h("span", { class: "sb-count" }, String(cells.length)))),
            open ? h("div", { class: "az-card__body--flush", id: bodyId }, h("div", { class: "az-table-wrap" },
                h("table", { class: "az-table az-table--stack sb-fold__table" },
                    h("thead", null, h("tr", null, cols.map(c => h("th", { scope: "col" }, c)))),
                    h("tbody", null, cells.map(r => h("tr", null, r.map((cell, i) => h("td", { "data-label": cols[i] }, cell)))))))) : null);
    }

    /* Who left a check out: the add-on itself, or the host's target profile (until when). */
    const setBy = check => (!check.byProfile ? T.setBy.addon : check.until !== null ? T.setBy.until(fmtWhen(check.until)) : T.setBy.profile);

    /* The tab "Needs attention": the tasks grouped by state (Problem, Warning, Notice), in the
       order of buildTasks(), then the folds. Says when nothing needs attention, and that hosts are
       still loading. */
    function renderTasks(model, rows, nothing, nextId) {
        /* before the host list is read there are no rows yet */
        const loading = !rows.length || rows.some(r => r.tiles.some(t => t.kind === "loading"));
        const groups = ["danger", "warning", "info"].map(s => ({ s, tasks: model.tasks.filter(t => t.state === s) })).filter(g => g.tasks.length);
        fill($("tasks"),
            nothing ? emptyCard(T.emptyTitle, T.emptyBody, "info-circle") : null,
            loading ? h("p", { class: "sb-note" }, T.loading) : null,
            !model.tasks.length && !loading && !nothing ? emptyCard(T.tasksEmptyTitle, T.tasksEmptyBody, "check-circle") : null,
            groups.map(g => h("section", { class: "sb-group", "data-group": g.s, "aria-labelledby": "group-" + g.s },
                h("h2", { class: "sb-group__title", id: "group-" + g.s }, label(g.s, T.words[g.s]), h("span", { class: "sb-count" }, String(g.tasks.length))),
                g.tasks.map(t => renderTask(t, nextId())))),
            renderFold("accepted", T.accepted, [T.colFinding, T.colHost, T.colAddon, T.colUntil],
                model.accepted.map(a => [a.finding.title, a.host.label, a.tile.label, fmtWhen(a.until)])),
            renderFold("notapplicable", T.notApplicable, [T.colCheck, T.colHost, T.colAddon, T.colReason, T.colSetBy],
                model.notApplicable.map(n => [n.check.title, n.host.label, n.tile.label, n.check.reason, setBy(n.check)])));
    }

    /* The tabs as the state says: which one is selected (and in the order of Tab), which panel
       shows, the number of tasks, and the switch only on the hosts tab. */
    function renderTabs(count) {
        TABS.forEach(t => {
            const on = t === state.tab;
            const tab = $("tab-" + t);
            tab.setAttribute("aria-selected", on ? "true" : "false");
            tab.tabIndex = on ? 0 : -1;
            $(tab.getAttribute("aria-controls")).hidden = !on;
        });
        $("count-tasks").textContent = count ? String(count) : "";
        $("notable-wrap").hidden = state.tab !== "hosts";
    }

    function render() {
        const hosts = SB.sortHosts(state.hosts.map(x => Object.assign({}, x, { label: hostLabel(x) })));
        const now = Date.now();
        const rows = SB.buildBoard(hosts, now);
        const model = SB.buildTasks(rows, now);
        const active = document.activeElement;
        /* a tile (data-key) or a control inside a card (data-focus): it gets the focus back */
        const focusKey = active && active.dataset ? active.dataset.key || active.dataset.focus || null : null;
        let seq = 0;
        const nextId = () => ++seq;

        renderAlerts();
        const board = $("board");
        const tasks = $("tasks");
        /* No add-on with a status anywhere (yet): say so once, and still show the hosts, so that
           it shows which of them answer. */
        const nothing = rows.length > 0 && rows.every(r => r.tiles.every(t => !t.pkg && t.kind !== "loading"));
        renderCoverage(rows, nothing);
        renderTabs(model.tasks.length);
        /* Only the shown tab has content: a hidden button would still count. */
        if (state.tab === "tasks") {
            renderTasks(model, rows, nothing, nextId);
            board.replaceChildren();
        } else {
            tasks.replaceChildren();
            fill(board,
                nothing ? emptyCard(T.emptyTitle, T.emptyBody, "info-circle") : null,
                rows.map((r, i) => renderRow(r, i, nothing, nextId)));
        }
        [board, tasks].forEach(el => el.setAttribute("aria-busy", state.loading ? "true" : "false"));
        board.dataset.onlyNotable = state.onlyNotable ? "true" : "false";
        if (focusKey) {
            const el = Array.from($("page").querySelectorAll("[data-key], [data-focus]"))
                .find(x => x.dataset.key === focusKey || x.dataset.focus === focusKey);
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
        /* for the tests: what the page found in the shell's document */
        $("board").dataset.multihost = MULTIHOST;
        $("refresh").addEventListener("click", () => load());
        state.tab = tabOfLocation();
        renderTabs(0);
        TABS.forEach(t => {
            $("tab-" + t).addEventListener("click", () => selectTab(t));
            $("tab-" + t).addEventListener("keydown", onTabKey);
        });
        /* Back, Forward, or the shell setting the location (a jump to /status-board#/hosts) */
        if (typeof cockpit.addEventListener === "function") {
            cockpit.addEventListener("locationchanged", () => {
                const tab = tabOfLocation();
                if (tab === state.tab) return;
                state.tab = tab;
                render();
            });
        }
        const notable = $("only-notable");
        notable.checked = state.onlyNotable;
        notable.addEventListener("change", () => {
            state.onlyNotable = notable.checked;
            saveOnlyNotable(state.onlyNotable);
            render();
        });

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
