import { Command } from 'commander';
import { VapixAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, info as logInfo } from '../output';

const INFO_PARAMS = [
    'root.Brand.Brand',
    'root.Brand.ProdFullName',
    'root.Brand.ProdShortName',
    'root.Properties.Firmware.Version',
    'root.Properties.System.SerialNumber',
    'root.Network.eth0.IPAddress',
];

export function registerInfoCommand(program: Command) {
    program
        .command('info <name>')
        .description('Show basic device info for a camera')
        .action(
            action(async (name: string) => {
                const cam = getCamera(name);
                const client = buildClient(cam);
                const vapix = new VapixAPI(client as any);

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
                } catch {
                    logInfo('  (Could not read ACAP application list — insufficient permissions or unsupported firmware.)');
                }
            })
        );
}
