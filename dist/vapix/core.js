"use strict";
/**
 * Low-level VAPIX transport.
 *
 * Everything above this file assumes two things that are *not* true of a plain
 * fetch against an Axis camera, and this is where they get made true:
 *
 *  1. **Almost every VAPIX CGI reports failure with HTTP 200.** `param.cgi`
 *     answers "# Error: ...", the application CGIs answer "Error: 4",
 *     `com/ptz.cgi` answers "Error:\n<message>", and the JSON APIs answer
 *     `{"error":{"code":1000,...}}` — all with a 200 status line. Code that
 *     checks `res.ok` therefore silently succeeds on failure. Every helper here
 *     inspects the body.
 *
 *  2. **The same CGI behaves differently across AXIS OS generations.** The
 *     documented method is sometimes POST-only on paper while GET has worked
 *     since firmware 5.x, and older devices can reject a POST with no body.
 *     `requestWithFallback` tries the documented verb first and retries with the
 *     other one instead of failing on a 400/405, so one code path serves an
 *     M1137 on 10.12 and a Q-line camera on 12.x.
 *
 * Reference: https://developer.axis.com/vapix/
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VapixCore = exports.UnsupportedError = exports.VapixError = exports.DEFAULT_TIMEOUT = void 0;
exports.findTextError = findTextError;
exports.findJsonError = findJsonError;
exports.explainJsonErrorCode = explainJsonErrorCode;
/** Default per-request timeout. Deliberately short: unreachable cameras are common in fleets. */
exports.DEFAULT_TIMEOUT = 10000;
class VapixError extends Error {
    constructor(message, detail) {
        super(message);
        this.detail = detail;
        this.name = 'VapixError';
    }
}
exports.VapixError = VapixError;
/**
 * A capability this camera's firmware does not have. Distinct from VapixError so
 * commands can report "your firmware is too old for this" rather than dressing
 * it up as a network or permission problem.
 */
class UnsupportedError extends Error {
    constructor(message, detail = {}) {
        super(message);
        this.detail = detail;
        this.name = 'UnsupportedError';
    }
}
exports.UnsupportedError = UnsupportedError;
/**
 * Turn an HTTP status into an explanation that names the likely cause. Axis
 * cameras are stingy with error bodies, so the status is often all we have.
 */
function explainStatus(status, path) {
    switch (status) {
        case 401:
            return (`authentication failed (HTTP 401) for ${path} — check the username and password.\n` +
                `  On AXIS OS 11.6 and later there is no default "root" user; a factory-default camera ` +
                `has no credentials at all until you create the first account in its web UI.`);
        case 403:
            return (`access denied (HTTP 403) for ${path} — the account authenticated but lacks the required ` +
                `privilege. Reading parameters needs Viewer, most writes need Operator, and anything ` +
                `touching ACAPs needs Administrator.`);
        case 404:
            return (`${path} does not exist on this camera (HTTP 404) — this firmware is likely older than ` +
                `the API, or the feature is not present on this model. Run "axis caps <name>" to see ` +
                `what this device actually supports.`);
        case 405:
            return `${path} rejected the HTTP method (HTTP 405).`;
        default:
            return `${path} returned HTTP ${status}.`;
    }
}
function assertHttpOk(res, path) {
    // 204 is the documented *success* response for com/ptz.cgi control commands.
    if (res.ok || res.status === 204)
        return;
    throw new VapixError(explainStatus(res.status, path), { path, status: res.status });
}
/**
 * Extract the error out of a text/plain VAPIX body, if there is one.
 *
 * Three documented shapes, all served with HTTP 200:
 *   param.cgi            "# Error: Error setting 'X' to 'Y'!"
 *   applications/*.cgi   "Error: 4"
 *   com/ptz.cgi          "Error:\nquery: unknown value: foo"
 */
