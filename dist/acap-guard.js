"use strict";
/**
 * Friendlier failures for the CamStreamer-family commands.
 *
 * `overlay`, `stream` and `switcher` do not talk to VAPIX — they talk to the HTTP
 * APIs of the CamOverlay, CamStreamer and CamSwitcher ACAPs. So on a camera where
 * the ACAP simply is not installed, the request 404s and the raw failure looks
 * like a network or credentials problem. That is the single most common
 * false alarm when running these commands across a mixed fleet: an M1137 on
 * AXIS OS 10 with no CamOverlay installed fails identically to an unreachable
 * camera.
 *
 * This wraps such a call, and *only when it fails* spends a round-trip asking the
 * camera which ACAPs are installed, so the error can name the actual cause. The
 * happy path costs nothing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withAcap = withAcap;
const core_1 = require("./vapix/core");
const INSTALL_HINT = {
    CamOverlay: 'https://camstreamer.com/camoverlay',
    CamStreamer: 'https://camstreamer.com/camstreamer',
    CamSwitcher: 'https://camstreamer.com/camswitcher',
    CamScripter: 'https://camstreamer.com/camscripter',
};
/**
 * Run an ACAP API call, converting "the ACAP is missing or stopped" into an
 * explanation instead of a transport error.
 */
async function withAcap(cam, familyId, fn) {
    try {
        return await fn();
    }
    catch (err) {
        // Before asking for the ACAP list, check whether this device can run ACAPs
        // at all. On an older camera the listing CGI is itself unavailable, so
        // without this the diagnosis fails and the user is left with the original
        // bare transport error.
        const caps = await cam.caps().catch(() => null);
        if (caps && caps.acap.embeddedDevelopmentVersion === null) {
            throw new core_1.UnsupportedError(`Camera "${cam.name}" cannot run ACAPs, so ${familyId} cannot be installed on it and ` +
                `the ${familyId.toLowerCase()} commands do not apply to this device.`, { firmware: caps.firmware, alternative: `axis caps ${cam.name}` });
        }
        const status = await cam.familyStatus(familyId);
        if (status === null) {
            // We could not read the application list — most often because that needs
            // Administrator while the ACAP's own API needs less, or because the
            // firmware predates list.cgi. Say so, and keep the original error.
            throw new core_1.UnsupportedError(`The ${familyId} API on "${cam.name}" did not respond, and the installed-application list ` +
                `could not be read to find out why${caps ? ` (firmware ${caps.firmware.raw || 'unknown'})` : ''}.\n` +
                `  The underlying error was: ${err.message}`, { alternative: `axis caps ${cam.name}` });
        }
        if (!status.installed) {
            throw new core_1.UnsupportedError(`${familyId} is not installed on "${cam.name}", so there is no ${familyId} API to talk to.`, {
                alternative: `axis apps list ${cam.name}`,
                docs: INSTALL_HINT[familyId],
            });
        }
        if (!status.running) {
            throw new core_1.UnsupportedError(`${familyId}${status.version ? ` ${status.version}` : ''} is installed on "${cam.name}" ` +
                'but not running, so its API is not answering.', {
                alternative: `axis apps start ${cam.name} ${familyId}`,
            });
        }
        // Installed and running: this is a genuine failure of the call itself.
        throw err;
    }
}
