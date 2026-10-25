/* Status Board: English texts (also the fallback for every other language).
 *
 * `…` in a text is shown as code. Texts that take values are functions. Product names
 * (Status Board, Cron Jobs, …) are never translated.
 * To add a language, copy this file to i18n/<code>.js, translate it, register it under its code
 * and add a <script> line to index.html.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
(function (root) {
    "use strict";

    const ui = {
        refresh: "Refresh",
        refreshing: "Loading …",
        loading: "Loading …",
        loadedAt: t => `Loaded at ${t}`,
        hostCount: n => (n === 1 ? "1 host" : `${n} hosts`),
        sourceCode: "Source code",
        tabsLabel: "Views",
        tabTasks: "Needs attention",
        tabHosts: "Hosts and coverage",
        thisHost: "this host",
        justNow: "just now",
        checked: when => `Checked ${when}`,
        staleSince: t => `out of date since ${t}`,
        dropped: n => (n === 1 ? "1 entry left out (invalid)" : `${n} entries left out (invalid)`),
        connection: "Connection",
        toHost: "Open the host",
        onlyNotable: "Only what needs attention",
        nothingNotable: "Nothing that needs attention.",
        itemsShow: n => `All ${n} entries`,
        itemsHide: "Hide the entries",
        itemsOf: name => `Entries of ${name}`,
        colEntry: "Entry",
        colValue: "Value",
        colState: "State",
        colDetail: "Details",
        version: v => `Version ${v}`,
        newerElsewhere: v => `Version ${v} runs on other hosts`,
        coverage: "Coverage",
        coverageCount: (n, total) => `${n} of ${total} expected add-ons checked`,
        coverageGap: (n, word) => `${n} ${word}`,
        coverageHosts: n => (n === 1 ? "1 host not read" : `${n} hosts not read`),
        coverageNoProfile: n => (n === 1 ? "1 host without a target profile" : `${n} hosts without a target profile`),
        coverageComplete: "Complete",
        hostCoverage: (n, total) => `${n} of ${total} expected add-ons checked`,
        /* What keeps an add-on from counting as checked (lib/status.js, coverageOf). */
        coverageWords: {
            unchecked: "nothing checked",
            stale: "out of date",
            noaccess: "no access",
            unreadable: "status unreadable",
            partial: "partly checked",
            failed: "check failed",
            unconfigured: "not set up",
            unsupported: "not supported",
            missing: "not installed",
        },
        /* The target profile that Host Settings sends for its host: its roles, or none. */
        role: name => `Role ${name}`,
        noProfile: "No target profile",
        noProfileText: "Without a target profile every installed add-on counts as expected, so one that is missing does not show. Host Settings sets the profile on each host.",
        missingTitle: name => `${name} is missing`,
        missingExpectedText: "Not installed on this host, although its profile expects it.",
        /* What the suite does not cover yet (lib/status.js, LIMIT_AREAS): planned scope, never a
           check, a gap or a task. limitParts: what an add-on on the host covers of an area today. */
        limitsToggle: n => `${n} areas not covered yet (planned)`,
        limitsNote: "No add-on of the suite checks these areas yet. They count neither as checked nor as gaps, and they create no tasks.",
        limitAreas: {
            backup: "Proof of backup and restore",
            vulnerabilities: "All known vulnerabilities",
            tls: "TLS certificate lifecycle",
            drift: "Configuration drift",
            identity: "Identity checks",
        },
        limitGaps: {
            backup: "Nothing proves across the suite that backups exist and that a restore works.",
            vulnerabilities: "Not every package, image and container is checked for known vulnerabilities.",
            tls: "Certificates, their expiry and their renewal are not checked.",
            drift: "Changes against a known configuration are not tracked.",
            identity: "Accounts, groups and sudo rights are not reviewed.",
        },
        limitParts: {
            backup: "In part: Image Update Monitor keeps database dumps and image rollbacks from before an update, on this host only.",
            vulnerabilities: "In part: Update Gaps shows CVE data for selected Ubuntu packages (with its network data).",
            identity: "In part: Security Monitor shows SSH keys and the logins of the last 14 days.",
        },
        /* The check that shows a gap, after the add-on's name: "Security Monitor: Container
           hardening partly checked". */
        checkGap: {
            partial: check => `${check} partly checked`,
            stale: check => `${check} out of date`,
            failed: check => `${check} failed`,
            unconfigured: check => `${check} not set up`,
            noaccess: check => `${check} without access`,
            unsupported: check => `${check} not supported here`,
        },

        /* The tab "Needs attention". */
        newMark: "new",
        /* Why a task stands where it does. */
        chips: {
            internet: "reachable from the internet",
            restricted: "reachable from some addresses",
            exploited: "known to be exploited",
            fix: "fix available",
            summary: "summary only",
            unknown: "findings unknown",
            /* a gap on a host with a target profile: n roles, their names */
            expected: (n, roles) => (n ? `expected for ${n === 1 ? "role" : "roles"} ${roles}` : "expected by the target profile"),
            optional: "not expected here",
        },
        factSince: "Since",
        factEvidence: "Evidence",
        factResolved: "Resolved when",
        evidence: {
            complete: t => `Checked ${t}, complete`,
            partial: t => `Checked ${t}, partial`,
        },
        resolved: {
            finding: "a complete check no longer finds it",
            item: "the add-on rates the entry OK again",
            coverage: "the add-on answers in time, with every check complete",
            missing: "the add-on is installed on this host and answers in time",
            profile: "Host Settings sends a target profile for this host",
            host: "the board can read the host again",
        },
        openIn: name => `Open in ${name}`,
        uncheckedText: "The add-on answers, but rates nothing yet.",
        staleText: t => `Its data is out of date since ${t}.`,
        accepted: "Accepted",
        notApplicable: "Not applicable",
        colHost: "Host",
        colAddon: "Add-on",
        colFinding: "Finding",
        colUntil: "Accepted until",
        colCheck: "Check",
        colReason: "Reason",
        colSetBy: "Set by",
        /* who left a check out */
        setBy: {
            addon: "Add-on",
            profile: "Target profile",
            until: t => `Target profile, until ${t}`,
        },
        tasksEmptyTitle: "Nothing needs attention",
        tasksEmptyBody: "No add-on reports anything that needs attention, and every host and add-on could be read in time. That means the add-ons found nothing in what they check, not that the hosts are safe.",

        /* The word of a tile's label, by state or kind. */
        words: {
            none: "Unknown",
            ok: "OK",
            info: "Notice",
            warning: "Warning",
            danger: "Problem",
            stale: "Out of date",
            unchecked: "Not checked",
            missing: "Not installed",
            absent: "Missing",
            nostatus: "No status",
            noaccess: "No access",
            unreadable: "Status unreadable",
            rejected: "Command refused",
            unreachable: "Unreachable",
            locked: "Key locked",
            discovery: "Add-ons unreadable",
        },

        missingText: "Installed on other hosts.",
        nostatusText: "This version of the add-on reports no status.",
        noaccessText: "Nothing is readable without administrative access. Usually the add-on has not checked yet, or its regular check is not set up.",
        rejectedText: "Its manifest names a status command outside `/usr/lib/cockpit-…`. The board does not run it.",
        lockedText: "Your SSH key is locked. Log in to this host once in the host switcher to unlock it.",
        lockedTextNoSwitcher: "Your SSH key is locked. Log in to Cockpit again, or unlock it with `ssh-add` in Cockpit's terminal.",
        discoveryText: "The packages on this host could not be listed.",

        /* Why a host could not be reached, by Cockpit's problem code. */
        reach: {
            "no-host": "The host cannot be reached.",
            "unknown-host": "Its host key is not known yet. Connect to it once in the host switcher.",
            "unknown-hostkey": "Its host key is not known yet. Connect to it once in the host switcher.",
            "invalid-hostkey": "Its host key has changed. Check it in the host switcher.",
            "authentication-failed": "The login was refused.",
            "no-cockpit": "`cockpit-bridge` is not installed there.",
            timeout: "No answer within 20 seconds.",
            other: "The connection ended.",
        },
        /* The same, where they would name the host switcher and Cockpit runs without it. The
           bridge checks host keys against ~/.ssh/known_hosts, as ssh in the terminal does. */
        reachNoSwitcher: {
            "unknown-host": "Its host key is not known yet. Connect to it once with `ssh` in Cockpit's terminal and check the key.",
            "unknown-hostkey": "Its host key is not known yet. Connect to it once with `ssh` in Cockpit's terminal and check the key.",
            "invalid-hostkey": "Its host key has changed. Find out why before you trust the new key; `ssh-keygen -R` in Cockpit's terminal removes the old one.",
        },

        /* Why the status of an add-on could not be read. */
        invalid: {
            "not-text": "The answer is not text.",
            "too-large": "The answer is longer than 64 KiB.",
            "not-json": "The answer is not JSON.",
            "not-object": "The answer is not a JSON object.",
            schema: v => (v ? `The answer follows version ${v} of the status contract; this board reads version 1.`
                : "The answer names no version of the status contract."),
            addon: "The answer names no valid add-on.",
            "addon-mismatch": name => `The answer belongs to another add-on (${name}).`,
            state: "The answer has no valid state.",
            items: "The answer has no list of items.",
        },
        unsupported: "The add-on does not know the verb `status` (exit 64).",
        missingCommand: "The status command is missing.",
        timeout: "No answer within 20 seconds.",
        failed: exit => (exit === null ? "The status command failed." : `The status command failed (exit ${exit}).`),
        manifest: "Its manifest could not be read.",

        emptyTitle: "No add-ons with a status",
        emptyBody: "None of the hosts has an Azentrius add-on that reports its status yet.",
        hostEmpty: "No Azentrius add-ons with a status on this host.",

        machinesFailed: "The host switcher's list could not be read",
        machinesFailedBody: "The board shows this host only.",
        skipped: names => `Left out of the host list (not a plain host name): ${names}`,
        noSwitcher: "Without the host switcher",
        noSwitcherBody: "Cockpit runs without `AllowMultiHost` and opens pages of this host only. The board still reads every host, but the tiles of other hosts open nothing.",
    };

    const texts = { locale: "en-US", ui };
    if (typeof module === "object" && module.exports) module.exports = texts;
    else (root.StatusBoardI18n = root.StatusBoardI18n || {}).en = texts;
}(typeof self !== "undefined" ? self : this));
