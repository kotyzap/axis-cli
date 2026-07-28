import { Command } from 'commander';
import Table from 'cli-table3';
import { CamOverlayAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, ok } from '../output';

export function registerOverlayCommands(program: Command) {
    const overlay = program.command('overlay').description('Control CamOverlay services');

    overlay
        .command('list <name>')
        .description('List CamOverlay services')
        .action(
            action(async (name: string) => {
                const cam = getCamera(name);
                const co = new CamOverlayAPI(buildClient(cam) as any);
                const services = await co.getServices();
                const table = new Table({ head: ['Service ID', 'Enabled'] });
                for (const s of services as any[]) {
                    table.push([s.id ?? s.serviceId ?? JSON.stringify(s), s.enabled ?? '-']);
                }
                console.log(table.toString());
            })
        );

    overlay
        .command('enable <name> <serviceId>')
        .description('Show a CamOverlay service')
        .action(
            action(async (name: string, serviceId: string) => {
                const cam = getCamera(name);
                const co = new CamOverlayAPI(buildClient(cam) as any);
                await co.setEnabled(parseInt(serviceId, 10), true);
                ok(`Enabled CamOverlay service ${serviceId} on "${name}"`);
            })
        );

    overlay
        .command('disable <name> <serviceId>')
        .description('Hide a CamOverlay service')
        .action(
            action(async (name: string, serviceId: string) => {
                const cam = getCamera(name);
                const co = new CamOverlayAPI(buildClient(cam) as any);
                await co.setEnabled(parseInt(serviceId, 10), false);
                ok(`Disabled CamOverlay service ${serviceId} on "${name}"`);
            })
        );

    overlay
        .command('text <name> <serviceId> <fields...>')
        .description('Update CG text fields as field=value pairs, e.g. "axis overlay text cam1 2 temperature=22.5C humidity=45%"')
        .action(
            action(async (name: string, serviceId: string, fields: string[]) => {
                const cam = getCamera(name);
                const co = new CamOverlayAPI(buildClient(cam) as any);
                const parsed = fields.map((kv) => {
                    const idx = kv.indexOf('=');
                    if (idx === -1) throw new Error(`Invalid field "${kv}", expected field_name=text`);
                    return { field_name: kv.slice(0, idx), text: kv.slice(idx + 1) };
                });
                await co.updateCGText(parseInt(serviceId, 10), parsed);
                ok(`Updated ${parsed.length} field(s) on service ${serviceId} ("${name}")`);
            })
        );
}
