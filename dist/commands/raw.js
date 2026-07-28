"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRawCommands = registerRawCommands;
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function parseParams(pairs) {
    const out = {};
    for (const kv of pairs) {
        const idx = kv.indexOf('=');
        if (idx === -1)
            throw new Error(`Invalid param "${kv}", expected key=value`);
        out[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
    return out;
}
function registerRawCommands(program) {
    program
        .command('reboot <name>')
        .description('Reboot the camera (axis-cgi/restart.cgi)')
        .option('-y, --yes', 'Skip confirmation')
        .action((0, output_1.action)(async (name, opts) => {
        if (!opts.yes) {
            (0, output_1.warn)(`This will reboot "${name}" now. Re-run with --yes to confirm.`);
            return;
        }
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        await vapix.postUrlEncoded('/axis-cgi/restart.cgi', {});
        (0, output_1.ok)(`Reboot triggered on "${name}"`);
    }));
    const vapixCmd = program.command('vapix').description('Raw VAPIX escape hatch for endpoints not otherwise wrapped');
    vapixCmd
        .command('get <name> <path> [params...]')
        .description('Raw GET, e.g. "axis vapix get cam1 /axis-cgi/param.cgi action=list group=Image"')
        .action((0, output_1.action)(async (name, path, params) => {
        const cam = (0, config_1.getCamera)(name);
        const client = (0, client_1.buildClient)(cam);
        const res = await client.get({ path, parameters: parseParams(params) });
        console.log(await res.text());
    }));
    vapixCmd
        .command('post <name> <path> [params...]')
        .description('Raw POST (url-encoded body), e.g. "axis vapix post cam1 /axis-cgi/restart.cgi"')
        .action((0, output_1.action)(async (name, path, params) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        const res = await vapix.postUrlEncoded(path, parseParams(params));
        console.log(await res.text());
    }));
}
