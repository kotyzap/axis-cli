#!/usr/bin/env node
import { Command } from 'commander';
import { registerCameraCommands } from './commands/camera';
import { registerDiscoveryCommands } from './commands/discovery';
import { registerInfoCommand } from './commands/info';
import { registerCapsCommand } from './commands/caps';
import { registerParamCommands } from './commands/param';
import { registerPtzCommands } from './commands/ptz';
import { registerAppsCommands } from './commands/apps';
import { registerOverlayCommands } from './commands/overlay';
import { registerStreamCommands } from './commands/stream';
import { registerSwitcherCommands } from './commands/switcher';
import { registerFleetCommands } from './commands/fleet';
import { registerPreflightCommands } from './commands/preflight';
import { registerSystemCommands } from './commands/system';
import { registerRawCommands } from './commands/raw';
import { registerEventsCommand } from './commands/events';
import { fail, setJsonMode } from './output';

const pkg = require('../package.json');

const program = new Command();

program
    .name('axis')
    .description(
        'CLI for controlling Axis IP cameras — VAPIX, CamOverlay, CamStreamer, CamSwitcher, and fleet health.\n' +
            'Firmware-universal: capabilities are probed per device, from firmware 5.x through AXIS OS 12.x.'
    )
    .version(pkg.version)
    .option('--json', 'Emit machine-readable JSON instead of tables and status messages')
    // Fixes B5: print usage on error and suggest the nearest matching command.
    .showHelpAfterError('(run "axis <command> --help" for usage)')
    .showSuggestionAfterError(true);

registerCameraCommands(program);
registerDiscoveryCommands(program);
registerInfoCommand(program);
registerCapsCommand(program);
registerParamCommands(program);
registerPtzCommands(program);
registerAppsCommands(program);
registerOverlayCommands(program);
registerStreamCommands(program);
registerSwitcherCommands(program);
registerFleetCommands(program);
registerPreflightCommands(program);
registerSystemCommands(program);
registerRawCommands(program);
registerEventsCommand(program);

// Strip --json anywhere in argv so it works before or after the subcommand,
// rather than only immediately after "axis".
const argv = process.argv.filter((a) => a !== '--json');
setJsonMode(argv.length !== process.argv.length);

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
function looksLikeShellComment(token: string): boolean {
    return token === '#' || /^#\s/.test(token);
}

const commentIndex = argv.findIndex(
    (a, i) => i >= 2 && looksLikeShellComment(a) && !VALUE_OPTIONS.has(argv[i - 1])
);
if (commentIndex !== -1) {
    fail(
        `Unexpected argument "${argv[commentIndex]}".\n\n` +
            '  This looks like a trailing "# comment" that your shell did not strip. Interactive zsh\n' +
            '  does not treat # as a comment, so the rest of the line was passed as arguments.\n' +
            '  Re-run the command without the comment, or enable comments once per shell with:\n\n' +
            '      setopt interactive_comments'
    );
    process.exit(1);
}

// Fixes B4: without this, any rejection escaping an action() wrapper became an
// unhandled rejection and Node printed a raw stack trace.
program.parseAsync(argv).catch((err: Error) => {
    fail(err.message);
    process.exit(1);
});
