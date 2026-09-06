import { Command } from 'commander';
import { CamOverlayAPI } from 'camstreamerlib';
import { openCamera } from '../session';
import { buildClient } from '../client';
import { withAcap } from '../acap-guard';
import { action, ok, printTable } from '../output';
import { parseIntOrThrow, parseKeyValue } from '../util';

export function registerOverlayCommands(program: Command) {
    const overlay = program.command('overlay').description('Control CamOverlay services');

    /**
     * CamOverlay's API is served by the ACAP, not by the camera firmware, so these
     * calls go through withAcap — on a camera where CamOverlay is missing or
     * stopped the raw failure is indistinguishable from an unreachable host.
     */
    const api = (name: string) => {
        const cam = openCamera(name);
        return { cam, co: new CamOverlayAPI(buildClient(cam.profile) as any) };
    };

    overlay
        .command('list <name>')
        .alias('ls')
        .description('List CamOverlay services')
        .action(
            action(async (name: string) => {
                const { cam, co } = api(name);
                const services = await withAcap(cam, 'CamOverlay', () => co.getServices());
                // Not every service variant carries customName, so read it defensively.
                const rows = services.map((s) => ({
                    id: s.id,
                    type: s.name,
                    customName: (s as { customName?: string }).customName ?? '',
                    enabled: !!s.enabled,
                }));
                printTable(
                    ['ID', 'Type', 'Name', 'Enabled'],
                    rows.map((r) => [r.id, r.type, r.customName || '-', r.enabled ? 'yes' : 'no']),
                    rows
                );
            })
        );

    overlay
        .command('enable <name> <serviceId>')
        .description('Enable a CamOverlay service')
        .action(
            action(async (name: string, serviceId: string) => {
                const { cam, co } = api(name);
                const id = parseIntOrThrow(serviceId, 'service ID', { min: 0 });
                await withAcap(cam, 'CamOverlay', () => co.setEnabled(id, true));
                ok(`Enabled CamOverlay service ${serviceId} on "${name}"`);
            })
        );

    overlay
        .command('disable <name> <serviceId>')
        .description('Disable a CamOverlay service')
        .action(
            action(async (name: string, serviceId: string) => {
                const { cam, co } = api(name);
                const id = parseIntOrThrow(serviceId, 'service ID', { min: 0 });
                await withAcap(cam, 'CamOverlay', () => co.setEnabled(id, false));
                ok(`Disabled CamOverlay service ${serviceId} on "${name}"`);
            })
        );

    overlay
        .command('text <name> <serviceId> <fields...>')
        .description('Update CG text fields as field=value pairs, e.g. "axis overlay text cam1 2 temperature=22.5C humidity=45%"')
        .action(
            action(async (name: string, serviceId: string, fields: string[]) => {
                const { cam, co } = api(name);
                const id = parseIntOrThrow(serviceId, 'service ID', { min: 0 });
                const parsed = Object.entries(parseKeyValue(fields, 'field')).map(([field_name, text]) => ({
                    field_name,
                    text,
                }));
                await withAcap(cam, 'CamOverlay', () => co.updateCGText(id, parsed));
                ok(`Updated ${parsed.length} field(s) on service ${serviceId} ("${name}")`);
            })
        );
}
