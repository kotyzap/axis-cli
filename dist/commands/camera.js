"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCameraCommands = registerCameraCommands;
const cli_table3_1 = __importDefault(require("cli-table3"));
const config_1 = require("../config");
const output_1 = require("../output");
function registerCameraCommands(program) {
    const camera = program.command('camera').description('Manage saved camera profiles');
    camera
        .command('add <name>')
        .description('Save a new camera profile (local IP or CamStreamer Cloud)')
        .option('--ip <ip>', 'Camera IP or hostname (local access)')
        .option('--port <port>', 'HTTP(S) port', '80')
        .option('--user <user>', 'Camera username', 'root')
        .option('--pass <pass>', 'Camera password')
        .option('--tls', 'Use HTTPS/WSS', false)
        .option('--cloud-url <url>', 'CamStreamer Cloud device-connect.net URL (instead of --ip)')
        .option('--cloud-token <token>', 'CamStreamer Cloud DEVICE_ACCESS_TOKEN (instead of --user/--pass)')
        .action((0, output_1.action)(async (name, opts) => {
        if (!opts.cloudUrl && !opts.ip) {
            throw new Error('Provide either --ip (local camera) or --cloud-url (CamStreamer Cloud).');
        }
        if (!opts.pass && !opts.cloudToken) {
            throw new Error('Provide either --pass (local camera password) or --cloud-token.');
        }
        (0, config_1.addCamera)({
            name,
            ip: opts.ip ?? '',
            port: parseInt(opts.port, 10),
            user: opts.user,
            pass: opts.pass ?? '',
            tls: !!opts.tls,
            cloudUrl: opts.cloudUrl,
            cloudToken: opts.cloudToken,
        });
        (0, output_1.ok)(`Saved camera profile "${name}" to ${(0, config_1.configPath)()}`);
    }));
    camera
        .command('list')
        .alias('ls')
        .description('List saved camera profiles')
        .action((0, output_1.action)(async () => {
        const cams = (0, config_1.listCameras)();
        if (cams.length === 0) {
            (0, output_1.info)('No camera profiles yet. Add one with: axis camera add <name> --ip <ip> --pass <pass>');
            return;
        }
        const table = new cli_table3_1.default({ head: ['Name', 'Access', 'User', 'TLS'] });
        for (const c of cams) {
            table.push([
                c.name,
                c.cloudUrl ? `cloud: ${c.cloudUrl}` : `${c.ip}:${c.port}`,
                c.cloudUrl ? '(token)' : c.user,
                c.tls ? 'yes' : 'no',
            ]);
        }
        console.log(table.toString());
    }));
    camera
        .command('remove <name>')
        .alias('rm')
        .description('Remove a saved camera profile')
        .action((0, output_1.action)(async (name) => {
        (0, config_1.removeCamera)(name);
        (0, output_1.ok)(`Removed camera profile "${name}"`);
    }));
}
