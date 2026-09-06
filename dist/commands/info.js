"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInfoCommand = registerInfoCommand;
const session_1 = require("../session");
const output_1 = require("../output");
const storage_1 = require("../vapix/storage");
const params_1 = require("../vapix/params");
function registerInfoCommand(program) {
    program
        .command('info <name>')
        .description('Show device info, firmware generation, and installed ACAPs')
        .option('--all-acaps', 'List every installed ACAP, not just the CamStreamer family', false)
        .action((0, output_1.action)(async (name, opts) => {
        const cam = (0, session_1.openCamera)(name);
        // Capability detection replaces the old fixed parameter list. That
        // list asked for root.Network.eth0.IPAddress among others, and
        // because param.cgi fails the *whole* request when one group is
        // unknown, a single parameter a given model does not publish used to
        // take the entire info command down with it.
        const caps = await cam.caps();
        const d = caps.device;
        let acaps = null;
        let acapError = null;
        if (caps.acap.canList) {
            try {
                const all = await cam.apps();
                // familyId is only set for the CamStreamer family, so the old
                // unconditional filter hid every other installed ACAP.
                const selected = opts.allAcaps ? all : all.filter((a) => a.familyId);
                acaps = selected.map((a) => ({
                    name: a.name,
                    niceName: a.niceName ?? a.name,
                    version: a.version ?? '-',
                    status: a.status ?? '-',
                    vendor: a.vendor ?? '-',
                }));
            }
            catch (err) {
                acapError = err.message;
            }
        }
        else {
            acapError =
                caps.acap.embeddedDevelopmentVersion === null
                    ? 'this device does not support ACAPs'
                    : `listing ACAPs needs Properties.EmbeddedDevelopment.Version 1.20 or later ` +
                        `(this device reports ${caps.acap.embeddedDevelopmentVersion})`;
        }
        const storage = await (0, storage_1.listDisks)(cam.core, caps.params);
        // Network parameters are fetched separately rather than folded into the
        // capability probe. param.cgi fails the *whole* request if any one group
        // is unknown, and not every device has an "eth0" — a modular or
        // cellular product may not — so bundling it would make capability
        // detection itself fail on those. tryListParams tolerates the miss.
        const network = await (0, params_1.tryListParams)(cam.core, ['Network.eth0']);
        const ip = network.get('Network.eth0.IPAddress') ?? caps.params.get('Network.eth0.IPAddress') ?? null;
        if ((0, output_1.isJsonMode)()) {
            (0, output_1.printJson)({
                camera: name,
                brand: d.brand,
                product: d.productFullName ?? d.productShortName,
                productNumber: d.productNumber,
                firmware: d.firmwareVersion,
                osTrack: caps.osTrack,
                acapGeneration: caps.acapGeneration?.label ?? null,
                supportedSdks: caps.acap.supportedSdks,
                architecture: d.architecture,
                soc: d.soc,
                serial: d.serialNumber,
                ip,
                sdCard: (0, storage_1.describeSdCard)(storage),
                infoSource: d.source,
                acaps,
                acapScope: opts.allAcaps ? 'all' : 'camstreamer-family',
                acapError,
            });
            return;
        }
        const line = (label, value) => console.log(`  ${label.padEnd(15)}${value ?? '-'}`);
        console.log(`Camera: ${name}`);
        line('Brand:', d.brand);
        line('Product:', d.productFullName ?? d.productShortName);
        line('Part number:', d.productNumber);
        line('Firmware:', d.firmwareVersion ? `${d.firmwareVersion}${caps.osTrack ? ` — ${caps.osTrack}` : ''}` : null);
        line('ACAP target:', caps.acap.supportedSdks?.join(', ') ?? caps.acapGeneration?.label);
        line('Architecture:', d.architecture);
        line('SoC:', d.soc);
        line('Serial:', d.serialNumber);
        line('IP (eth0):', ip);
        line('SD card:', (0, storage_1.describeSdCard)(storage));
        if (acaps === null) {
            (0, output_1.info)(`  (ACAP list unavailable — ${acapError})`);
            return;
        }
        const label = opts.allAcaps ? 'Installed ACAPs' : 'CamStreamer ACAPs';
        if (acaps.length === 0) {
            console.log(`  ${label}: none`);
            if (!opts.allAcaps)
                console.log('    (re-run with --all-acaps to list every installed ACAP)');
            return;
        }
        console.log(`  ${label}:`);
        for (const a of acaps) {
            console.log(`    - ${a.niceName} (${a.version}) — ${a.status}`);
        }
        if (!opts.allAcaps)
            console.log('    (re-run with --all-acaps to list every installed ACAP)');
    }));
}
