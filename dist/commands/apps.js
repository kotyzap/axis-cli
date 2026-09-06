"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppsCommands = registerAppsCommands;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const session_1 = require("../session");
const output_1 = require("../output");
const util_1 = require("../util");
const apps_1 = require("../vapix/apps");
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
async function resolve(cameraName, query) {
    const cam = (0, session_1.openCamera)(cameraName);
    const apps = await cam.apps();
    return { cam, app: (0, apps_1.resolveApplication)(apps, query) };
}
function registerControl(parent, verb, description, pastTense) {
    parent
        .command(`${verb} <name> <app>`)
        .description(description)
        .action((0, output_1.action)(async (name, appQuery) => {
        const { cam, app } = await resolve(name, appQuery);
        const { alreadyInState } = await (0, apps_1.controlApplication)(cam.core, verb, app.name);
        if (alreadyInState) {
            (0, output_1.info)(`${app.niceName ?? app.name} was already ${verb === 'start' ? 'running' : 'stopped'} on "${name}"`);
            return;
        }
        (0, output_1.ok)(`${pastTense} ${app.niceName ?? app.name} on "${name}"`);
    }));
}
function registerAppsCommands(program) {
    const apps = program
        .command('apps')
        .description('Manage ACAP applications (CamOverlay, CamStreamer, CamSwitcher, CamScripter, and any other ACAP)');
    apps
        .command('list <name>')
        .alias('ls')
        .description('List installed ACAPs and their status')
        .option('--running', 'Show only ACAPs that are currently running', false)
        .option('--family', 'Show only the CamStreamer family', false)
        .action((0, output_1.action)(async (name, opts) => {
        const cam = (0, session_1.openCamera)(name);
        let list = await cam.apps();
        if (opts.running)
            list = list.filter((a) => (a.status ?? '').toLowerCase() === 'running');
        if (opts.family)
            list = list.filter((a) => a.familyId);
        (0, output_1.printTable)(['Name', 'Nice name', 'Version', 'Status', 'Vendor', 'License'], list.map((a) => [
            a.name,
            a.niceName ?? '-',
            a.version ?? '-',
            a.status ?? '-',
            a.vendor ?? '-',
            a.license ?? '-',
        ]), list.map((a) => ({
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
        })));
        if (!(0, output_1.isJsonMode)() && list.length > 0) {
            // The Name column, not the nice name, is what the other subcommands
            // take — worth saying, because they differ for most ACAPs.
            (0, output_1.info)('Use the value in the Name column with "axis apps start/stop/restart/uninstall".');
        }
    }));
    registerControl(apps, 'start', 'Start an ACAP', 'Started');
    registerControl(apps, 'stop', 'Stop an ACAP', 'Stopped');
    registerControl(apps, 'restart', 'Restart an ACAP', 'Restarted');
    apps
        .command('install <name> <eapFile>')
        .description('Upload and install an .eap application package')
        .option('--start', 'Start the application after installing it', false)
        .option('--force', 'Skip the compatibility pre-flight checks', false)
        .option('-t, --timeout <ms>', 'Upload timeout in milliseconds', '120000')
        .action((0, output_1.action)(async (name, eapFile, opts) => {
        const file = path.resolve(eapFile);
        if (!fs.existsSync(file))
            throw new Error(`No such file: ${file}`);
        if (!file.toLowerCase().endsWith('.eap')) {
            throw new Error(`"${path.basename(file)}" is not an .eap package.`);
        }
        const cam = (0, session_1.openCamera)(name);
        const caps = await cam.caps();
        // Pre-flight before uploading, not after: the camera's own verdict on an
        // incompatible package is "error 5", which arrives only once the whole
        // file has crossed the network.
        const findings = (0, apps_1.preflightUpload)({
            fileName: path.basename(file),
            firmware: caps.firmware,
            architecture: caps.device.architecture,
            supportedSdks: caps.acap.supportedSdks,
            allowUnsigned: await (0, apps_1.getAppConfig)(cam.core, 'AllowUnsigned', caps.firmware),
        });
        const blocking = findings.filter((f) => f.blocking);
        if (blocking.length > 0 && !opts.force) {
            throw new Error(`Refusing to upload to "${name}":\n  ${blocking.map((f) => f.message).join('\n  ')}\n\n` +
                '  Re-run with --force to upload anyway.');
        }
        for (const f of findings)
            (f.blocking ? output_1.warn : output_1.info)(f.message);
        const contents = fs.readFileSync(file);
        (0, output_1.info)(`Uploading ${path.basename(file)} (${(contents.byteLength / 1048576).toFixed(1)} MB) to "${name}"...`);
        await (0, apps_1.uploadApplication)(cam.core, path.basename(file), contents, {
            timeout: (0, util_1.parseIntOrThrow)(opts.timeout, 'timeout', { min: 1000 }),
        });
        (0, output_1.ok)(`Installed ${path.basename(file)} on "${name}"`);
        (0, output_1.info)('Uploaded applications are installed but not started.');
        if (opts.start) {
            // The package name inside the .eap is not necessarily the filename, so
            // re-read the listing rather than guessing it. refreshApps() rather
            // than apps(), because the session memoised the pre-install listing —
            // which by definition does not contain what we just uploaded.
            const installed = await cam.refreshApps();
            const stem = path.basename(file).replace(/\.eap$/i, '');
            const match = installed.find((a) => stem.toLowerCase().startsWith(a.name.toLowerCase())) ??
                installed.find((a) => a.name.toLowerCase().includes(stem.split('_')[0].toLowerCase()));
            if (!match) {
                (0, output_1.warn)('Could not work out which application was just installed, so it was not started.');
                (0, output_1.info)(`Start it manually: axis apps list ${name}`);
                return;
            }
            await (0, apps_1.controlApplication)(cam.core, 'start', match.name);
            (0, output_1.ok)(`Started ${match.niceName ?? match.name} on "${name}"`);
        }
    }));
    apps
        .command('uninstall <name> <app>')
        .alias('remove')
        .description('Remove an installed ACAP')
        .option('-y, --yes', 'Skip confirmation')
        .action((0, output_1.action)(async (name, appQuery, opts) => {
        // The confirmation gate comes first, before any network access. Same
        // reasoning as reboot: declining must be a non-zero exit so a script can
        // tell "removed" from "left alone" — and it should not require a
        // reachable camera to find that out.
        if (!opts.yes) {
            throw new Error(`Refusing to remove "${appQuery}" from "${name}" without confirmation. Re-run with --yes.`);
        }
        const { cam, app } = await resolve(name, appQuery);
        if (app.bundled) {
            throw new Error(`"${app.name}" is bundled with the firmware and cannot be removed.`);
        }
        await (0, apps_1.controlApplication)(cam.core, 'remove', app.name);
        (0, output_1.ok)(`Removed ${app.niceName ?? app.name} from "${name}"`);
    }));
}
