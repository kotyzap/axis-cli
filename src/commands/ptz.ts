import { Command } from 'commander';
import { openCamera } from '../session';
import { action, info, isJsonMode, ok, printJson, printTable } from '../output';
import { parseIntOrThrow } from '../util';
import { getAvailableCommands, getPosition, getPresets, goToPreset, requirePtz } from '../vapix/ptz';

export function registerPtzCommands(program: Command) {
    const ptz = program.command('ptz').description('PTZ presets, position, and supported commands');

    ptz
        .command('presets <name>')
        // Every other group uses "list"; keep it working here too.
        .alias('list')
        .option('-c, --channel <channel>', 'Video channel (com/ptz.cgi calls this "camera")', '1')
        .description('List PTZ presets')
        .action(
            action(async (name: string, opts) => {
                const cam = openCamera(name);
                const caps = await cam.caps();
                requirePtz(caps.ptz, caps.firmware, name);

                const channel = parseIntOrThrow(opts.channel, 'channel', { min: 1 });
                const presets = await getPresets(cam.core, channel);
                if (presets.length === 0) {
                    if (!isJsonMode()) {
                        info(`Camera "${name}" supports PTZ but has no presets saved on channel ${channel}.`);
                        return;
                    }
                    printJson([]);
                    return;
                }
                // A table, like every other listing command. This printed raw JSON
                // unconditionally, even in human mode.
                //
                // The number shown is the camera's own preset number, not the row
                // position. Preset numbers are not contiguous — deleting one leaves a
                // gap — so renumbering by row would display a number that does not
                // exist on the camera.
                printTable(
                    ['#', 'Preset'],
                    presets.map((p) => [String(p.number), p.name || '(unnamed)']),
                    presets
                );
            })
        );

    ptz
        .command('goto <name> <presetName>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('Move the camera to a named PTZ preset')
        .action(
            action(async (name: string, presetName: string, opts) => {
                const cam = openCamera(name);
                const caps = await cam.caps();
                requirePtz(caps.ptz, caps.firmware, name);

                const channel = parseIntOrThrow(opts.channel, 'channel', { min: 1 });
                await goToPreset(cam.core, channel, presetName);
                ok(`Camera "${name}" moving to preset "${presetName}"`);
            })
        );

    ptz
        .command('position <name>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('Show current PTZ position (whichever axes this camera reports)')
        .action(
            action(async (name: string, opts) => {
                const cam = openCamera(name);
                const caps = await cam.caps();
                requirePtz(caps.ptz, caps.firmware, name);

                const channel = parseIntOrThrow(opts.channel, 'channel', { min: 1 });
                const pos = await getPosition(cam.core, channel);

                if (isJsonMode()) {
                    printJson({ camera: name, channel, ...pos });
                    return;
                }

                // Every axis is optional by design. The docs are explicit that the
                // response "depends on what functions the Axis product supports", so a
                // digital-PTZ box camera reporting zoom but no pan or tilt is correct
                // behaviour — the old code fed this through a strict numeric schema and
                // reported "pan: expected number, received nan" instead.
                const axes: [string, number | boolean | null][] = [
                    ['pan', pos.pan],
                    ['tilt', pos.tilt],
                    ['zoom', pos.zoom],
                    ['focus', pos.focus],
                    ['iris', pos.iris],
                    ['autofocus', pos.autofocus],
                    ['autoiris', pos.autoiris],
                ];
                const reported = axes.filter(([, v]) => v !== null);

                if (reported.length === 0) {
                    info(
                        `Camera "${name}" reported no PTZ values on channel ${channel}. ` +
                            (caps.ptz.digital && !caps.ptz.mechanical
                                ? 'This camera has digital PTZ only, so there may be nothing to report until a view area is configured.'
                                : 'Try a different channel with --channel.')
                    );
                    return;
                }

                printTable(
                    ['Axis', 'Value'],
                    reported.map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v)]),
                    Object.fromEntries(reported)
                );
                const missing = axes.filter(([, v]) => v === null).map(([k]) => k);
                if (missing.length > 0) {
                    info(`Not reported by this camera: ${missing.join(', ')}`);
                }
            })
        );

    ptz
        .command('commands <name>')
        .description('List the PTZ commands this camera actually accepts (com/ptz.cgi?info=1)')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .action(
            action(async (name: string, opts) => {
                const cam = openCamera(name);
                const caps = await cam.caps();
                requirePtz(caps.ptz, caps.firmware, name);

                const channel = parseIntOrThrow(opts.channel, 'channel', { min: 1 });
                const commands = await getAvailableCommands(cam.core, channel);
                printTable(['Command'], commands.map((c) => [c]), commands);
                if (!isJsonMode()) {
                    info(
                        'PTZ support is not all-or-nothing — a camera may accept zoom but reject move. ' +
                            'These are the commands this channel advertises.'
                    );
                }
            })
        );
}
