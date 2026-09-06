#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const camera_1 = require("./commands/camera");
const discovery_1 = require("./commands/discovery");
const info_1 = require("./commands/info");
const caps_1 = require("./commands/caps");
const param_1 = require("./commands/param");
const ptz_1 = require("./commands/ptz");
const apps_1 = require("./commands/apps");
const overlay_1 = require("./commands/overlay");
const stream_1 = require("./commands/stream");
const switcher_1 = require("./commands/switcher");
const fleet_1 = require("./commands/fleet");
const preflight_1 = require("./commands/preflight");
const system_1 = require("./commands/system");
const raw_1 = require("./commands/raw");
const events_1 = require("./commands/events");
const output_1 = require("./output");
const pkg = require('../package.json');
const program = new commander_1.Command();
program
    .name('axis')
    .description('CLI for controlling Axis IP cameras — VAPIX, CamOverlay, CamStreamer, CamSwitcher, and fleet health.\n' +
    'Firmware-universal: capabilities are probed per device, from firmware 5.x through AXIS OS 12.x.')
    .version(pkg.version)
    .option('--json', 'Emit machine-readable JSON instead of tables and status messages')
    // Fixes B5: print usage on error and suggest the nearest matching command.
    .showHelpAfterError('(run "axis <command> --help" for usage)')
    .showSuggestionAfterError(true);
(0, camera_1.registerCameraCommands)(program);
(0, discovery_1.registerDiscoveryCommands)(program);
(0, info_1.registerInfoCommand)(program);
(0, caps_1.registerCapsCommand)(program);
(0, param_1.registerParamCommands)(program);
(0, ptz_1.registerPtzCommands)(program);
(0, apps_1.registerAppsCommands)(program);
(0, overlay_1.registerOverlayCommands)(program);
(0, stream_1.registerStreamCommands)(program);
(0, switcher_1.registerSwitcherCommands)(program);
(0, fleet_1.registerFleetCommands)(program);
(0, preflight_1.registerPreflightCommands)(program);
(0, system_1.registerSystemCommands)(program);
(0, raw_1.registerRawCommands)(program);
(0, events_1.registerEventsCommand)(program);
// Strip --json anywhere in argv so it works before or after the subcommand,
// rather than only immediately after "axis".
const argv = process.argv.filter((a) => a !== '--json');
(0, output_1.setJsonMode)(argv.length !== process.argv.length);
/**
 * Options that take a value, so the token after them is data and must never be
 * inspected as if it were a command argument.
 */
const VALUE_OPTIONS = new Set([
    '--pass',
    '--cloud-token',
    '--json-body',
    '--topic',
    '--filter',
    '--params',
    '--user',
    '--ip',
    '--port',
    '--cloud-url',
    '--timeout',
    '--subnet',
    '-t',
    '--channel',
    '-c',
    '--concurrency',
    '-j',
]);
/**
 * Catch the zsh trailing-comment trap before commander turns it into a baffling
 * "too many arguments" error.
 *
 * Interactive zsh does not treat `#` as starting a comment, so pasting
 * `axis caps cam1   # check the ACAP line` passes every word after the `#` as an
 * argument. Commander then reports "Expected 1 argument but got 9", which says
 * nothing about the actual cause. Worse, backticks inside such a comment get run
 * as command substitution.
 *
 * Matched narrowly, because `#` is legitimate in plenty of arguments: a password
 * (`--pass '#Str0ng!'`), a preset or playlist name (`'#1 Entrance'`), an overlay
 * field value (`label=#1`). A real shell comment always arrives as a token that is
 * either exactly `#` or begins `# ` — nothing else opens a comment — so that is
 * all we look for, and values belonging to an option are skipped outright.
 */
function looksLikeShellComment(token) {
    return token === '#' || /^#\s/.test(token);
}
const commentIndex = argv.findIndex((a, i) => i >= 2 && looksLikeShellComment(a) && !VALUE_OPTIONS.has(argv[i - 1]));
if (commentIndex !== -1) {
    (0, output_1.fail)(`Unexpected argument "${argv[commentIndex]}".\n\n` +
        '  This looks like a trailing "# comment" that your shell did not strip. Interactive zsh\n' +
        '  does not treat # as a comment, so the rest of the line was passed as arguments.\n' +
        '  Re-run the command without the comment, or enable comments once per shell with:\n\n' +
        '      setopt interactive_comments');
    process.exit(1);
}
// Fixes B4: without this, any rejection escaping an action() wrapper became an
// unhandled rejection and Node printed a raw stack trace.
program.parseAsync(argv).catch((err) => {
    (0, output_1.fail)(err.message);
    process.exit(1);
});
