"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInfoCommand = registerInfoCommand;
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
const INFO_PARAMS = [
    'root.Brand.Brand',
    'root.Brand.ProdFullName',
    'root.Brand.ProdShortName',
    'root.Properties.Firmware.Version',
    'root.Properties.System.SerialNumber',
    'root.Network.eth0.IPAddress',
];
function registerInfoCommand(program) {
    program
        .command('info <name>')
        .description('Show basic device info for a camera')
        .action((0, output_1.action)(async (name) => {
        const cam = (0, config_1.getCamera)(name);
        const client = (0, client_1.buildClient)(cam);
        const vapix = new camstreamerlib_1.VapixAPI(client);
        const params = await vapix.getParameter(INFO_PARAMS);
        console.log(`Camera: ${name}`);
        console.log(`  Brand:        ${params['root.Brand.Brand'] ?? '-'}`);
        console.log(`  Product:      ${params['root.Brand.ProdFullName'] ?? params['root.Brand.ProdShortName'] ?? '-'}`);
        console.log(`  Firmware:     ${params['root.Properties.Firmware.Version'] ?? '-'}`);
        console.log(`  Serial:       ${params['root.Properties.System.SerialNumber'] ?? '-'}`);
        console.log(`  IP (eth0):    ${params['root.Network.eth0.IPAddress'] ?? '-'}`);
        try {
            const apps = await vapix.getApplicationList();
            const relevant = apps.filter((a) => a.appId);
            if (relevant.length) {
                console.log('  Installed ACAPs:');
                for (const a of relevant) {
                    console.log(`    - ${a.Name} (${a.Version}) — ${a.Status}`);
                }
            }
        }
        catch {
            (0, output_1.info)('  (Could not read ACAP application list — insufficient permissions or unsupported firmware.)');
        }
    }));
}
