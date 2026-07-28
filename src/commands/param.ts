import { Command } from 'commander';
import { VapixAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, ok, printJson } from '../output';

export function registerParamCommands(program: Command) {
    const param = program.command('param').description('Read/write Axis VAPIX parameters (param.cgi)');

    param
        .command('get <name> <params...>')
        .description('Get one or more parameters, e.g. "axis param get cam1 root.Brand.ProdFullName root.Network.eth0.IPAddress"')
        .action(
            action(async (name: string, params: string[]) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                const result = await vapix.getParameter(params);
                printJson(result);
            })
        );

    param
        .command('set <name> <assignments...>')
        .description('Set one or more parameters as key=value pairs, e.g. "axis param set cam1 root.Time.DST=yes"')
        .action(
            action(async (name: string, assignments: string[]) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                const params: Record<string, string> = {};
                for (const kv of assignments) {
                    const idx = kv.indexOf('=');
                    if (idx === -1) throw new Error(`Invalid assignment "${kv}", expected key=value`);
                    params[kv.slice(0, idx)] = kv.slice(idx + 1);
                }
                await vapix.setParameter(params);
                ok(`Set ${Object.keys(params).length} parameter(s) on "${name}"`);
            })
        );
}
