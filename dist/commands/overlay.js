"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOverlayCommands = registerOverlayCommands;
const camstreamerlib_1 = require("camstreamerlib");
const session_1 = require("../session");
const client_1 = require("../client");
const acap_guard_1 = require("../acap-guard");
const output_1 = require("../output");
const util_1 = require("../util");
function registerOverlayCommands(program) {
    const overlay = program.command('overlay').description('Control CamOverlay services');
    /**
     * CamOverlay's API is served by the ACAP, not by the camera firmware, so these
     * calls go through withAcap — on a camera where CamOverlay is missing or
     * stopped the raw failure is indistinguishable from an unreachable host.
     */
    const api = (name) => {
        const cam = (0, session_1.openCamera)(name);
        return { cam, co: new camstreamerlib_1.CamOverlayAPI((0, client_1.buildClient)(cam.profile)) };
    };
    overlay
        .command('list <name>')
        .alias('ls')
        .description('List CamOverlay services')
        .action((0, output_1.action)(async (name) => {
        const { cam, co } = api(name);
        const services = await (0, acap_guard_1.withAcap)(cam, 'CamOverlay', () => co.getServices());
        // Not every service variant carries customName, so read it defensively.
        const rows = services.map((s) => ({
            id: s.id,
            type: s.name,
            customName: s.customName ?? '',
            enabled: !!s.enabled,
        }));
        (0, output_1.printTable)(['ID', 'Type', 'Name', 'Enabled'], rows.map((r) => [r.id, r.type, r.customName || '-', r.enabled ? 'yes' : 'no']), rows);
    }));
    overlay
        .command('enable <name> <serviceId>')
        .description('Enable a CamOverlay service')
        .action((0, output_1.action)(async (name, serviceId) => {
        const { cam, co } = api(name);
        const id = (0, util_1.parseIntOrThrow)(serviceId, 'service ID', { min: 0 });
        await (0, acap_guard_1.withAcap)(cam, 'CamOverlay', () => co.setEnabled(id, true));
        (0, output_1.ok)(`Enabled CamOverlay service ${serviceId} on "${name}"`);
    }));
    overlay
        .command('disable <name> <serviceId>')
        .description('Disable a CamOverlay service')
        .action((0, output_1.action)(async (name, serviceId) => {
        const { cam, co } = api(name);
        const id = (0, util_1.parseIntOrThrow)(serviceId, 'service ID', { min: 0 });
        await (0, acap_guard_1.withAcap)(cam, 'CamOverlay', () => co.setEnabled(id, false));
        (0, output_1.ok)(`Disabled CamOverlay service ${serviceId} on "${name}"`);
    }));
    overlay
        .command('text <name> <serviceId> <fields...>')
        .description('Update CG text fields as field=value pairs, e.g. "axis overlay text cam1 2 temperature=22.5C humidity=45%"')
        .action((0, output_1.action)(async (name, serviceId, fields) => {
        const { cam, co } = api(name);
        const id = (0, util_1.parseIntOrThrow)(serviceId, 'service ID', { min: 0 });
        const parsed = Object.entries((0, util_1.parseKeyValue)(fields, 'field')).map(([field_name, text]) => ({
            field_name,
            text,
        }));
        await (0, acap_guard_1.withAcap)(cam, 'CamOverlay', () => co.updateCGText(id, parsed));
        (0, output_1.ok)(`Updated ${parsed.length} field(s) on service ${serviceId} ("${name}")`);
    }));
}
