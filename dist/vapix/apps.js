"use strict";
/**
 * ACAP application management — applications/{list,control,upload,info,config}.cgi
 *
 * Reference: https://developer.axis.com/vapix/applications/application-api/
 *
 * This file exists because the generic wrapper in camstreamerlib cannot be used
 * across firmware generations. Three concrete reasons:
 *
 *  1. Its response schema makes `NiceName`, `Vendor`, `Version`, `License` and
 *     `Status` **required**. Axis' own XSD marks most application attributes
 *     optional, and older/bundled ACAPs omit several of them — so a single
 *     sparse entry makes the whole listing throw. Everything here is optional
 *     except `Name`.
 *  2. It lowercases the package name before calling control.cgi. That happens to
 *     work for the CamStreamer family, but `package=` must match the `Name`
 *     attribute, so it silently breaks every third-party ACAP —
 *     `AXIS_Object_Analytics`, `vmd`, and so on. We resolve the exact `Name`
 *     from the listing instead.
 *  3. It ignores the documented error-code tables, so a failure surfaces as an
 *     opaque "Error: 4" rather than "application not found".
 *
 * A further trap the docs warn about: control.cgi and upload.cgi report failure
 * with **HTTP 200** and an `Error: <n>` body, so status-code checks alone see
 * success. VapixCore handles that; this file maps the codes to sentences.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMSTREAMER_FAMILY = void 0;
exports.parseApplicationList = parseApplicationList;
exports.listApplications = listApplications;
exports.resolveApplication = resolveApplication;
exports.controlApplication = controlApplication;
exports.getSupportedSdks = getSupportedSdks;
exports.parseSupportedSdks = parseSupportedSdks;
exports.getAppConfig = getAppConfig;
exports.uploadApplication = uploadApplication;
exports.preflightUpload = preflightUpload;
exports.requireAcapSupport = requireAcapSupport;
const core_1 = require("./core");
const xml_1 = require("./xml");
const firmware_1 = require("./firmware");
const LIST_CGI = '/axis-cgi/applications/list.cgi';
const CONTROL_CGI = '/axis-cgi/applications/control.cgi';
const UPLOAD_CGI = '/axis-cgi/applications/upload.cgi';
const INFO_CGI = '/axis-cgi/applications/info.cgi';
const CONFIG_CGI = '/axis-cgi/applications/config.cgi';
/**
 * ACAPs from the CamStreamer family, which the overlay/stream/switcher commands
 * talk to over their own HTTP APIs. Matched case-insensitively against `Name`.
 */
exports.CAMSTREAMER_FAMILY = [
    'CamStreamer',
    'CamSwitcher',
    'CamOverlay',
    'CamScripter',
    'PlaneTracker',
    'Ndihxplugin',
    'SportTracker',
    'CamOverlayHtmlplugin',
];
/**
 * control.cgi error codes, verbatim from the Application API documentation.
 * Codes 6 and 7 are not failures for every action — see `isBenignControlCode`.
 */
const CONTROL_ERRORS = {
    1: 'invalid application package — not an Embedded Axis Package, or its manifest is invalid',
    4: 'application not found on this camera',
    6: 'the application is already running',
    7: 'the application is not running',
    9: 'too many applications are running for another one to start (this limit was removed in AXIS OS 12.6)',
    10: 'unspecified error — check the camera system log',
    15: 'the operation timed out; its outcome is unknown — check the camera system log',
};
/** upload.cgi error codes, verbatim from the Application API documentation. */
const UPLOAD_ERRORS = {
    1: 'invalid application package — not an Embedded Axis Package',
    2: 'signature verification failed — the package signature is missing or invalid',
    3: 'application package too large, or the device storage is full',
    5: 'package not compatible with this device — check the architecture and the AXIS OS version',
    10: 'unspecified error — check the camera system log',
    12: 'another application upload is already in progress',
    13: 'installation failed — the package requires a user or group that is not allowed',
    14: 'a package with the same name but different letter case already exists',
    15: 'the operation timed out; its outcome is unknown — check the camera system log',
    27: 'upgrade not allowed — the vendor ID must match the application being replaced',
    29: 'invalid manifest.json or package.conf in the package',
};
/**
 * Surface the `<error type="..." message="..."/>` child that both list.cgi and
 * config.cgi use, per the published XSD. Note this is a child *element*, not an
 * attribute on `<reply>` — a detail worth stating because the obvious guess
 * (`<reply result="error" error="..."/>`) is wrong and would parse as success.
 */
