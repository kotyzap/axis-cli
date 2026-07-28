"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOverlayCommands = registerOverlayCommands;
const cli_table3_1 = __importDefault(require("cli-table3"));
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function registerOverlayCommands(program) {
    const overlay = program.command('overlay').description('Control CamOverlay services');
    overlay
        .command('list <name>')
        .description('List CamOverlay services')
        .action((0, output_1.action)(async (name) => {
        const cam = (0, config_1.getCamera)(name);
        const co = new camstreamerlib_1.CamOverlayAPI((0, client_1.buildClient)(cam));
        const services = await co.getServices();
        const table = new cli_table3_1.default({ head: ['Service ID', 'Enabled'] });
        for (const s of services) {
            table.push([s.id ?? s.serviceId ?? JSON.stringify(s), s.enabled ?? '-']);
        }
        console.log(table.toString());
    }));
    overlay
        .command('enable <name> <serviceId>')
        .description('Show a CamOverlay service')
        .action((0, output_1.action)(async (name, serviceId) => {
        const cam = (0, config_1.getCamera)(name);
        const co = new camstreamerlib_1.CamOverlayAPI((0, client_1.buildClient)(cam));
        await co.setEnabled(parseInt(serviceId, 10), true);
        (0, output_1.ok)(`Enabled CamOverlay service ${serviceId} on "${name}"`);
    }));
    overlay
        .command('disable <name> <serviceId>')
        .description('Hide a CamOverlay service')
        .action((0, output_1.action)(async (name, serviceId) => {
        const cam = (0, config_1.getCamera)(name);
        const co = new camstreamerlib_1.CamOverlayAPI((0, client_1.buildClient)(cam));
        await co.setEnabled(parseInt(serviceId, 10), false);
        (0, output_1.ok)(`Disabled CamOverlay service ${serviceId} on "${name}"`);
    }));
    overlay
        .command('text <name> <serviceId> <fields...>')
        .description('Update CG text fields as field=value pairs, e.g. "axis overlay text cam1 2 temperature=22.5C humidity=45%"')
        .action((0, output_1.action)(async (name, serviceId, fields) => {
        const cam = (0, config_1.getCamera)(name);
        const co = new camstreamerlib_1.CamOverlayAPI((0, client_1.buildClient)(cam));
        const parsed = fields.map((kv) => {
            const idx = kv.indexOf('=');
            if (idx === -1)
                throw new Error(`Invalid field "${kv}", expected field_name=text`);
            return { field_name: kv.slice(0, idx), text: kv.slice(idx + 1) };
        });
        await co.updateCGText(parseInt(serviceId, 10), parsed);
        (0, output_1.ok)(`Updated ${parsed.length} field(s) on service ${serviceId} ("${name}")`);
    }));
}
