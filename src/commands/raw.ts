import { Command } from 'commander';
import { openCamera } from '../session';
import { action, warn } from '../output';
import { parseIntOrThrow, parseKeyValue } from '../util';
import { findTextError } from '../vapix/core';

/**
 * The escape hatch. Deliberately does *not* go through the hardened helpers —
 * the point of this command is to show exactly what the camera said, so the
 * response body is printed verbatim whatever it contains.
 *
 * It does, however, warn when the body carries one of the in-band error forms,
 * because "HTTP 200 with an error in the body" is the single most confusing
 * thing about VAPIX and is very easy to miss when eyeballing raw output.
 */
export function registerRawCommands(program: Command) {
    const vapixCmd = program.command('vapix').description('Raw VAPIX escape hatch for endpoints not otherwise wrapped');

    const report = async (res: { status: number; text(): Promise<string> }) => {
        const body = await res.text();
        console.log(body);
        const err = findTextError(body);
        if (err) {
            warn(
                `The camera answered HTTP ${res.status} but the body reports an error: ${err.message}` +
                    (err.code !== undefined ? ` (code ${err.code})` : '')
            );
        }
    };

    vapixCmd
        .command('get <name> <path> [params...]')
        .description('Raw GET, e.g. "axis vapix get cam1 /axis-cgi/param.cgi action=list group=Image"')
        .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '10000')
        .action(
            action(async (name: string, path: string, params: string[], opts) => {
                const cam = openCamera(name);
                const res = await cam.core.transport.get({
                    path,
                    parameters: parseKeyValue(params),
                    timeout: parseIntOrThrow(opts.timeout, 'timeout', { min: 100 }),
                });
                await report(res);
            })
        );

    vapixCmd
        .command('post <name> <path> [params...]')
        .description('Raw POST (url-encoded body), e.g. "axis vapix post cam1 /axis-cgi/restart.cgi"')
        .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '10000')
        // Deliberately not "--json": that is the global output-mode flag, which
        // index.ts strips from argv before commander sees it. A local --json here
        // would have its value silently reinterpreted as a positional argument.
        .option('--json-body <json>', 'Send this raw JSON as the body instead of a url-encoded form')
        .action(
            action(async (name: string, path: string, params: string[], opts) => {
                const cam = openCamera(name);
                const timeout = parseIntOrThrow(opts.timeout, 'timeout', { min: 100 });

                if (opts.jsonBody) {
                    // Most modern VAPIX APIs (basicdeviceinfo, apidiscovery,
                    // firmwaremanagement, the /config/rest family) are JSON-only, and
                    // there was previously no way to reach them from here at all.
                    try {
                        JSON.parse(opts.jsonBody);
                    } catch (err) {
                        throw new Error(`--json-body is not valid JSON: ${(err as Error).message}`);
                    }
                    const res = await cam.core.transport.post({
                        path,
                        data: opts.jsonBody,
                        headers: { 'Content-Type': 'application/json' },
                        timeout,
                    });
                    await report(res);
                    return;
                }

                const form = new URLSearchParams(parseKeyValue(params)).toString();
                const res = await cam.core.transport.post({
                    path,
                    data: form,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout,
                });
                await report(res);
            })
        );
}
