"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPtzCommands = registerPtzCommands;
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function registerPtzCommands(program) {
    const ptz = program.command('ptz').description('PTZ presets and position');
    ptz
        .command('presets <name>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('List PTZ presets')
        .action((0, output_1.action)(async (name, opts) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        const presets = await vapix.getPTZPresetList(parseInt(opts.channel, 10));
        (0, output_1.printJson)(presets);
    }));
    ptz
        .command('goto <name> <presetName>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('Move the camera to a named PTZ preset')
        .action((0, output_1.action)(async (name, presetName, opts) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        await vapix.goToPreset(parseInt(opts.channel, 10), presetName);
        (0, output_1.ok)(`Camera "${name}" moving to preset "${presetName}"`);
    }));
    ptz
        .command('position <name>')
        .option('-c, --channel <channel>', 'Video channel', '1')
        .description('Show current PTZ position (pan/tilt/zoom)')
        .action((0, output_1.action)(async (name, opts) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        const pos = await vapix.getPtzPosition(parseInt(opts.channel, 10));
        (0, output_1.printJson)(pos);
    }));
}
