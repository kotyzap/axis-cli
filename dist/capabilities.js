"use strict";
/**
 * Runtime capability detection.
 *
 * The premise of this file: **probe, don't guess from the firmware version.**
 *
 * Firmware version alone is a poor predictor. The same AXIS OS release runs on
 * devices with and without PTZ, with and without a card slot, on armv7hf and
 * aarch64; a feature can be compiled out of a model; an operator can disable an
 * API; and an account may lack the privilege for one API but not another. So the
 * version is only consulted where the answer genuinely is version-gated and
 * there is no parameter to read — and even then a threshold that cannot be
 * evaluated (unparseable version) is resolved optimistically, letting the call
 * fail with a real error rather than pre-emptively refusing.
 *
 * One `param.cgi?action=list&group=Brand,Properties` gets almost everything,
 * because `Properties.*` is where Axis publishes the capability flags each API's
 * documentation names in its "Identification" section. That single request works
 * on every device from firmware 5.00 to 12.x, which makes it the right
 * foundation for a CLI that must not assume a generation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCapabilities = detectCapabilities;
exports.compatibilityNotes = compatibilityNotes;
const params_1 = require("./vapix/params");
const deviceinfo_1 = require("./vapix/deviceinfo");
const apps_1 = require("./vapix/apps");
const ptz_1 = require("./vapix/ptz");
const storage_1 = require("./vapix/storage");
const firmware_1 = require("./vapix/firmware");
/**
 * The `id` values used with apidiscovery.cgi. Only the ones Axis actually
 * documents are listed — the parameter, edge-storage and ACAP APIs deliberately
 * identify themselves through `Properties.*` instead, and inventing discovery
 * ids for them would produce confident wrong answers.
 */
const API_IDS = {
    websocketEvents: 'event-streaming-over-websocket',
    ptz: 'ptz-control',
    basicDeviceInfo: 'basic-device-info',
    firmwareManagement: 'fwmgr',
};
/**
 * Is an API present according to discovery? Returns null when discovery itself is
 * unavailable, so the caller can fall back to a version threshold instead of
 * reading "absent from an empty list" as "not supported".
 */
function discovered(apis, id) {
    if (apis === null)
        return null;
    return apis.has(id);
}
/**
 * WebSocket event streaming support.
 *
 * Two independent pieces of evidence, and **either one suffices**:
 *
 *  - discovery lists `event-streaming-over-websocket`;
 *  - the firmware is at least 10.11, the release that "added support for sending
 *    device events over WebSocket connections". (The API page itself states no
 *    minimum AXIS OS version, so this is the best threshold available.)
 *
 * Deliberately *not* treating discovery as authoritative in the negative
 * direction. Axis does not guarantee that 10.11/10.12 register this id in
 * discovery, and letting an absent id veto a satisfied version threshold produced
 * a self-refuting error — "firmware 10.12.338 does not support this; requires
 * 10.11 or later" — on precisely the devices this matters for.
 *
 * An unparseable version resolves to supported, so we attempt the connection and
 * let the camera answer rather than refusing on a guess.
 */
