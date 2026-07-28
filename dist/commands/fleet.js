"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFleetCommands = registerFleetCommands;
const cli_table3_1 = __importDefault(require("cli-table3"));
const chalk_1 = __importDefault(require("chalk"));
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
const HEALTH_PARAMS = ['root.Brand.ProdShortName', 'root.Properties.Firmware.Version'];
function registerFleetCommands(program) {
    const fleet = program.command('fleet').description('Check status across all saved camera profiles');
    fleet
        .command('health')
        .description('Ping every saved camera and report reachability, firmware, SD card, and ACAP status')
        .action((0, output_1.action)(async () => {
        const cams = (0, config_1.listCameras)();
        if (cams.length === 0) {
            (0, output_1.info)('No camera profiles saved yet. Add one with: axis camera add <name> --ip <ip> --pass <pass>');
            return;
        }
        const table = new cli_table3_1.default({
            head: ['Camera', 'Status', 'Product', 'Firmware', 'SD Card', 'ACAPs running'],
        });
        for (const cam of cams) {
            try {
                const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
                const params = await vapix.getParameter(HEALTH_PARAMS);
                let sdStatus = '-';
                try {
                    const sd = await vapix.checkSDCard();
                    sdStatus = sd.status;
                }
                catch {
                    sdStatus = 'n/a';
                }
                let runningCount = '-';
                try {
                    const apps = await vapix.getApplicationList();
                    const running = apps.filter((a) => a.appId && a.Status === 'Running');
                    runningCount = `${running.length}/${apps.filter((a) => a.appId).length}`;
                }
                catch {
                    runningCount = 'n/a';
                }
                table.push([
                    cam.name,
                    chalk_1.default.green('reachable'),
                    params['root.Brand.ProdShortName'] ?? '-',
                    params['root.Properties.Firmware.Version'] ?? '-',
                    sdStatus,
                    runningCount,
                ]);
            }
            catch (err) {
                table.push([cam.name, chalk_1.default.red('unreachable'), '-', '-', '-', err.message.slice(0, 40)]);
            }
        }
        console.log(table.toString());
    }));
}
