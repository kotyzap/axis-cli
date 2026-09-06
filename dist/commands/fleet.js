"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFleetCommands = registerFleetCommands;
const chalk_1 = __importDefault(require("chalk"));
const config_1 = require("../config");
const session_1 = require("../session");
const output_1 = require("../output");
const util_1 = require("../util");
const output_2 = require("../output");
const storage_1 = require("../vapix/storage");
async function checkCamera(profile, timeout) {
    const options = { timeout };
    const cam = new session_1.CameraSession(profile);
    try {
        // One capability probe covers product, firmware, storage support and ACAP
        // support, so a mixed-firmware fleet needs no per-generation branching here.
        const caps = await cam.caps(options);
        const storage = await (0, storage_1.listDisks)(cam.core, caps.params, options);
        let running = 'n/a';
        if (caps.acap.canList) {
            try {
                const apps = await cam.apps(options);
                const family = apps.filter((a) => a.familyId);
                running = `${family.filter((a) => (a.status ?? '').toLowerCase() === 'running').length}/${family.length}`;
            }
            catch {
                // Almost always insufficient privilege: listing ACAPs needs
                // Administrator, while everything else in this row needs only Viewer.
                running = 'no access';
            }
        }
        else if (caps.acap.embeddedDevelopmentVersion === null) {
            running = 'no ACAP';
        }
        // Surface the firmware facts that change how the rest of the CLI behaves,
        // so a fleet table is enough to spot the odd camera out.
        const notes = [];
        if (!caps.events.websocket)
            notes.push('no WS events');
        if (!caps.storage.supported)
            notes.push('no storage');
        return {
            camera: profile.name,
            reachable: true,
            product: caps.device.productShortName ?? caps.device.productFullName ?? null,
            firmware: caps.device.firmwareVersion ?? null,
            osTrack: caps.osTrack,
            sdCard: (0, storage_1.describeSdCard)(storage),
            camStreamerAcapsRunning: running,
            note: notes.length > 0 ? notes.join(', ') : undefined,
        };
    }
    catch (err) {
        return {
            camera: profile.name,
            reachable: false,
            product: null,
            firmware: null,
            osTrack: null,
            sdCard: '-',
            camStreamerAcapsRunning: '-',
            error: (0, output_2.describeError)(err),
        };
    }
}
function registerFleetCommands(program) {
    const fleet = program.command('fleet').description('Check status across all saved camera profiles');
    fleet
        .command('health')
        .description('Ping every saved camera and report firmware, SD card, and CamStreamer ACAP status')
        .option('-t, --timeout <ms>', 'Per-request timeout in milliseconds', '5000')
        .option('-j, --concurrency <n>', 'How many cameras to probe in parallel', '8')
        .action((0, output_1.action)(async (opts) => {
        const cams = (0, config_1.listCameras)();
        if (cams.length === 0) {
            (0, output_1.info)('No camera profiles saved yet. Add one with: axis camera add <name> --ip <ip>');
            return;
        }
        const timeout = (0, util_1.parseIntOrThrow)(opts.timeout, 'timeout', { min: 100 });
        const concurrency = (0, util_1.parseIntOrThrow)(opts.concurrency, 'concurrency', { min: 1, max: 64 });
        // Batched rather than sequential: a single unreachable camera used to
        // stall the whole table for the full TCP timeout.
        const rows = [];
        for (let i = 0; i < cams.length; i += concurrency) {
            const batch = cams.slice(i, i + concurrency);
            rows.push(...(await Promise.all(batch.map((c) => checkCamera(c, timeout)))));
        }
        (0, output_1.printTable)(['Camera', 'Status', 'Product', 'Firmware', 'SD Card', 'CamStreamer ACAPs', 'Notes'], rows.map((r) => [
            r.camera,
            r.reachable ? chalk_1.default.green('reachable') : chalk_1.default.red('unreachable'),
            r.product ?? '-',
            r.firmware ?? '-',
            r.sdCard,
            r.camStreamerAcapsRunning,
            r.note ?? (r.error ?? '-').split('\n')[0].slice(0, 48),
        ]), rows);
        if (!(0, output_1.isJsonMode)()) {
            // A mixed-firmware fleet is the normal case, and the generation gap
            // is what explains most "works here, not there" reports.
            const tracks = new Set(rows.filter((r) => r.osTrack).map((r) => r.osTrack));
            if (tracks.size > 1) {
                (0, output_1.info)(`Fleet spans ${tracks.size} AXIS OS generations: ${[...tracks].sort().join(', ')}.`);
                (0, output_1.info)('Run "axis caps <name>" on any camera to see exactly what it supports.');
            }
        }
        // Outside the isJsonMode guard: this command's whole purpose is to be a
        // monitoring check, and --json is the mode a script would use. Setting
        // the exit code only in human mode meant scripts always saw success.
        if (rows.some((r) => !r.reachable)) {
            process.exitCode = 1;
        }
    }));
}
