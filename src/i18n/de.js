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
        onlyNotable: "Nur Auffälliges",
        nothingNotable: "Nichts Auffälliges.",
        itemsShow: n => `Alle ${n} Einträge`,
        itemsHide: "Einträge ausblenden",
        itemsOf: name => `Einträge von ${name}`,
        colEntry: "Eintrag",
        colValue: "Wert",
        colState: "Zustand",
        colDetail: "Details",
        version: v => `Version ${v}`,
        newerElsewhere: v => `Auf anderen Hosts läuft Version ${v}`,
        coverage: "Abdeckung",
        coverageCount: (n, total) => `${n} von ${total} Add-ons geprüft`,
        coverageGap: (n, word) => `${n} ${word}`,
        coverageHosts: n => (n === 1 ? "1 Host nicht gelesen" : `${n} Hosts nicht gelesen`),
        coverageComplete: "Vollständig",
        hostCoverage: (n, total) => `${n} von ${total} Add-ons geprüft`,
        coverageWords: {
            unchecked: "nichts geprüft",
            stale: "veraltet",
            noaccess: "kein Zugriff",
            unreadable: "Status nicht lesbar",
        },

        words: {
            none: "Unbekannt",
            ok: "In Ordnung",
            info: "Hinweis",
            warning: "Achtung",
            danger: "Problem",
            stale: "Veraltet",
            unchecked: "Nicht geprüft",
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
        noaccessText: "Ohne Administratorzugriff ist hier nichts lesbar. Meist hat das Add-on noch nicht geprüft, oder seine regelmäßige Prüfung ist nicht eingerichtet.",
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
        reachNoSwitcher: {
            "unknown-host": "Sein Hostschlüssel ist noch nicht bekannt. Verbinden Sie sich einmal mit `ssh` im Terminal von Cockpit und prüfen Sie den Schlüssel.",
            "unknown-hostkey": "Sein Hostschlüssel ist noch nicht bekannt. Verbinden Sie sich einmal mit `ssh` im Terminal von Cockpit und prüfen Sie den Schlüssel.",
            "invalid-hostkey": "Sein Hostschlüssel hat sich geändert. Klären Sie den Grund, bevor Sie dem neuen Schlüssel vertrauen; `ssh-keygen -R` im Terminal von Cockpit entfernt den alten.",
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
