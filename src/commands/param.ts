import { Command } from 'commander';
import { openCamera } from '../session';
import { action, ok, printJson, warn } from '../output';
import { parseKeyValue } from '../util';
import { listParams, stripRoot, updateParams } from '../vapix/params';

export function registerParamCommands(program: Command) {
    const param = program.command('param').description('Read/write Axis VAPIX parameters (param.cgi)');

    param
        .command('get <name> <params...>')
        .description(
            'Get parameters or whole groups, e.g. "axis param get cam1 Brand.ProdFullName Properties.PTZ"'
        )
        .action(
            action(async (name: string, params: string[]) => {
                const cam = openCamera(name);
                // Keys are returned exactly as the camera reports them, including the
                // "root." prefix. The previous implementation went through
                // camstreamerlib, which strips that prefix — so asking for
                // "root.Brand.Brand" produced a result keyed "Brand.Brand" and looking
                // it up by the name you asked for silently yielded nothing.
                const result = await listParams(cam.core, params);

                if (result.size === 0) {
                    warn(
                        `The camera returned no values for ${params.map((p) => `"${p}"`).join(', ')}. ` +
                            'Parameter names are case-sensitive per group; try the parent group ' +
                            `(e.g. "axis param get ${name} ${stripRoot(params[0]).split('.')[0]}") to see what exists.`
                    );
                }
                printJson(result.raw);
            })
        );

    param
        .command('set <name> <assignments...>')
        .description('Set one or more parameters as key=value pairs, e.g. "axis param set cam1 Time.DST.Enabled=yes"')
        .action(
            action(async (name: string, assignments: string[]) => {
                const cam = openCamera(name);
                const params = parseKeyValue(assignments, 'assignment');
                // Sent as a POST form body rather than in the query string, so values
                // do not land in the camera's access log.
                await updateParams(cam.core, params);
                ok(`Set ${Object.keys(params).length} parameter(s) on "${name}"`);
            })
        );
}
