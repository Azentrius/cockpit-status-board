/* Status Board: deutsche Texte.
 *
 * `…` im Text wird als Code gezeigt. Texte mit Werten sind Funktionen. Produktnamen
 * (Status Board, Cron Jobs, …) werden nicht übersetzt. Anrede wie in Cockpit: „Sie“.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
(function (root) {
    "use strict";

    const ui = {
        refresh: "Aktualisieren",
        refreshing: "Lädt …",
        loading: "Lädt …",
        loadedAt: t => `Geladen um ${t}`,
        hostCount: n => (n === 1 ? "1 Host" : `${n} Hosts`),
        sourceCode: "Quellcode",
        boardLabel: "Hosts",
        thisHost: "dieser Host",
        justNow: "gerade eben",
        checked: when => `Stand ${when}`,
        staleSince: t => `veraltet seit ${t}`,
        dropped: n => (n === 1 ? "1 Eintrag ausgelassen (ungültig)" : `${n} Einträge ausgelassen (ungültig)`),
        connection: "Verbindung",
        toHost: "Host öffnen",

        words: {
            none: "Unbekannt",
            ok: "In Ordnung",
            info: "Hinweis",
            warning: "Achtung",
            danger: "Problem",
            stale: "Veraltet",
            missing: "Nicht installiert",
            nostatus: "Kein Status",
            noaccess: "Kein Zugriff",
            unreadable: "Status nicht lesbar",
            rejected: "Befehl abgelehnt",
            unreachable: "Nicht erreichbar",
            locked: "Schlüssel gesperrt",
            discovery: "Add-ons nicht lesbar",
        },

        missingText: "Auf anderen Hosts installiert.",
        nostatusText: "Diese Version des Add-ons meldet keinen Status.",
        noaccessText: "Ohne Administratorzugriff auf diesem Host hat das Add-on nichts zu melden.",
        rejectedText: "Sein Manifest nennt einen Status-Befehl außerhalb von `/usr/lib/cockpit-…`. Das Board führt ihn nicht aus.",
        lockedText: "Ihr SSH-Schlüssel ist gesperrt. Melden Sie sich einmal im Host-Umschalter an diesem Host an, um ihn zu entsperren.",
        lockedTextNoSwitcher: "Ihr SSH-Schlüssel ist gesperrt. Melden Sie sich neu bei Cockpit an oder entsperren Sie ihn im Terminal von Cockpit mit `ssh-add`.",
        discoveryText: "Die Pakete auf diesem Host ließen sich nicht auflisten.",

        reach: {
            "no-host": "Der Host ist nicht erreichbar.",
            "unknown-host": "Sein Hostschlüssel ist noch nicht bekannt. Verbinden Sie sich einmal über den Host-Umschalter.",
            "unknown-hostkey": "Sein Hostschlüssel ist noch nicht bekannt. Verbinden Sie sich einmal über den Host-Umschalter.",
            "invalid-hostkey": "Sein Hostschlüssel hat sich geändert. Prüfen Sie ihn im Host-Umschalter.",
            "authentication-failed": "Die Anmeldung wurde abgelehnt.",
            "no-cockpit": "Dort ist `cockpit-bridge` nicht installiert.",
            timeout: "Keine Antwort innerhalb von 20 Sekunden.",
            other: "Die Verbindung wurde beendet.",
        },

        invalid: {
            "not-text": "Die Antwort ist kein Text.",
            "too-large": "Die Antwort ist länger als 64 KiB.",
            "not-json": "Die Antwort ist kein JSON.",
            "not-object": "Die Antwort ist kein JSON-Objekt.",
            schema: v => (v ? `Die Antwort folgt Version ${v} des Status-Vertrags; dieses Board liest Version 1.`
                : "Die Antwort nennt keine Version des Status-Vertrags."),
            addon: "Die Antwort nennt kein gültiges Add-on.",
            "addon-mismatch": name => `Die Antwort gehört zu einem anderen Add-on (${name}).`,
            state: "Die Antwort hat keinen gültigen Zustand.",
            items: "Die Antwort hat keine Liste von Einträgen.",
        },
        unsupported: "Das Add-on kennt das Verb `status` nicht (Exit 64).",
        missingCommand: "Der Status-Befehl fehlt.",
        timeout: "Keine Antwort innerhalb von 20 Sekunden.",
        failed: exit => (exit === null ? "Der Status-Befehl ist fehlgeschlagen." : `Der Status-Befehl ist fehlgeschlagen (Exit ${exit}).`),
        manifest: "Sein Manifest ließ sich nicht lesen.",

        emptyTitle: "Keine Add-ons mit Status",
        emptyBody: "Noch hat keiner der Hosts unten ein Azentrius-Add-on, das seinen Status meldet.",
        hostEmpty: "Auf diesem Host meldet kein Azentrius-Add-on seinen Status.",

        machinesFailed: "Die Liste des Host-Umschalters ließ sich nicht lesen",
        machinesFailedBody: "Das Board zeigt nur diesen Host.",
        skipped: names => `Aus der Hostliste ausgelassen (kein einfacher Hostname): ${names}`,
        noSwitcher: "Ohne Host-Umschalter",
        noSwitcherBody: "Cockpit läuft ohne `AllowMultiHost` und öffnet nur Seiten dieses Hosts. Das Board liest trotzdem alle Hosts, aber die Kacheln anderer Hosts öffnen nichts.",
    };

    const texts = { locale: "de-DE", ui };
    if (typeof module === "object" && module.exports) module.exports = texts;
    else (root.StatusBoardI18n = root.StatusBoardI18n || {}).de = texts;
}(typeof self !== "undefined" ? self : this));
