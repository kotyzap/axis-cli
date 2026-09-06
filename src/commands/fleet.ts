import { Command } from 'commander';
import chalk from 'chalk';
import { listCameras, CameraProfile } from '../config';
import { CameraSession } from '../session';
import { action, info, isJsonMode, printTable } from '../output';
import { parseIntOrThrow } from '../util';
import { describeError } from '../output';
import { describeSdCard, listDisks } from '../vapix/storage';

type HealthRow = {
    camera: string;
    reachable: boolean;
    product: string | null;
    firmware: string | null;
    osTrack: string | null;
    sdCard: string;
    /** "2/3" over the CamStreamer family, or "n/a" when unreadable. */
    camStreamerAcapsRunning: string;
    /** Set when the device is reachable but something interesting is true of it. */
    note?: string;
    error?: string;
};

async function checkCamera(profile: CameraProfile, timeout: number): Promise<HealthRow> {
    const options = { timeout };
    const cam = new CameraSession(profile);
    try {
        // One capability probe covers product, firmware, storage support and ACAP
        // support, so a mixed-firmware fleet needs no per-generation branching here.
        const caps = await cam.caps(options);

        const storage = await listDisks(cam.core, caps.params, options);

        let running = 'n/a';
        if (caps.acap.canList) {
            try {
                const apps = await cam.apps(options);
                const family = apps.filter((a) => a.familyId);
                running = `${family.filter((a) => (a.status ?? '').toLowerCase() === 'running').length}/${family.length}`;
            } catch {
                // Almost always insufficient privilege: listing ACAPs needs
                // Administrator, while everything else in this row needs only Viewer.
                running = 'no access';
            }
        } else if (caps.acap.embeddedDevelopmentVersion === null) {
            running = 'no ACAP';
        }

        // Surface the firmware facts that change how the rest of the CLI behaves,
        // so a fleet table is enough to spot the odd camera out.
        const notes: string[] = [];
        if (!caps.events.websocket) notes.push('no WS events');
        if (!caps.storage.supported) notes.push('no storage');

        return {
            camera: profile.name,
            reachable: true,
            product: caps.device.productShortName ?? caps.device.productFullName ?? null,
            firmware: caps.device.firmwareVersion ?? null,
            osTrack: caps.osTrack,
            sdCard: describeSdCard(storage),
            camStreamerAcapsRunning: running,
            note: notes.length > 0 ? notes.join(', ') : undefined,
        };
    } catch (err) {
        return {
            camera: profile.name,
            reachable: false,
            product: null,
            firmware: null,
            osTrack: null,
            sdCard: '-',
            camStreamerAcapsRunning: '-',
            error: describeError(err as Error),
        };
    }
}

export function registerFleetCommands(program: Command) {
    const fleet = program.command('fleet').description('Check status across all saved camera profiles');

    fleet
        .command('health')
        .description('Ping every saved camera and report firmware, SD card, and CamStreamer ACAP status')
        .option('-t, --timeout <ms>', 'Per-request timeout in milliseconds', '5000')
        .option('-j, --concurrency <n>', 'How many cameras to probe in parallel', '8')
        .action(
            action(async (opts) => {
                const cams = listCameras();
                if (cams.length === 0) {
                    info('No camera profiles saved yet. Add one with: axis camera add <name> --ip <ip>');
                    return;
                }

                const timeout = parseIntOrThrow(opts.timeout, 'timeout', { min: 100 });
                const concurrency = parseIntOrThrow(opts.concurrency, 'concurrency', { min: 1, max: 64 });

                // Batched rather than sequential: a single unreachable camera used to
                // stall the whole table for the full TCP timeout.
                const rows: HealthRow[] = [];
                for (let i = 0; i < cams.length; i += concurrency) {
                    const batch = cams.slice(i, i + concurrency);
                    rows.push(...(await Promise.all(batch.map((c) => checkCamera(c, timeout)))));
                }

                printTable(
                    ['Camera', 'Status', 'Product', 'Firmware', 'SD Card', 'CamStreamer ACAPs', 'Notes'],
                    rows.map((r) => [
                        r.camera,
                        r.reachable ? chalk.green('reachable') : chalk.red('unreachable'),
                        r.product ?? '-',
                        r.firmware ?? '-',
                        r.sdCard,
                        r.camStreamerAcapsRunning,
                        r.note ?? (r.error ?? '-').split('\n')[0].slice(0, 48),
                    ]),
                    rows
                );

                if (!isJsonMode()) {
                    // A mixed-firmware fleet is the normal case, and the generation gap
                    // is what explains most "works here, not there" reports.
                    const tracks = new Set(rows.filter((r) => r.osTrack).map((r) => r.osTrack as string));
                    if (tracks.size > 1) {
                        info(`Fleet spans ${tracks.size} AXIS OS generations: ${[...tracks].sort().join(', ')}.`);
                        info('Run "axis caps <name>" on any camera to see exactly what it supports.');
                    }
                }

                // Outside the isJsonMode guard: this command's whole purpose is to be a
                // monitoring check, and --json is the mode a script would use. Setting
                // the exit code only in human mode meant scripts always saw success.
                if (rows.some((r) => !r.reachable)) {
                    process.exitCode = 1;
                }
            })
        );
}
