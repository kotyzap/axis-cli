import { Command } from 'commander';
import { VapixAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, ok, printJson } from '../output';

export function registerPtzCommands(program: Command) {
    const ptz = program.command('ptz').description('PTZ presets and position');

    ptz
        .command('presets <name>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('List PTZ presets')
        .action(
            action(async (name: string, opts) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                const presets = await vapix.getPTZPresetList(parseInt(opts.channel, 10));
                printJson(presets);
            })
        );

    ptz
        .command('goto <name> <presetName>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('Move the camera to a named PTZ preset')
        .action(
            action(async (name: string, presetName: string, opts) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                await vapix.goToPreset(parseInt(opts.channel, 10), presetName);
                ok(`Camera "${name}" moving to preset "${presetName}"`);
            })
        );

    ptz
        .command('position <name>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('Show current PTZ position (pan/tilt/zoom)')
        .action(
            action(async (name: string, opts) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                const pos = await vapix.getPtzPosition(parseInt(opts.channel, 10));
                printJson(pos);
            })
        );
}
