// SPDX-License-Identifier: Apache-2.0
/* Stand-in for Cockpit's ../manifests.js: the manifests of every package on this host as
   cockpit.manifests (src/cockpit/packages.py, load_manifests_js). */
(function () {
    window.cockpit.manifests = window.__mock.localManifests();
}());
