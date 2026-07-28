"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppsCommands = registerAppsCommands;
const cli_table3_1 = __importDefault(require("cli-table3"));
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function registerAppsCommands(program) {
    const apps = program.command('apps').description('Manage ACAP applications (CamOverlay, CamStreamer, CamSwitcher, CamScripter, ...)');
    apps
        .command('list <name>')
        .description('List installed ACAPs and their status')
        .action((0, output_1.action)(async (name) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        const list = await vapix.getApplicationList();
        const table = new cli_table3_1.default({ head: ['Name', 'Version', 'Status', 'Vendor'] });
        for (const a of list) {
            table.push([a.Name, a.Version, a.Status, a.Vendor]);
        }
        console.log(table.toString());
    }));
    apps
        .command('start <name> <appId>')
        .description('Start an ACAP by its application ID (e.g. CamOverlay, CamStreamer, CamSwitcher, CamScripter)')
        .action((0, output_1.action)(async (name, appId) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        await vapix.startApplication(appId);
        (0, output_1.ok)(`Started ${appId} on "${name}"`);
    }));
    apps
        .command('stop <name> <appId>')
        .description('Stop an ACAP by its application ID')
        .action((0, output_1.action)(async (name, appId) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        await vapix.stopApplication(appId);
        (0, output_1.ok)(`Stopped ${appId} on "${name}"`);
    }));
    apps
        .command('restart <name> <appId>')
        .description('Restart an ACAP by its application ID')
        .action((0, output_1.action)(async (name, appId) => {
        const cam = (0, config_1.getCamera)(name);
        const vapix = new camstreamerlib_1.VapixAPI((0, client_1.buildClient)(cam));
        await vapix.restartApplication(appId);
        (0, output_1.ok)(`Restarted ${appId} on "${name}"`);
    }));
}
