import { Command } from 'commander';
import { VapixAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, ok, warn } from '../output';

function parseParams(pairs: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const kv of pairs) {
        const idx = kv.indexOf('=');
        if (idx === -1) throw new Error(`Invalid param "${kv}", expected key=value`);
        out[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
    return out;
}

export function registerRawCommands(program: Command) {
    program
        .command('reboot <name>')
        .description('Reboot the camera (axis-cgi/restart.cgi)')
        .option('-y, --yes', 'Skip confirmation')
        .action(
            action(async (name: string, opts) => {
                if (!opts.yes) {
                    warn(`This will reboot "${name}" now. Re-run with --yes to confirm.`);
                    return;
                }
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                await vapix.postUrlEncoded('/axis-cgi/restart.cgi', {});
                ok(`Reboot triggered on "${name}"`);
            })
        );

    const vapixCmd = program.command('vapix').description('Raw VAPIX escape hatch for endpoints not otherwise wrapped');

    vapixCmd
        .command('get <name> <path> [params...]')
        .description('Raw GET, e.g. "axis vapix get cam1 /axis-cgi/param.cgi action=list group=Image"')
        .action(
            action(async (name: string, path: string, params: string[]) => {
                const cam = getCamera(name);
                const client = buildClient(cam) as any;
                const res = await client.get({ path, parameters: parseParams(params) });
                console.log(await res.text());
            })
        );

    vapixCmd
        .command('post <name> <path> [params...]')
        .description('Raw POST (url-encoded body), e.g. "axis vapix post cam1 /axis-cgi/restart.cgi"')
        .action(
            action(async (name: string, path: string, params: string[]) => {
                const cam = getCamera(name);
                const vapix = new VapixAPI(buildClient(cam) as any);
                const res = await vapix.postUrlEncoded(path, parseParams(params));
                console.log(await res.text());
            })
        );
}