function replyError(reply) {
    if (reply === undefined || reply === null)
        return null;
    // `<reply>some junk</reply>` parses to a bare string. That is not the
    // documented envelope, and treating it as a successful empty listing would
    // report "no applications installed" for a request the camera refused.
    if (typeof reply !== 'object') {
        const text = (0, xml_1.str)(reply);
        return text ? `unexpected reply: ${text.slice(0, 200)}` : 'unexpected reply';
    }
    const node = reply;
    const err = node.error;
    if (err !== undefined && err !== null) {
        // Documented form is `<error type="1" message="..."/>`, but a text-only
        // `<error>Access denied</error>` parses to a string — which the
        // attribute-only version read as "no error", i.e. zero ACAPs.
        if (typeof err !== 'object') {
            const text = (0, xml_1.str)(err);
            return text ?? 'the camera reported an unspecified error';
        }
        const e = err;
        const message = (0, xml_1.str)((0, xml_1.attr)(e, 'message'));
        const type = (0, xml_1.str)((0, xml_1.attr)(e, 'type'));
        if (message)
            return `${message}${type ? ` (type ${type})` : ''}`;
        if (type)
            return `error type ${type}`;
        // An <error> element with neither attribute is still an error.
        return (0, xml_1.str)(err) ?? 'the camera reported an unspecified error';
    }
    if ((0, xml_1.str)((0, xml_1.attr)(node, 'result'))?.toLowerCase() === 'error') {
        return 'the camera reported an unspecified error';
    }
    return null;
}
function parseApplicationList(body) {
    let doc;
    try {
        doc = xml_1.xmlParser.parse(body);
    }
    catch (err) {
        throw new core_1.VapixError(`Could not parse the application list as XML: ${err.message}`, { path: LIST_CGI, body: body.slice(0, 500) });
    }
    const reply = doc?.reply;
    if (!reply) {
        // A camera without ACAP support, or a reverse proxy in the way, answers
        // with something that is not the documented envelope at all.
        throw new core_1.VapixError('The camera did not return an application list. This firmware may not support ACAPs, ' +
            'or the account may lack Administrator rights.', { path: LIST_CGI, body: body.slice(0, 500) });
    }
    const err = replyError(reply);
    if (err)
        throw new core_1.VapixError(`applications/list.cgi: ${err}`, { path: LIST_CGI, body: body.slice(0, 500) });
    return (0, xml_1.asArray)(reply.application).flatMap((app) => {
        const name = (0, xml_1.str)((0, xml_1.attr)(app, 'Name'));
        // Without a Name there is nothing we could act on, so drop the entry
        // rather than inventing an identifier for it.
        if (!name)
            return [];
        const raw = {};
        for (const [k, v] of Object.entries(app)) {
            if (k === '#text')
                continue; // an element's own text is not an attribute
            const value = (0, xml_1.str)(v);
            if (value !== null)
                raw[k] = value;
        }
        // Searched by local name so Min/Max work as attributes or as child
        // elements, and multiple VersionRange entries are all picked up. A
        // text-only <VersionRange>10.9-12.0</VersionRange> yields no usable
        // bounds, so it is dropped rather than reported as {min:null,max:null}.
        const ranges = (0, xml_1.findElements)(app.CompatibleOsVersions, 'VersionRange')
            .map((r) => ({ min: (0, xml_1.str)((0, xml_1.attr)(r, 'Min')), max: (0, xml_1.str)((0, xml_1.attr)(r, 'Max')) }))
            .filter((r) => r.min !== null || r.max !== null);
        const resources = (0, xml_1.findElements)(app.Resources, 'Resource')
            .map((r) => ({ name: (0, xml_1.str)((0, xml_1.attr)(r, 'name')) ?? '', used: (0, xml_1.bool)((0, xml_1.attr)(r, 'used')) }))
            .filter((r) => r.name !== '');
        return [
            {
                name,
                niceName: (0, xml_1.str)((0, xml_1.attr)(app, 'NiceName')),
                vendor: (0, xml_1.str)((0, xml_1.attr)(app, 'Vendor')),
                version: (0, xml_1.str)((0, xml_1.attr)(app, 'Version')),
                status: (0, xml_1.str)((0, xml_1.attr)(app, 'Status')),
                license: (0, xml_1.str)((0, xml_1.attr)(app, 'License')),
                licenseExpirationDate: (0, xml_1.str)((0, xml_1.attr)(app, 'LicenseExpirationDate')),
                applicationId: (0, xml_1.str)((0, xml_1.attr)(app, 'ApplicationID')),
                bundled: (0, xml_1.bool)((0, xml_1.attr)(app, 'Bundled')),
                configurationPage: (0, xml_1.str)((0, xml_1.attr)(app, 'ConfigurationPage')),
                // The prose documentation calls this SignatureStatus while the XSD
                // calls it SignedStatus. Accept either.
                signatureStatus: (0, xml_1.str)((0, xml_1.attr)(app, 'SignatureStatus', 'SignedStatus')),
                compatibleOsVersions: ranges.length > 0 ? ranges : null,
                resources: resources.length > 0 ? resources : null,
                familyId: exports.CAMSTREAMER_FAMILY.find((id) => id.toLowerCase() === name.toLowerCase()) ?? null,
                raw,
            },
        ];
    });
}
async function listApplications(core, options = {}) {
    return parseApplicationList(await core.callCgi(LIST_CGI, {}, options));
}
/**
 * Resolve a user-supplied application name to the exact `Name` the camera uses.
 *
 * `package=` is matched exactly by control.cgi, but nobody wants to type
 * `AXIS_Object_Analytics` with the right underscores and capitals, so accept a
 * case-insensitive match on either `Name` or `NiceName` and report ambiguity
 * rather than picking one arbitrarily.
 */
