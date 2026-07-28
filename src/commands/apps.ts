import { Command } from 'commander';
import Table from 'cli-table3';
import { VapixAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, ok } from '../output';

export function registerAppsCommands(program: Command) {
    const apps = program.command('apps').description('Manage ACAP applications (CamOverlay, CamStreamer, CamSwitcher, CamScripter, ...)');

    apps
        .command('list <name>')
        .description('List installed ACAPs and their status')
        .action(
            action(async (name: string) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                const list = await vapix.getApplicationList();
                const table = new Table({ head: ['Name', 'Version', 'Status', 'Vendor'] });
                for (const a of list) {
                    table.push([a.Name, a.Version, a.Status, a.Vendor]);
                }
                console.log(table.toString());
            })
        );

    apps
        .command('start <name> <appId>')
        .description('Start an ACAP by its application ID (e.g. CamOverlay, CamStreamer, CamSwitcher, CamScripter)')
        .action(
            action(async (name: string, appId: string) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                await vapix.startApplication(appId);
                ok(`Started ${appId} on "${name}"`);
            })
        );

    apps
        .command('stop <name> <appId>')
        .description('Stop an ACAP by its application ID')
        .action(
            action(async (name: string, appId: string) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                await vapix.stopApplication(appId);
                ok(`Stopped ${appId} on "${name}"`);
            })
        );

    apps
        .command('restart <name> <appId>')
        .description('Restart an ACAP by its application ID')
        .action(
            action(async (name: string, appId: string) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                await vapix.restartApplication(appId);
                ok(`Restarted ${appId} on "${name}"`);
            })
        );
}
