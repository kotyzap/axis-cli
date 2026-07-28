"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerParamCommands = registerParamCommands;
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function registerParamCommands(program) {
    const param = program.command('param').description('Read/write Axis VAPIX parameters (param.cgi)');
    param
        .command('get <name> <params...>')
        .description('Get one or more parameters, e.g. "axis param get cam1 root.Brand.ProdFullName root.Network.eth0.IPAddress"')
        .action((0, output_1.action)(async (name, params) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        const result = await vapix.getParameter(params);
        (0, output_1.printJson)(result);
    }));
    param
        .command('set <name> <assignments...>')
        .description('Set one or more parameters as key=value pairs, e.g. "axis param set cam1 root.Time.DST=yes"')
        .action((0, output_1.action)(async (name, assignments) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        const params = {};
        for (const kv of assignments) {
            const idx = kv.indexOf('=');
            if (idx === -1)
                throw new Error(`Invalid assignment "${kv}", expected key=value`);
            params[kv.slice(0, idx)] = kv.slice(idx + 1);
        }
        await vapix.setParameter(params);
        (0, output_1.ok)(`Set ${Object.keys(params).length} parameter(s) on "${name}"`);
    }));
}
