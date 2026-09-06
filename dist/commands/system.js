"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSystemCommands = registerSystemCommands;
const session_1 = require("../session");
const output_1 = require("../output");
const firmware_1 = require("../vapix/firmware");
function registerSystemCommands(program) {
    program
        .command('reboot <name>')
        .description('Reboot the camera')
        .option('-y, --yes', 'Skip confirmation')
        .action((0, output_1.action)(async (name, opts) => {
        // Resolve the profile before the confirmation gate, so an unknown
        // name fails immediately rather than after a --yes round-trip.
        const cam = (0, session_1.openCamera)(name);
        // Refusing to act must not exit 0, or scripts cannot tell that
        // nothing happened.
        if (!opts.yes) {
            throw new Error(`Refusing to reboot "${name}" without confirmation. Re-run with --yes.`);
        }
        const caps = await cam.caps();
        // firmwaremanagement.cgi (firmware 7.40+) is the current API and
        // explicitly obsoletes restart.cgi. restart.cgi is still documented and
        // has not been removed even in 12.x, so it stays as the fallback for
        // older devices rather than being dropped.
        if (caps.firmwareManagement) {
            await cam.core.postJson('/axis-cgi/firmwaremanagement.cgi', {
                apiVersion: '1.0',
                context: 'axis-cli',
                method: 'reboot',
            });
            (0, output_1.ok)(`Reboot triggered on "${name}" via firmwaremanagement.cgi`);
            return;
        }
        // restart.cgi answers with an HTML page, not a status code we can
        // usefully check, so a clean return is the whole signal.
        await cam.core.callCgi('/axis-cgi/restart.cgi');
        (0, output_1.ok)(`Reboot triggered on "${name}" via restart.cgi`);
        if ((0, firmware_1.atLeast)(caps.firmware, '7.40') === false) {
            (0, output_1.info)('This device predates the firmware management API, so the legacy restart CGI was used.');
        }
    }));
}
