import { Command } from 'commander';
import Table from 'cli-table3';
import { addCamera, listCameras, removeCamera, configPath } from '../config';
import { ok, info, action } from '../output';

export function registerCameraCommands(program: Command) {
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
        .action(
            action(async (name: string, opts) => {
                if (!opts.cloudUrl && !opts.ip) {
                    throw new Error('Provide either --ip (local camera) or --cloud-url (CamStreamer Cloud).');
                }
                if (!opts.pass && !opts.cloudToken) {
                    throw new Error('Provide either --pass (local camera password) or --cloud-token.');
                }
                addCamera({
                    name,
                    ip: opts.ip ?? '',
                    port: parseInt(opts.port, 10),
                    user: opts.user,
                    pass: opts.pass ?? '',
                    tls: !!opts.tls,
                    cloudUrl: opts.cloudUrl,
                    cloudToken: opts.cloudToken,
                });
                ok(`Saved camera profile "${name}" to ${configPath()}`);
            })
        );

    camera
        .command('list')
        .alias('ls')
        .description('List saved camera profiles')
        .action(
            action(async () => {
                const cams = listCameras();
                if (cams.length === 0) {
                    info('No camera profiles yet. Add one with: axis camera add <name> --ip <ip> --pass <pass>');
                    return;
                }
                const table = new Table({ head: ['Name', 'Access', 'User', 'TLS'] });
                for (const c of cams) {
                    table.push([
                        c.name,
                        c.cloudUrl ? `cloud: ${c.cloudUrl}` : `${c.ip}:${c.port}`,
                        c.cloudUrl ? '(token)' : c.user,
                        c.tls ? 'yes' : 'no',
                    ]);
                }
                console.log(table.toString());
            })
        );

    camera
        .command('remove <name>')
        .alias('rm')
        .description('Remove a saved camera profile')
        .action(
            action(async (name: string) => {
                removeCamera(name);
                ok(`Removed camera profile "${name}"`);
            })
        );
}
