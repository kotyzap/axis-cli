import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { VapixAPI } from 'camstreamerlib';
import { listCameras } from '../config';
import { buildClient } from '../client';
import { action, info } from '../output';

const HEALTH_PARAMS = ['root.Brand.ProdShortName', 'root.Properties.Firmware.Version'];

export function registerFleetCommands(program: Command) {
    const fleet = program.command('fleet').description('Check status across all saved camera profiles');

    fleet
        .command('health')
        .description('Ping every saved camera and report reachability, firmware, SD card, and ACAP status')
        .action(
            action(async () => {
                const cams = listCameras();
                if (cams.length === 0) {
                    info('No camera profiles saved yet. Add one with: axis camera add <name> --ip <ip> --pass <pass>');
                    return;
                }

                const table = new Table({
                    head: ['Camera', 'Status', 'Product', 'Firmware', 'SD Card', 'ACAPs running'],
                });

                for (const cam of cams) {
                    try {
                        const vapix = new VapixAPI(buildClient(cam) as any);
                        const params = await vapix.getParameter(HEALTH_PARAMS);

                        let sdStatus = '-';
                        try {
                            const sd = await vapix.checkSDCard();
                            sdStatus = sd.status;
                        } catch {
                            sdStatus = 'n/a';
                        }

                        let runningCount = '-';
                        try {
                            const apps = await vapix.getApplicationList();
                            const running = apps.filter((a) => a.appId && a.Status === 'Running');
                            runningCount = `${running.length}/${apps.filter((a) => a.appId).length}`;
                        } catch {
                            runningCount = 'n/a';
                        }

                        table.push([
                            cam.name,
                            chalk.green('reachable'),
                            params['root.Brand.ProdShortName'] ?? '-',
                            params['root.Properties.Firmware.Version'] ?? '-',
                            sdStatus,
                            runningCount,
                        ]);
                    } catch (err) {
                        table.push([cam.name, chalk.red('unreachable'), '-', '-', '-', (err as Error).message.slice(0, 40)]);
                    }
                }

                console.log(table.toString());
            })
        );
}
