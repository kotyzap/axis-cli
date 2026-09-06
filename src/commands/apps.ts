import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { openCamera } from '../session';
import { action, info, isJsonMode, ok, printTable, warn } from '../output';
import { parseIntOrThrow } from '../util';
import {
    controlApplication,
    getAppConfig,
    preflightUpload,
    resolveApplication,
    uploadApplication,
    ControlAction,
} from '../vapix/apps';

/**
 * Resolve the name the user typed to the exact `Name` the camera expects.
 *
 * This indirection is the fix for the most damaging portability bug in the old
 * implementation: it passed `applicationId.toLowerCase()` straight to
 * control.cgi. `package=` is matched exactly, so lowercasing worked only for
 * ACAPs whose name happens to be all-lowercase on the device — every
 * third-party ACAP (`AXIS_Object_Analytics`, `AXIS_Video_Motion_Detection`)
 * silently failed with "error 4, application not found".
 */
async function resolve(cameraName: string, query: string) {
    const cam = openCamera(cameraName);
    const apps = await cam.apps();
    return { cam, app: resolveApplication(apps, query) };
}

function registerControl(parent: Command, verb: ControlAction, description: string, pastTense: string) {
    parent
        .command(`${verb} <name> <app>`)
        .description(description)
        .action(
            action(async (name: string, appQuery: string) => {
                const { cam, app } = await resolve(name, appQuery);
                const { alreadyInState } = await controlApplication(cam.core, verb, app.name);
                if (alreadyInState) {
                    info(`${app.niceName ?? app.name} was already ${verb === 'start' ? 'running' : 'stopped'} on "${name}"`);
                    return;
                }
                ok(`${pastTense} ${app.niceName ?? app.name} on "${name}"`);
            })
        );
}

export function registerAppsCommands(program: Command) {
    const apps = program
        .command('apps')
        .description('Manage ACAP applications (CamOverlay, CamStreamer, CamSwitcher, CamScripter, and any other ACAP)');

    apps
        .command('list <name>')
        .alias('ls')
        .description('List installed ACAPs and their status')
        .option('--running', 'Show only ACAPs that are currently running', false)
        .option('--family', 'Show only the CamStreamer family', false)
        .action(
            action(async (name: string, opts) => {
                const cam = openCamera(name);
                let list = await cam.apps();
                if (opts.running) list = list.filter((a) => (a.status ?? '').toLowerCase() === 'running');
                if (opts.family) list = list.filter((a) => a.familyId);

                printTable(
                    ['Name', 'Nice name', 'Version', 'Status', 'Vendor', 'License'],
                    list.map((a) => [
                        a.name,
                        a.niceName ?? '-',
                        a.version ?? '-',
                        a.status ?? '-',
                        a.vendor ?? '-',
                        a.license ?? '-',
                    ]),
                    list.map((a) => ({
                        name: a.name,
                        niceName: a.niceName,
                        version: a.version,
                        status: a.status,
                        vendor: a.vendor,
                        license: a.license,
                        licenseExpirationDate: a.licenseExpirationDate,
                        applicationId: a.applicationId,
                        bundled: a.bundled,
                        signatureStatus: a.signatureStatus,
                        compatibleOsVersions: a.compatibleOsVersions,
                        familyId: a.familyId,
                    }))
                );

                if (!isJsonMode() && list.length > 0) {
                    // The Name column, not the nice name, is what the other subcommands
                    // take — worth saying, because they differ for most ACAPs.
                    info('Use the value in the Name column with "axis apps start/stop/restart/uninstall".');
                }
            })
        );

    registerControl(apps, 'start', 'Start an ACAP', 'Started');
    registerControl(apps, 'stop', 'Stop an ACAP', 'Stopped');
    registerControl(apps, 'restart', 'Restart an ACAP', 'Restarted');

    apps
        .command('install <name> <eapFile>')
        .description('Upload and install an .eap application package')
        .option('--start', 'Start the application after installing it', false)
        .option('--force', 'Skip the compatibility pre-flight checks', false)
        .option('-t, --timeout <ms>', 'Upload timeout in milliseconds', '120000')
        .action(
            action(async (name: string, eapFile: string, opts) => {
                const file = path.resolve(eapFile);
                if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);
                if (!file.toLowerCase().endsWith('.eap')) {
                    throw new Error(`"${path.basename(file)}" is not an .eap package.`);
                }

                const cam = openCamera(name);
                const caps = await cam.caps();

                // Pre-flight before uploading, not after: the camera's own verdict on an
                // incompatible package is "error 5", which arrives only once the whole
                // file has crossed the network.
                const findings = preflightUpload({
                    fileName: path.basename(file),
                    firmware: caps.firmware,
                    architecture: caps.device.architecture,
                    supportedSdks: caps.acap.supportedSdks,
                    allowUnsigned: await getAppConfig(cam.core, 'AllowUnsigned', caps.firmware),
                });

                const blocking = findings.filter((f) => f.blocking);
                if (blocking.length > 0 && !opts.force) {
                    throw new Error(
                        `Refusing to upload to "${name}":\n  ${blocking.map((f) => f.message).join('\n  ')}\n\n` +
                            '  Re-run with --force to upload anyway.'
                    );
                }
                for (const f of findings) (f.blocking ? warn : info)(f.message);

                const contents = fs.readFileSync(file);
                info(`Uploading ${path.basename(file)} (${(contents.byteLength / 1048576).toFixed(1)} MB) to "${name}"...`);

                await uploadApplication(cam.core, path.basename(file), contents, {
                    timeout: parseIntOrThrow(opts.timeout, 'timeout', { min: 1000 }),
                });
                ok(`Installed ${path.basename(file)} on "${name}"`);
                info('Uploaded applications are installed but not started.');

                if (opts.start) {
                    // The package name inside the .eap is not necessarily the filename, so
                    // re-read the listing rather than guessing it. refreshApps() rather
                    // than apps(), because the session memoised the pre-install listing —
                    // which by definition does not contain what we just uploaded.
                    const installed = await cam.refreshApps();
                    const stem = path.basename(file).replace(/\.eap$/i, '');
                    const match =
                        installed.find((a) => stem.toLowerCase().startsWith(a.name.toLowerCase())) ??
                        installed.find((a) => a.name.toLowerCase().includes(stem.split('_')[0].toLowerCase()));
                    if (!match) {
                        warn('Could not work out which application was just installed, so it was not started.');
                        info(`Start it manually: axis apps list ${name}`);
                        return;
                    }
                    await controlApplication(cam.core, 'start', match.name);
                    ok(`Started ${match.niceName ?? match.name} on "${name}"`);
                }
            })
        );

    apps
        .command('uninstall <name> <app>')
        .alias('remove')
        .description('Remove an installed ACAP')
        .option('-y, --yes', 'Skip confirmation')
        .action(
            action(async (name: string, appQuery: string, opts) => {
                // The confirmation gate comes first, before any network access. Same
                // reasoning as reboot: declining must be a non-zero exit so a script can
                // tell "removed" from "left alone" — and it should not require a
                // reachable camera to find that out.
                if (!opts.yes) {
                    throw new Error(
                        `Refusing to remove "${appQuery}" from "${name}" without confirmation. Re-run with --yes.`
                    );
                }

                const { cam, app } = await resolve(name, appQuery);

                if (app.bundled) {
                    throw new Error(`"${app.name}" is bundled with the firmware and cannot be removed.`);
                }

                await controlApplication(cam.core, 'remove', app.name);
                ok(`Removed ${app.niceName ?? app.name} from "${name}"`);
            })
        );
}
