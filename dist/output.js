"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setJsonMode = setJsonMode;
exports.isJsonMode = isJsonMode;
exports.ok = ok;
exports.info = info;
exports.warn = warn;
exports.fail = fail;
exports.printJson = printJson;
exports.printTable = printTable;
exports.describeError = describeError;
exports.action = action;
const chalk_1 = __importDefault(require("chalk"));
const cli_table3_1 = __importDefault(require("cli-table3"));
let jsonMode = false;
/** Set from the root command's preAction hook when --json is passed. */
function setJsonMode(enabled) {
    jsonMode = enabled;
}
function isJsonMode() {
    return jsonMode;
}
function ok(msg) {
    if (jsonMode)
        return;
    console.log(chalk_1.default.green('✓'), msg);
}
function info(msg) {
    if (jsonMode)
        return;
    console.log(chalk_1.default.cyan('ℹ'), msg);
}
function warn(msg) {
    if (jsonMode)
        return;
    console.log(chalk_1.default.yellow('⚠'), msg);
}
function fail(msg) {
    if (jsonMode) {
        console.error(JSON.stringify({ error: msg }, null, 2));
        return;
    }
    console.error(chalk_1.default.red('✗'), msg);
}
function printJson(data) {
    console.log(JSON.stringify(data, null, 2));
}
/**
 * Render rows as a table, or as JSON when --json is active, so every
 * listing command is scriptable regardless of its default presentation.
 */
function printTable(head, rows, jsonRows) {
    if (jsonMode) {
        printJson(jsonRows ?? rows.map((r) => Object.fromEntries(r.map((v, i) => [head[i], v]))));
        return;
    }
    const table = new cli_table3_1.default({ head });
    for (const r of rows)
        table.push(r.map((v) => String(v)));
    console.log(table.toString());
}
/**
 * camstreamerlib validates responses with zod, whose errors stringify to a wall
 * of JSON. Condense them to "field: problem" instead.
 */
function describeZodError(err) {
    let issues = err.issues ?? null;
    if (!issues && err.message.trim().startsWith('[')) {
        try {
            const parsed = JSON.parse(err.message);
            if (Array.isArray(parsed))
                issues = parsed;
        }
        catch {
            return null;
        }
    }
    if (!issues || issues.length === 0)
        return null;
    const parts = issues.map((i) => {
        const field = (i.path ?? []).join('.') || 'response';
        // "nan" here almost always means the camera doesn't report that axis at all.
        if (i.received === 'nan')
            return `${field} is not reported by this camera`;
        return `${field}: ${i.message ?? 'invalid value'}`;
    });
    return `unexpected response from the camera — ${parts.join('; ')}`;
}
/**
 * An UnsupportedError already knows why it happened; the job here is to present
 * the requirement, the device's actual firmware, and the way forward together,
 * so nobody has to go and read AXIS OS release notes to interpret it.
 */
function describeUnsupported(err) {
    if (err.name !== 'UnsupportedError')
        return null;
    const detail = err.detail;
    const lines = [err.message];
    if (detail?.requires)
        lines.push(`  Requires:    ${detail.requires}`);
    if (detail?.firmware?.raw)
        lines.push(`  This camera: firmware ${detail.firmware.raw}`);
    if (detail?.alternative)
        lines.push(`  Try instead: ${detail.alternative}`);
    if (detail?.docs)
        lines.push(`  Reference:   ${detail.docs}`);
    return lines.join('\n');
}
function describeError(err) {
    const unsupported = describeUnsupported(err);
    if (unsupported)
        return unsupported;
    const zod = describeZodError(err);
    if (zod)
        return zod;
    // camstreamerlib aborts requests with AbortSignal.timeout(), which rejects
    // with a DOMException named "TimeoutError" and no .cause — so without this
    // check it falls straight through to the raw "The operation was aborted due
    // to timeout", with no indication of what to do about it.
    if (err.name === 'TimeoutError' || /aborted due to timeout/i.test(err.message)) {
        return (`${err.message} — the camera didn't respond in time. ` +
            'If this command takes --timeout, try a larger value (e.g. --timeout 30000). ' +
            "Stopping a stream that's actively publishing can take longer than starting " +
            'one, since the camera has to close its connection to the destination first.');
    }
    const cause = err.cause;
    if (!cause)
        return err.message;
    const hint = {
        ECONNREFUSED: 'connection refused — check the IP, port, and whether --tls matches the camera',
        ETIMEDOUT: 'timed out — camera unreachable from this network',
        EHOSTUNREACH: 'host unreachable — check the IP and your routing',
        ENOTFOUND: 'hostname not found — check the IP or DNS name',
        ECONNRESET: 'connection reset — this often means HTTP was used against an HTTPS port (or vice versa)',
        DEPTH_ZERO_SELF_SIGNED_CERT: 'the camera uses a self-signed certificate — re-add the profile with --tls-insecure, or run "axis camera update <name> --tls-insecure"',
        SELF_SIGNED_CERT_IN_CHAIN: 'the camera uses a self-signed certificate — re-add the profile with --tls-insecure, or run "axis camera update <name> --tls-insecure"',
        CERT_HAS_EXPIRED: 'the camera certificate has expired',
    };
    const detail = hint[cause.code ?? ''] ?? cause.message ?? String(cause);
    return `${err.message}: ${detail}`;
}
/** Wraps an async command handler so rejected promises print a clean error instead of a raw stack trace. */
function action(fn) {
    return async (...args) => {
        try {
            await fn(...args);
        }
        catch (err) {
            fail(describeError(err));
            process.exitCode = 1;
        }
    };
}
