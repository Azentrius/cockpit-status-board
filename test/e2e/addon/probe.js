// SPDX-License-Identifier: Apache-2.0
/* The test add-on's page opens cockpit.js's transport, so that it sends the shell its "init". Only
   then does the shell count the frame as loaded and mark it with data-loaded
   (pkg/shell/state.tsx, frame_is_initialized), which the end-to-end test waits for. */
cockpit.transport.wait(function () {});