function findTextError(body) {
    const trimmed = body.trim();
    const hashError = trimmed.match(/^#\s*Error:\s*(.*)$/im);
    if (hashError)
        return { message: hashError[1].trim() || 'unspecified parameter error' };
    const requestFailed = trimmed.match(/^#\s*Request failed:\s*(.*)$/im);
    if (requestFailed)
        return { message: requestFailed[1].trim() || 'request failed' };
    // Anchored to the start of a line so a *value* that happens to contain the
    // word "Error:" (an ACAP status string, a log excerpt) is not mistaken for
    // a failure. camstreamerlib matches /Error:([^<]*)/ anywhere, which makes
    // e.g. a systemlog body look like an API failure.
    const bare = trimmed.match(/^Error:[ \t]*(.*)$/im);
    if (!bare)
        return null;
    const rest = bare[1].trim();
    if (/^\d+$/.test(rest))
        return { code: parseInt(rest, 10), message: `error code ${rest}` };
    // "Error:" alone on its line: the message is on the next line (ptz.cgi).
    if (rest === '') {
        const after = trimmed.slice(bare.index + bare[0].length).trim();
        const firstLine = after.split(/[\r\n]/)[0]?.trim();
        return { message: firstLine || 'unspecified error' };
    }
    return { message: rest };
}
/**
 * A JSON-API error object, as used by basicdeviceinfo.cgi, apidiscovery.cgi and
 * the other JSON CGIs.
 *
 * Two published inconsistencies are handled here: the version key appears as
 * both `apiVersion` and `apiVersions` in Axis' own examples, and `error.code` is
 * documented as an integer in one place and a quoted string in another.
 */
function findJsonError(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const err = payload.error;
    if (typeof err !== 'object' || err === null)
        return null;
    const { code, message } = err;
    return {
        code: typeof code === 'number' || typeof code === 'string' ? code : undefined,
        message: typeof message === 'string' && message ? message : 'unspecified error',
    };
}
/**
 * Shared explanations for the general JSON error codes, which every JSON VAPIX
 * API reuses (basicdeviceinfo, apidiscovery, and friends).
 */
function explainJsonErrorCode(code) {
    switch (Number(code)) {
        case 1000:
            return 'invalid parameter value';
        case 2001:
            return 'access forbidden — the account lacks the required privilege';
        case 2002:
            return 'only POST is supported by this CGI';
        case 2003:
            return 'the requested API version is not supported by this firmware';
        case 2004:
            return 'this method is not supported by this firmware';
        case 4000:
            return 'invalid JSON in the request';
        case 4002:
            return 'a required parameter is missing or invalid';
        case 8000:
            return 'internal device error — check the camera system log';
        default:
            return null;
    }
}
class VapixCore {
    constructor(client) {
        this.client = client;
    }
    /** The underlying client, for the raw escape-hatch commands. */
    get transport() {
        return this.client;
    }
    /**
     * GET a text/plain CGI and fail on an in-body error.
     */
    async getText(path, parameters = {}, options = {}) {
        const res = await this.client.get({ path, parameters, timeout: options.timeout ?? exports.DEFAULT_TIMEOUT });
        assertHttpOk(res, path);
        const body = await res.text();
        this.throwOnTextError(body, path);
        return body;
    }
    /**
     * POST with the arguments in the query string and an empty body — the form
     * the application CGIs are documented with — retrying as a GET if the
     * device rejects it.
     *
     * The retry is not paranoia: the docs list `applications/*.cgi` as POST-only
     * with no body, but the shipped CGIs have always accepted GET, and some
     * firmware/reverse-proxy combinations answer 400 to a bodyless POST.
     */
    async callCgi(path, parameters = {}, options = {}) {
        const timeout = options.timeout ?? exports.DEFAULT_TIMEOUT;
        let res = await this.client.post({ path, data: '', parameters, timeout });
        if (res.status === 400 || res.status === 405 || res.status === 501) {
            res = await this.client.get({ path, parameters, timeout });
        }
        assertHttpOk(res, path);
        const body = await res.text();
        this.throwOnTextError(body, path);
        return body;
    }
    /** POST a urlencoded form body. Used for parameter writes, so values stay out of URLs and logs. */
    async postForm(path, fields, options = {}) {
        const body = new URLSearchParams();
        for (const [k, v] of Object.entries(fields))
            body.set(k, String(v));
        const res = await this.client.post({
            path,
            data: body.toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: options.timeout ?? exports.DEFAULT_TIMEOUT,
        });
        assertHttpOk(res, path);
        const text = await res.text();
        this.throwOnTextError(text, path);
        return text;
    }
    /**
     * POST a JSON body and return the parsed reply, or **null on any failure**.
     *
     * Every caller of this method has an older-firmware fallback, so the contract
     * is deliberately "tell me if this worked, don't tell me why not". That has to
     * include in-band JSON errors: a device answering 8000 (internal error) or
     * 4002 (bad parameter) is a device we cannot use this API on, and the only
     * useful response is to fall back to `param.cgi` — not to fail the command.
     *
     * Getting this wrong is worse than it sounds. `getDeviceInfo` is called during
     * capability detection, so a single grumpy `basicdeviceinfo.cgi` would take
     * down every command on a camera whose `param.cgi` works perfectly well.
     *
     * Use `postJson` when a failure genuinely is an error.
     */
    async postJsonOptional(path, payload, options = {}) {
        let res;
        try {
            res = await this.client.post({
                path,
                data: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
                timeout: options.timeout ?? exports.DEFAULT_TIMEOUT,
            });
        }
        catch {
            // Transport-level failure (reset, TLS, timeout). Let the caller fall back.
            return null;
        }
        // 401/403 here mean "we cannot use this API with these credentials", which
        // for a probe is the same as "unavailable" — the param.cgi fallback may
        // still work, since it has a lower privilege bar.
        if (!res.ok)
            return null;
        let parsed;
        try {
            parsed = JSON.parse(await res.text());
        }
        catch {
            return null;
        }
        // Any in-band error, not just 2003/2004: see the note above.
        if (findJsonError(parsed))
            return null;
        return parsed;
    }
    /** POST a JSON body, failing loudly. For endpoints we have already established exist. */
    async postJson(path, payload, options = {}) {
        const res = await this.client.post({
            path,
            data: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            timeout: options.timeout ?? exports.DEFAULT_TIMEOUT,
        });
        assertHttpOk(res, path);
        const text = await res.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new VapixError(`${path} returned a non-JSON response: ${text.slice(0, 200)}`, { path, body: text });
        }
        const err = findJsonError(parsed);
        if (err) {
            throw new VapixError(`${path}: ${explainJsonErrorCode(err.code) ?? err.message}`, {
                path,
                code: err.code,
                body: err.message,
            });
        }
        return parsed;
    }
    /** POST a multipart body. Used for .eap upload. */
    async postMultipart(path, form, options = {}) {
        const res = await this.client.post({
            path,
            data: form,
            // Content-Type is intentionally unset: fetch derives it from the
            // FormData and appends the boundary. Setting it by hand produces a
            // boundary-less header and the camera rejects the upload.
            timeout: options.timeout ?? exports.DEFAULT_TIMEOUT,
        });
        assertHttpOk(res, path);
        const body = await res.text();
        this.throwOnTextError(body, path);
        return body;
    }
    throwOnTextError(body, path) {
        const err = findTextError(body);
        if (!err)
            return;
        throw new VapixError(`${path}: ${err.message}`, { path, code: err.code, body: body.slice(0, 500) });
    }
}
exports.VapixCore = VapixCore;