function resolveApplication(apps, query) {
    const needle = query.trim().toLowerCase();
    const exact = apps.find((a) => a.name === query.trim());
    if (exact)
        return exact;
    const byName = apps.filter((a) => a.name.toLowerCase() === needle);
    if (byName.length === 1)
        return byName[0];
    const byNice = apps.filter((a) => (a.niceName ?? '').toLowerCase() === needle);
    if (byNice.length === 1)
        return byNice[0];
    const loose = apps.filter((a) => a.name.toLowerCase().includes(needle) || (a.niceName ?? '').toLowerCase().includes(needle));
    if (loose.length === 1)
        return loose[0];
    if (loose.length > 1) {
        throw new Error(`"${query}" matches several applications: ${loose.map((a) => a.name).join(', ')}.\n` +
            '  Use the exact name from "axis apps list".');
    }
    const available = apps.map((a) => a.name).sort();
    throw new Error(`No application named "${query}" is installed.\n` +
        (available.length
            ? `  Installed: ${available.join(', ')}`
            : '  This camera reports no installed applications.'));
}
/**
 * Codes that mean "the requested end state already holds", which is what the
 * caller wanted. Idempotence matters here because these commands are the ones
 * people put in scripts and cron jobs.
 *
 * Code 6 ("already running") is benign for start. Code 7 ("not running") is
 * benign for stop. Note that the docs give one shared table for all actions and
 * do not state which code comes back from stopping an already-stopped app, so
 * the mapping for 7 is inference from its wording, not a documented guarantee.
 */
function isBenignControlCode(action, code) {
    if (action === 'start' && code === 6)
        return true;
    if (action === 'stop' && code === 7)
        return true;
    return false;
}
async function controlApplication(core, action, packageName, options = {}) {
    try {
        const body = await core.callCgi(CONTROL_CGI, { action, package: packageName }, options);
        const text = body.trim();
        if (text.toUpperCase() === 'OK' || text === '')
            return { alreadyInState: false };
        // A body that is neither OK nor a recognised error: report it rather than
        // assuming success.
        throw new core_1.VapixError(`applications/control.cgi returned an unexpected reply: ${text.slice(0, 200)}`, {
            path: CONTROL_CGI,
            body: text,
        });
    }
    catch (err) {
        if (!(err instanceof core_1.VapixError) || typeof err.detail.code !== 'number')
            throw err;
        const code = err.detail.code;
        if (isBenignControlCode(action, code))
            return { alreadyInState: true };
        const explanation = CONTROL_ERRORS[code] ?? `error code ${code}`;
        throw new core_1.VapixError(`Could not ${action} "${packageName}": ${explanation}`, {
            path: CONTROL_CGI,
            code,
        });
    }
}
/**
 * The SDK generations this device can run, straight from the device.
 *
 * This is the only trustworthy answer to "will my .eap install here", because it
 * comes from the camera rather than from a firmware-version lookup table.
 * Returns null when info.cgi is absent — the docs give no minimum AXIS OS
 * version for it, so older devices simply may not have it.
 */
