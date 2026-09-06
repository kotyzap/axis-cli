import { Command } from 'commander';
import { addCamera, listCameras, removeCamera, getCamera, updateCamera, configPath } from '../config';
import { openCamera } from '../session';
import { compatibilityNotes } from '../capabilities';
import { ok, info, action, printTable } from '../output';
import { parseIntOrThrow, resolveSecret } from '../util';

/** Fixes B1: HTTPS defaults to 443, not 80. */
function defaultPort(tls: boolean): number {
    return tls ? 443 : 80;
}

export function registerCameraCommands(program: Command) {
    const camera = program.command('camera').description('Manage saved camera profiles');

    camera
        .command('add <name>')
        .description('Save a new camera profile (local IP or CamStreamer Cloud)')
        .option('--ip <ip>', 'Camera IP or hostname (local access)')
        .option('--port <port>', 'HTTP(S) port (default: 80, or 443 with --tls)')
        .option('--user <user>', 'Camera username', 'root')
        .option('--pass <pass>', 'Camera password (omit to be prompted; or set AXIS_PASS)')
        .option('--tls', 'Use HTTPS/WSS', false)
        .option('--tls-insecure', 'Accept a self-signed certificate (most Axis cameras ship with one)', false)
        .option('--cloud-url <url>', 'CamStreamer Cloud device-connect.net URL (instead of --ip)')
        .option('--cloud-token <token>', 'CamStreamer Cloud DEVICE_ACCESS_TOKEN (or set AXIS_CLOUD_TOKEN)')
        .action(
            action(async (name: string, opts) => {
                // Report every problem at once instead of one round-trip per flag.
                const problems: string[] = [];
                if (!opts.cloudUrl && !opts.ip) {
                    problems.push('Provide either --ip <ip> (local camera) or --cloud-url <url> (CamStreamer Cloud).');
                }
                if (opts.cloudUrl && opts.ip) {
                    problems.push('Provide only one of --ip or --cloud-url, not both.');
                }
                if (problems.length) {
                    throw new Error(
                        problems.join('\n  ') + `\n\n  Example: axis camera add ${name} --ip 192.168.1.156 --user root`
                    );
                }

                const isCloud = !!opts.cloudUrl;
                const secret = isCloud
                    ? await resolveSecret(opts.cloudToken, 'AXIS_CLOUD_TOKEN', `DEVICE_ACCESS_TOKEN for "${name}": `)
                    : await resolveSecret(opts.pass, 'AXIS_PASS', `Password for ${opts.user}@${opts.ip}: `);

                if (!secret) {
                    throw new Error(
                        isCloud
                            ? 'No cloud token given. Pass --cloud-token, set AXIS_CLOUD_TOKEN, or run in a terminal to be prompted.'
                            : 'No password given. Pass --pass, set AXIS_PASS, or run in a terminal to be prompted.'
                    );
                }

                const tls = !!opts.tls;
                const port =
                    opts.port !== undefined
                        ? parseIntOrThrow(opts.port, 'port', { min: 1, max: 65535 })
                        : defaultPort(tls);

                addCamera({
                    name,
                    ip: opts.ip ?? '',
                    port,
                    user: opts.user,
                    pass: isCloud ? '' : secret,
                    tls,
                    tlsInsecure: !!opts.tlsInsecure,
                    cloudUrl: opts.cloudUrl,
                    cloudToken: isCloud ? secret : undefined,
                });
                ok(`Saved camera profile "${name}" to ${configPath()}`);
                info(`Verify it with: axis camera test ${name}`);
            })
        );

    camera
        .command('update <name>')
        .description('Change fields on an existing camera profile')
        .option('--ip <ip>', 'Camera IP or hostname')
        .option('--port <port>', 'HTTP(S) port')
        .option('--user <user>', 'Camera username')
        .option('--pass [pass]', 'Camera password (bare --pass prompts; or set AXIS_PASS)')
        .option('--tls', 'Use HTTPS/WSS')
        .option('--no-tls', 'Use plain HTTP')
        .option('--tls-insecure', 'Accept a self-signed certificate')
        .option('--no-tls-insecure', 'Require a trusted certificate')
        .option('--cloud-url <url>', 'CamStreamer Cloud device-connect.net URL')
        .option('--cloud-token [token]', 'CamStreamer Cloud DEVICE_ACCESS_TOKEN (bare flag prompts)')
        .action(
            action(async (name: string, opts) => {
                const existing = getCamera(name);
                const patch: Record<string, unknown> = {};

                if (opts.ip !== undefined) patch.ip = opts.ip;
                if (opts.user !== undefined) patch.user = opts.user;
                if (opts.cloudUrl !== undefined) patch.cloudUrl = opts.cloudUrl;
                if (opts.tls !== undefined) patch.tls = !!opts.tls;
                if (opts.tlsInsecure !== undefined) patch.tlsInsecure = !!opts.tlsInsecure;

                if (opts.port !== undefined) {
                    patch.port = parseIntOrThrow(opts.port, 'port', { min: 1, max: 65535 });
                } else if (opts.tls !== undefined && existing.port === defaultPort(!opts.tls)) {
                    // Toggling TLS while still on the old default port would silently
                    // break the profile the same way B1 did, so move the default with it.
                    patch.port = defaultPort(!!opts.tls);
                }

                if (opts.pass !== undefined) {
                    const pass =
                        opts.pass === true
                            ? await resolveSecret(undefined, 'AXIS_PASS', `New password for "${name}": `)
                            : opts.pass;
                    if (!pass) throw new Error('No password given.');
                    patch.pass = pass;
                }
                if (opts.cloudToken !== undefined) {
                    const token =
                        opts.cloudToken === true
                            ? await resolveSecret(undefined, 'AXIS_CLOUD_TOKEN', `New DEVICE_ACCESS_TOKEN for "${name}": `)
                            : opts.cloudToken;
                    if (!token) throw new Error('No cloud token given.');
                    patch.cloudToken = token;
                }

                if (Object.keys(patch).length === 0) {
                    throw new Error('Nothing to update. Pass at least one field, e.g. --pass or --ip <ip>.');
                }

                updateCamera(name, patch);
                ok(`Updated camera profile "${name}" (${Object.keys(patch).join(', ')})`);
            })
        );

    camera
        .command('test <name>')
        .description('Verify a saved profile can reach the camera, and report what that camera supports')
        .action(
            action(async (name: string) => {
                const cam = openCamera(name);
                const caps = await cam.caps();
                const product = caps.device.productShortName ?? caps.device.productFullName ?? 'unknown model';

                ok(
                    `"${name}" reachable — ${product} (firmware ${caps.device.firmwareVersion ?? 'unknown'}` +
                        `${caps.osTrack ? `, ${caps.osTrack}` : ''})`
                );

                // Surfaced at profile-setup time rather than waiting for the first
                // command to fail on a firmware that cannot do what was asked.
                for (const note of compatibilityNotes(caps)) info(note);
            })
        );

    camera
        .command('list')
        .alias('ls')
        .description('List saved camera profiles')
        .action(
            action(async () => {
                const cams = listCameras();
                if (cams.length === 0) {
                    info('No camera profiles yet. Add one with: axis camera add <name> --ip <ip>');
                    return;
                }
                printTable(
                    ['Name', 'Access', 'User', 'TLS'],
                    cams.map((c) => [
                        c.name,
                        c.cloudUrl ? `cloud: ${c.cloudUrl}` : `${c.ip}:${c.port}`,
                        c.cloudUrl ? '(token)' : c.user,
                        c.tls ? (c.tlsInsecure ? 'yes (insecure)' : 'yes') : 'no',
                    ]),
                    // Never emit secrets in --json output.
                    cams.map((c) => ({
                        name: c.name,
                        ip: c.ip || undefined,
                        port: c.cloudUrl ? undefined : c.port,
                        user: c.cloudUrl ? undefined : c.user,
                        tls: c.tls,
                        tlsInsecure: c.tls ? !!c.tlsInsecure : undefined,
                        cloudUrl: c.cloudUrl,
                    }))
                );
            })
        );

    camera
        .command('remove <name>')
        .alias('rm')
        .description('Remove a saved camera profile')
        .action(
            action(async (name: string) => {
                removeCamera(name);
                ok(`Removed camera profile "${name}"`);
            })
        );
}
