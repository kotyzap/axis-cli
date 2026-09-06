"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerParamCommands = registerParamCommands;
const session_1 = require("../session");
const output_1 = require("../output");
const util_1 = require("../util");
const params_1 = require("../vapix/params");
function registerParamCommands(program) {
    const param = program.command('param').description('Read/write Axis VAPIX parameters (param.cgi)');
    param
        .command('get <name> <params...>')
        .description('Get parameters or whole groups, e.g. "axis param get cam1 Brand.ProdFullName Properties.PTZ"')
        .action((0, output_1.action)(async (name, params) => {
        const cam = (0, session_1.openCamera)(name);
        // Keys are returned exactly as the camera reports them, including the
        // "root." prefix. The previous implementation went through
        // camstreamerlib, which strips that prefix — so asking for
        // "root.Brand.Brand" produced a result keyed "Brand.Brand" and looking
        // it up by the name you asked for silently yielded nothing.
        const result = await (0, params_1.listParams)(cam.core, params);
        if (result.size === 0) {
            (0, output_1.warn)(`The camera returned no values for ${params.map((p) => `"${p}"`).join(', ')}. ` +
                'Parameter names are case-sensitive per group; try the parent group ' +
                `(e.g. "axis param get ${name} ${(0, params_1.stripRoot)(params[0]).split('.')[0]}") to see what exists.`);
        }
        (0, output_1.printJson)(result.raw);
    }));
    param
        .command('set <name> <assignments...>')
        .description('Set one or more parameters as key=value pairs, e.g. "axis param set cam1 Time.DST.Enabled=yes"')
        .action((0, output_1.action)(async (name, assignments) => {
        const cam = (0, session_1.openCamera)(name);
        const params = (0, util_1.parseKeyValue)(assignments, 'assignment');
        // Sent as a POST form body rather than in the query string, so values
        // do not land in the camera's access log.
        await (0, params_1.updateParams)(cam.core, params);
        (0, output_1.ok)(`Set ${Object.keys(params).length} parameter(s) on "${name}"`);
    }));
}