function detectWebsocketEvents(apis, firmware) {
    if (discovered(apis, API_IDS.websocketEvents) === true)
        return true;
    return (0, firmware_1.atLeast)(firmware, '10.11') !== false;
}
async function detectCapabilities(core, options = {}) {
    // One request for the whole capability surface. Brand and Properties both
    // exist on every device that speaks VAPIX 3, so this cannot 404 the way a
    // request for an optional leaf group can.
    const params = await (0, params_1.listParams)(core, ['Brand', 'Properties'], options);
    const firmware = (0, firmware_1.parseFirmware)(params.get('Properties.Firmware.Version'));
    // These three are independent probes against optional APIs; run them together
    // so a slow or unreachable one does not serialise with the others.
    //
    // Every one is wrapped so it cannot fail capability detection. That is the
    // whole point of this function: it must succeed on any device that answers
    // param.cgi, because everything else in the CLI depends on it. An optional
    // API having a bad day is information, not a reason to give up.
    const [apis, device, supportedSdks] = await Promise.all([
        (0, deviceinfo_1.getApiList)(core, options).catch(() => null),
        (0, deviceinfo_1.getDeviceInfo)(core, { ...options, params }).catch(() => (0, deviceinfo_1.deviceInfoFromParams)(params)),
        // Only ask a device that admits to ACAP support; info.cgi is unversioned
        // in the docs, so on anything older this is a wasted round-trip at best.
        params.has('Properties.EmbeddedDevelopment.Version')
            ? (0, apps_1.getSupportedSdks)(core, options).catch(() => null)
            : Promise.resolve(null),
    ]);
    const embeddedDevelopmentVersion = params.get('Properties.EmbeddedDevelopment.Version') ?? null;
    const websocket = detectWebsocketEvents(apis, firmware);
    // /vapix/services (GetEventInstances) has been there since firmware 5.50, and
    // there is no parameter for it, so anything not demonstrably older qualifies.
    const soap = (0, firmware_1.atLeast)(firmware, '5.50') !== false;
    // RTSP metadata eventing is gated by the metadata property, firmware 5.50+.
    const rtsp = params.yes('Properties.API.Metadata.Metadata');
    const transports = [];
    if (websocket)
        transports.push('websocket');
    if (soap)
        transports.push('soap');
    if (rtsp)
        transports.push('rtsp-metadata');
    return {
        firmware,
        osTrack: (0, firmware_1.osTrack)(firmware),
        acapGeneration: (0, firmware_1.acapGeneration)(firmware),
        device,
        params,
        apis,
        ptz: (0, ptz_1.readPtzSupport)(params),
        acap: {
            embeddedDevelopmentVersion,
            // The docs gate list.cgi on EmbeddedDevelopment 1.20 or later. Compared
            // as a dotted version, not a float: as a float, "1.3" would beat "1.20"
            // (1.3 > 1.2) when as versions 1.3 is older.
            canList: embeddedDevelopmentVersion !== null &&
                (0, firmware_1.atLeast)((0, firmware_1.parseFirmware)(embeddedDevelopmentVersion), '1.20') === true,
            // !== false, matching every other threshold here: an unparseable version
            // means "try it", and getAppConfig will attempt the call regardless, so
            // reporting false would contradict what the code actually does.
            canConfig: (0, firmware_1.atLeast)(firmware, '11.2') !== false,
            supportedSdks,
        },
        storage: {
            supported: (0, storage_1.supportsLocalStorage)(params),
            version: params.get('Properties.LocalStorage.Version') ?? null,
        },
        events: { transports, websocket, soap },
        apiDiscovery: params.yes('Properties.ApiDiscovery.ApiDiscovery') || apis !== null,
        basicDeviceInfo: 
        // Note the Properties. prefix. Without it this lookup could never match,
        // because detectCapabilities only lists the Brand and Properties groups —
        // so a device that advertised the API via parameters alone (8.40–8.49, no
        // discovery) was reported as not having it.
        params.yes('Properties.BasicDeviceInfo.BasicDeviceInfo') ||
            discovered(apis, API_IDS.basicDeviceInfo) === true ||
            device.source === 'basicdeviceinfo.cgi',
        firmwareManagement: params.has('Properties.FirmwareManagement.Version') || discovered(apis, API_IDS.firmwareManagement) === true,
    };
}
/**
 * Notes worth telling the user about this specific device, gathered in one place
 * so `caps` and the error paths agree on the wording.
 *
 * Each note explains something that will otherwise show up later as a confusing
 * failure — the aim is that nobody has to read AXIS OS release notes to work out
 * why a command behaved differently on one camera than another.
 */
function compatibilityNotes(caps) {
    const notes = [];
    const fw = caps.firmware;
    if (fw.parts.length === 0) {
        notes.push('This device did not report a parseable firmware version, so version-gated features are ' +
            'attempted rather than pre-checked. Failures will come from the camera, not from this CLI.');
    }
    if ((0, firmware_1.atLeast)(fw, '11.6') === true) {
        notes.push('AXIS OS 11.6 and later ship without a default "root" account. If authentication fails, the ' +
            'camera may still need its first user created in the web UI.');
    }
    if ((0, firmware_1.atLeast)(fw, '12.0') === true) {
        notes.push('AXIS OS 12.0 removed TLS 1.0/1.1, refuses unsigned ACAPs by default, and dropped ' +
            'getBrand.cgi and releaseinfo.cgi (this CLI uses basicdeviceinfo.cgi and param.cgi instead).');
    }
    if ((0, firmware_1.atLeast)(fw, '12.1') === true) {
        notes.push('From AXIS OS 12.1 the default authentication policy uses Basic over HTTPS and Digest over ' +
            'HTTP. This CLI negotiates from the camera\'s own challenge, so either is fine — but use ' +
            '--tls so Basic credentials are not sent in clear text.');
    }
    if (!caps.events.websocket) {
        notes.push('Live event streaming over WebSocket needs AXIS OS 10.11 or later. On this device use ' +
            '"axis events topics" to enumerate topics; live "events watch" is not available.');
    }
    if (caps.ptz.digital && !caps.ptz.mechanical) {
        notes.push('This camera has digital PTZ only. Position queries will report zoom but no pan or tilt, ' +
            'which is expected rather than an error.');
    }
    if (!caps.storage.supported) {
        notes.push('This device reports no edge storage, so SD card status is unavailable.');
    }
    if (caps.acap.embeddedDevelopmentVersion === null) {
        notes.push('This device reports no ACAP support, so the apps, overlay, stream and switcher commands do not apply.');
    }
    else if (!caps.acap.canList) {
        notes.push(`This device reports ACAP support version ${caps.acap.embeddedDevelopmentVersion}; listing ` +
            'installed applications needs 1.20 or later.');
    }
    return notes;
}
