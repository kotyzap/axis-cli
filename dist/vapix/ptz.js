"use strict";
/**
 * PTZ — /axis-cgi/com/ptz.cgi
 *
 * Reference: https://developer.axis.com/vapix/network-video/pantiltzoom-api/
 *
 * The endpoint has been `com/ptz.cgi` since firmware 5.20 and was never
 * deprecated; there is no `/axis-cgi/ptz.cgi`. What *does* vary by device is
 * whether PTZ exists at all, and this API is unusually bad at saying so:
 *
 *  - **Errors come back as HTTP 200** with a body of `Error:` followed by the
 *    message on the next line. Checking the status code tells you nothing.
 *  - **Successful control commands return 204 No Content**, while queries return
 *    200. So neither "200 means it worked" nor "204 means it worked" is right on
 *    its own.
 *  - **A fixed camera answers queries with a partial or empty body** rather than
 *    an error. A box camera with digital PTZ, such as an M1137, reports no pan
 *    or tilt at all — which is why a strict numeric schema over the response
 *    fails with "pan: expected number, received nan" instead of saying the
 *    camera has no pan axis.
 *
 * So support is established from `Properties.PTZ.*` before the call, and the
 * response is parsed as "whatever axes this device reports".
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPtzSupport = readPtzSupport;
exports.requirePtz = requirePtz;
exports.getPosition = getPosition;
exports.getPresets = getPresets;
exports.goToPreset = goToPreset;
exports.getAvailableCommands = getAvailableCommands;
const core_1 = require("./core");
const PTZ_CGI = '/axis-cgi/com/ptz.cgi';
function readPtzSupport(params) {
    const mechanical = params.yes('Properties.PTZ.PTZ');
    const digital = params.yes('Properties.PTZ.DigitalPTZ');
    return { mechanical, digital, any: mechanical || digital };
}
/**
 * Refuse politely, naming what the camera actually is.
 *
 * Written as a full explanation rather than a terse error because "PTZ not
 * supported" on a camera whose datasheet says "Digital PTZ" is confusing — the
 * distinction between mechanical and digital PTZ is the thing the user needs.
 */
function requirePtz(support, firmware, cameraName) {
    if (support.any)
        return;
    throw new core_1.UnsupportedError(`Camera "${cameraName}" reports no PTZ support (Properties.PTZ.PTZ=no, Properties.PTZ.DigitalPTZ=no), ` +
        'so there is nothing to pan, tilt, or zoom.', {
        firmware,
        docs: 'https://developer.axis.com/vapix/network-video/pantiltzoom-api/',
        alternative: `axis caps ${cameraName}`,
    });
}
function parseKeyedText(body) {
    const out = {};
    for (const line of body.split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx === -1)
            continue;
        out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    return out;
}
function optNum(v) {
    if (v === undefined)
        return null;
    // An empty value is how a device reports a key it has no value for. Without
    // this guard Number('') is 0, so `pan=` read as a *measured* pan of zero —
    // which is exactly the wrong answer on the fixed cameras this file exists for,
    // and it defeated the "not reported by this camera" logic downstream.
    if (v.trim() === '')
        return null;
    const n = Number(v);
    // A fixed camera can also report "pan=nan" rather than omitting the key.
    return Number.isFinite(n) ? n : null;
}
function optBool(v) {
    if (v === undefined)
        return null;
    const s = v.trim().toLowerCase();
    // ptz.cgi documents on/off, but tolerate the yes/no and true/false spellings
    // Axis uses elsewhere rather than reporting a value the camera gave us as
    // "not reported".
    if (s === 'on' || s === 'yes' || s === 'true' || s === '1')
        return true;
    if (s === 'off' || s === 'no' || s === 'false' || s === '0')
        return false;
    return null;
}
/**
 * Current position. Every axis is optional: the docs note that the response
 * "depends on what functions the Axis product supports and what functions are
 * enabled", so a device reporting only `zoom` is behaving correctly.
 */
async function getPosition(core, camera, options = {}) {
    const raw = parseKeyedText(await core.getText(PTZ_CGI, { query: 'position', camera }, options));
    return {
        pan: optNum(raw.pan),
        tilt: optNum(raw.tilt),
        zoom: optNum(raw.zoom),
        focus: optNum(raw.focus),
        iris: optNum(raw.iris),
        autofocus: optBool(raw.autofocus),
        autoiris: optBool(raw.autoiris),
        raw,
    };
}
/**
 * Presets for a channel, from `query=presetposcam`.
 *
 * The reply is a flat `presetposno<N>=<name>` list, which is also how presets
 * looked on firmware 5.x — one of the few PTZ shapes that never changed.
 *
 * The number is kept rather than discarded. Preset numbers are not contiguous —
 * deleting preset 2 of five leaves 1,3,4,5 — so renumbering them by position
 * displays a preset number that does not exist on the camera, which is worse than
 * showing none. It also makes duplicate names distinguishable.
 */
async function getPresets(core, camera, options = {}) {
    const body = await core.getText(PTZ_CGI, { query: 'presetposcam', camera }, options);
    const presets = [];
    for (const line of body.split(/\r?\n/)) {
        // The name is allowed to be empty: a configured-but-unnamed preset still
        // exists and should be listed, not silently dropped.
        const m = line.match(/^\s*presetposno(\d+)\s*=\s*(.*)$/i);
        if (!m)
            continue;
        const number = parseInt(m[1], 10);
        if (!Number.isFinite(number))
            continue;
        presets.push({ number, name: m[2].trim() });
    }
    return presets.sort((a, b) => a.number - b.number);
}
async function goToPreset(core, camera, presetName, options = {}) {
    await core.getText(PTZ_CGI, { camera, gotoserverpresetname: presetName }, options);
}
/**
 * The commands this device will actually accept, from `info=1`.
 *
 * Useful because PTZ capability is not binary — a camera may support `zoom` and
 * `areazoom` while rejecting `move` — and this is the only way to know without
 * trying each one.
 */
async function getAvailableCommands(core, camera, options = {}) {
    const body = await core.getText(PTZ_CGI, { info: '1', camera }, options);
    const commands = new Set();
    for (const line of body.split(/\r?\n/)) {
        // Lines look like "continuouspantiltmove=[x-speed],[y-speed]" or
        // "move={ home | up | ... }"; indented lines are arguments to the
        // command above them, not commands.
        if (/^\s/.test(line))
            continue;
        // Underscores and hyphens allowed: no current Axis command uses them, but
        // silently hiding a command the camera advertises is the wrong failure mode.
        const m = line.match(/^([a-z][a-z0-9_-]*)\s*=/i);
        if (m)
            commands.add(m[1].toLowerCase());
    }
    return [...commands].sort();
}
