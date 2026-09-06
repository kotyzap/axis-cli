"use strict";
/**
 * param.cgi — the one VAPIX API present on every Axis device since firmware
 * 5.00, and therefore the foundation everything else falls back to.
 *
 * Reference: https://developer.axis.com/vapix/network-video/parameter-management/
 *
 * Three details the docs are explicit about and that are easy to get wrong:
 *
 *  - **Requests must not carry the `root.` prefix.** The docs state "when
 *    requesting a parameter root is not needed", and every published example
 *    uses `group=Properties`, never `group=root.Properties`. Some firmwares
 *    tolerate the prefix, others return "# Error:". We strip it on the way out.
 *  - **Responses do carry it.** The reply is `root.Network.Enabled=yes`. So the
 *    key you send and the key you get back differ, which is why lookups here go
 *    through a normalising accessor instead of plain property access.
 *  - **Errors arrive as HTTP 200 with a `# Error:` body.** camstreamerlib's
 *    parser skips those lines, so a rejected request yields an empty object that
 *    looks exactly like "the camera has no such parameter". We distinguish them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParamSet = void 0;
exports.stripRoot = stripRoot;
exports.parseParamLines = parseParamLines;
exports.listParams = listParams;
exports.tryListParams = tryListParams;
exports.updateParams = updateParams;
const core_1 = require("./core");
const PARAM_CGI = '/axis-cgi/param.cgi';
/** Strip a leading "root." — anchored, unlike a bare String.replace('root.', ''). */
function stripRoot(name) {
    return name.replace(/^root\./i, '');
}
/**
 * A parameter listing with case- and prefix-insensitive lookup.
 *
 * Axis is inconsistent about capitalisation across generations
 * ("Properties.System.SerialNumber" vs "Properties.System.Serialnumber" appear
 * in different firmware families), so matching is done on a normalised key.
 */
class ParamSet {
    constructor(raw) {
        this.raw = raw;
        this.normalised = new Map();
        for (const [k, v] of Object.entries(raw)) {
            this.normalised.set(stripRoot(k).toLowerCase(), v);
        }
    }
    get(name) {
        return this.normalised.get(stripRoot(name).toLowerCase());
    }
    /** Truthy Axis booleans: parameters use "yes"/"no", never true/false. */
    yes(name) {
        return (this.get(name) ?? '').trim().toLowerCase() === 'yes';
    }
    has(name) {
        return this.get(name) !== undefined;
    }
    /** Every key under a prefix, with the prefix kept, e.g. all of "Properties.PTZ.*". */
    under(prefix) {
        const want = stripRoot(prefix).toLowerCase();
        const out = {};
        for (const [k, v] of Object.entries(this.raw)) {
            const norm = stripRoot(k).toLowerCase();
            if (norm === want || norm.startsWith(want + '.'))
                out[stripRoot(k)] = v;
        }
        return out;
    }
    get size() {
        return this.normalised.size;
    }
}
exports.ParamSet = ParamSet;
function parseParamLines(body) {
    const out = {};
    for (const line of body.split(/\r?\n/)) {
        if (!line || line.startsWith('#'))
            continue;
        const idx = line.indexOf('=');
        if (idx === -1)
            continue;
        // Keys are kept verbatim (prefix included) so callers that echo them back
        // — `axis param get` — show what the camera actually reports.
        out[line.slice(0, idx).trim()] = line.slice(idx + 1);
    }
    return out;
}
/**
 * List parameter groups. Group names may be given with or without "root.".
 *
 * Note that a single invalid group makes the whole request fail, so callers that
 * are probing for optional parameters should ask for a broad group that always
 * exists ("Properties", "Brand") and read the leaves out of the result, rather
 * than requesting the leaves directly.
 */
async function listParams(core, groups, options = {}) {
    const parameters = { action: 'list' };
    if (groups !== undefined) {
        const list = (Array.isArray(groups) ? groups : [groups]).map(stripRoot).filter(Boolean);
        if (list.length > 0)
            parameters.group = list.join(',');
    }
    const body = await core.getText(PARAM_CGI, parameters, options);
    return new ParamSet(parseParamLines(body));
}
/**
 * Like listParams, but an error from the camera yields an empty set instead of
 * throwing. For capability probing, where "this group does not exist" is a
 * legitimate answer that should not abort the command.
 */
async function tryListParams(core, groups, options = {}) {
    try {
        return await listParams(core, groups, options);
    }
    catch (err) {
        if (err instanceof core_1.VapixError)
            return new ParamSet({});
        throw err;
    }
}
/**
 * Write parameters. Sent as a POST form body rather than in the query string so
 * secrets and long values do not end up in the camera's access log, and so we
 * are not bound by URL length limits.
 *
 * Assignments are sent without the "root." prefix, matching the documented form.
 */
async function updateParams(core, assignments, options = {}) {
    const fields = { action: 'update' };
    for (const [k, v] of Object.entries(assignments))
        fields[stripRoot(k)] = v;
    const body = await core.postForm(PARAM_CGI, fields, options);
    // Success is the literal "OK". Anything else that got past the error check in
    // postForm is unexpected enough to surface rather than silently accept.
    if (body.trim().toUpperCase() !== 'OK' && body.trim() !== '') {
        throw new core_1.VapixError(`param.cgi returned an unexpected reply: ${body.trim().slice(0, 200)}`, {
            path: PARAM_CGI,
            body,
        });
    }
}