async function getSupportedSdks(core, options = {}) {
    let body;
    try {
        body = await core.callCgi(INFO_CGI, {}, options);
    }
    catch {
        return null;
    }
    try {
        const sdks = parseSupportedSdks(xml_1.xmlParser.parse(body));
        return sdks.length > 0 ? sdks : null;
    }
    catch {
        return null;
    }
}
/**
 * Pull the SDK names out of a parsed info.cgi reply.
 *
 * The documented example is `<sdk>acap3</sdk>` — plain text. Real cameras also
 * send attributes on that element, e.g. `<sdk version="3.5">acap3</sdk>`, and
 * with attribute parsing enabled fast-xml-parser then represents the element as
 * an object rather than a string. `String(obj)` on that yields "[object Object]",
 * which is exactly what an AXIS M1137 on 10.12.300 displayed.
 *
 * So take the text node when there is one, and fall back to a recognisable
 * attribute if the name lives there instead.
 */
function parseSupportedSdks(doc) {
    const out = [];
    for (const entry of (0, xml_1.asArray)(doc?.reply?.supportedSdks?.sdk)) {
        if (entry === null || entry === undefined)
            continue;
        if (typeof entry === 'string' || typeof entry === 'number') {
            const s = String(entry).trim();
            if (s)
                out.push(s);
            continue;
        }
        if (typeof entry !== 'object')
            continue;
        const obj = entry;
        // '#text' is fast-xml-parser's key for an element's text content when the
        // element also carries attributes.
        const text = (0, xml_1.str)(obj['#text']);
        if (text) {
            out.push(text);
            continue;
        }
        // No text node: look for the name among the attributes rather than
        // dropping the entry silently.
        const named = (0, xml_1.str)(obj.name) ?? (0, xml_1.str)(obj.id) ?? (0, xml_1.str)(obj.sdk);
        if (named) {
            out.push(named);
            continue;
        }
        // Last resort: any attribute value that looks like an SDK identifier.
        const guess = Object.values(obj).map(xml_1.str).find((v) => v && /^acap/i.test(v));
        if (guess)
            out.push(guess);
    }
    // De-duplicate while preserving the order the camera reported.
    return [...new Set(out)];
}
/**
 * Read an ACAP installation policy flag. AXIS OS 11.2 and later only.
 *
 * Chiefly useful for explaining a rejected upload: from AXIS OS 12.0 the default
 * for `AllowUnsigned` flipped to false, so an unsigned .eap that installed fine
 * on a 10.x or 11.x camera is refused with "verification failed" on 12.x.
 */
async function getAppConfig(core, name, firmware, options = {}) {
    if ((0, firmware_1.atLeast)(firmware, '11.2') === false)
        return null;
    try {
        const body = await core.callCgi(CONFIG_CGI, { action: 'get', name }, options);
        const doc = xml_1.xmlParser.parse(body);
        if (replyError(doc?.reply))
            return null;
        // Searched case-insensitively, matching every other attribute read here.
        const param = (0, xml_1.findElements)(doc?.reply, 'param').find((p) => (0, xml_1.str)((0, xml_1.attr)(p, 'name'))?.toLowerCase() === name.toLowerCase());
        return param ? (0, xml_1.bool)((0, xml_1.attr)(param, 'value')) : null;
    }
    catch {
        return null;
    }
}
/**
 * Upload and install an .eap.
 *
 * The multipart field name is `file` — this is worth being explicit about
 * because several third-party clients use `packfil`, which Axis has never
 * documented and which the CGI ignores, producing a bewildering "error 1".
 *
 * Content-Type is left for fetch to set so the multipart boundary is generated
 * and included; setting it manually yields a boundary-less header and the upload
 * is rejected.
 */
