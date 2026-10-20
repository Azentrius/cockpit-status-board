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
        boardLabel: "Hosts",
        thisHost: "this host",
        justNow: "just now",
        checked: when => `Checked ${when}`,
        staleSince: t => `out of date since ${t}`,
        dropped: n => (n === 1 ? "1 entry left out (invalid)" : `${n} entries left out (invalid)`),
        connection: "Connection",
        toHost: "Open the host",

        /* The word of a tile's label, by state or kind. */
        words: {
            none: "Unknown",
            ok: "OK",
            info: "Notice",
            warning: "Warning",
            danger: "Problem",
            stale: "Out of date",
            missing: "Not installed",
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
        noaccessText: "Without administrative access on this host the add-on has nothing to report.",
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
        emptyBody: "None of the hosts below has an Azentrius add-on that reports its status yet.",
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