async function uploadApplication(core, fileName, contents, options = {}) {
    const form = new FormData();
    // Copied into a fresh buffer so the Blob owns a plain ArrayBuffer; a Uint8Array
    // view over a pooled Node buffer can otherwise carry unrelated bytes.
    const bytes = new Uint8Array(contents.byteLength);
    bytes.set(contents);
    form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), fileName);
    try {
        const body = await core.postMultipart(UPLOAD_CGI, form, options);
        const text = body.trim();
        if (text.toUpperCase() !== 'OK' && text !== '') {
            throw new core_1.VapixError(`applications/upload.cgi returned an unexpected reply: ${text.slice(0, 200)}`, {
                path: UPLOAD_CGI,
                body: text,
            });
        }
    }
    catch (err) {
        if (!(err instanceof core_1.VapixError) || typeof err.detail.code !== 'number')
            throw err;
        const code = err.detail.code;
        throw new core_1.VapixError(`Upload of "${fileName}" failed: ${UPLOAD_ERRORS[code] ?? `error code ${code}`}`, {
            path: UPLOAD_CGI,
            code,
        });
    }
}
/**
 * Pre-flight for an .eap upload.
 *
 * Mostly advisory: the camera is the authority on what installs, and a filename is
 * weak evidence. This exists to turn the camera's terse "error 5 — package not
 * compatible" into something actionable *before* pushing 30 MB over the network,
 * not to second-guess the device.
 *
 * Only one finding blocks — a definite architecture mismatch, which cannot
 * succeed. Everything else is context, including the signing policy: we have no
 * way to know whether a given .eap is signed, so refusing on that basis would
 * block the normal case.
 */
function preflightUpload(input) {
    const findings = [];
    const lower = input.fileName.toLowerCase();
    // ACAP build artefacts are conventionally named
    // <app>_<version>_<arch>.eap, e.g. myapp_1_0_0_armv7hf.eap.
    const arch = lower.match(/_(armv7hf|aarch64|armv6|mips|x86_64|amd64)[._-]/)?.[1];
    if (arch && input.architecture) {
        if (arch !== input.architecture.toLowerCase()) {
            findings.push({
                blocking: true,
                message: `The filename suggests a ${arch} build, but this camera reports ${input.architecture}. ` +
                    'A mismatched architecture cannot install — the camera answers "package not compatible".',
            });
        }
    }
    else if (arch && !input.architecture) {
        findings.push({
            blocking: false,
            message: `The filename suggests a ${arch} build. This camera does not report its architecture, ` +
                'so the match cannot be checked here.',
        });
    }
    const gen = (0, firmware_1.acapGeneration)(input.firmware);
    if (input.supportedSdks && input.supportedSdks.length > 0) {
        // The camera has told us directly, which beats any firmware-to-SDK table.
        findings.push({ blocking: false, message: `This camera accepts: ${input.supportedSdks.join(', ')}.` });
    }
    else if (gen) {
        findings.push({
            blocking: false,
            message: `This camera runs firmware ${input.firmware.raw || 'unknown'}, which targets ${gen.label} ` +
                `(${gen.docs}). An .eap built for a newer ACAP generation will be refused.`,
        });
    }
    if (input.allowUnsigned === false) {
        findings.push({
            blocking: false,
            message: 'This camera does not accept unsigned ACAPs (AllowUnsigned=false, the default from ' +
                'AXIS OS 12.0). A signed package is fine; an unsigned one will fail verification.',
        });
    }
    else if (input.allowUnsigned !== true && (0, firmware_1.atLeast)(input.firmware, '12.0') === true) {
        findings.push({
            blocking: false,
            message: 'From AXIS OS 12.0 unsigned ACAPs are refused by default. If the upload fails signature ' +
                'verification, sign the .eap or allow unsigned packages on the camera.',
        });
    }
    return findings;
}
/** Guard for commands that need the ACAP API at all. */
function requireAcapSupport(embeddedDevelopmentVersion, firmware) {
    if (embeddedDevelopmentVersion !== null)
        return;
    throw new core_1.UnsupportedError('This device does not expose the ACAP application API — it reports no ' +
        'Properties.EmbeddedDevelopment.Version, which means it cannot run ACAPs.', {
        requires: 'a device with ACAP support',
        firmware,
        docs: 'https://developer.axis.com/acap/reference/axis-devices-and-compatibility/',
    });
}
