#!/usr/bin/env node
import { Command } from 'commander';
import { registerCameraCommands } from './commands/camera';
import { registerInfoCommand } from './commands/info';
import { registerParamCommands } from './commands/param';
import { registerPtzCommands } from './commands/ptz';
import { registerAppsCommands } from './commands/apps';
import { registerOverlayCommands } from './commands/overlay';
import { registerStreamCommands } from './commands/stream';
import { registerSwitcherCommands } from './commands/switcher';
import { registerFleetCommands } from './commands/fleet';
import { registerRawCommands } from './commands/raw';
import { registerEventsCommand } from './commands/events';

const program = new Command();

program
    .name('axis')
    .description('CLI for controlling Axis IP cameras: VAPIX, CamOverlay, CamStreamer, CamSwitcher, and fleet health')
    .version('1.0.0');

registerCameraCommands(program);
registerInfoCommand(program);
registerParamCommands(program);
registerPtzCommands(program);
registerAppsCommands(program);
registerOverlayCommands(program);
registerStreamCommands(program);
registerSwitcherCommands(program);
registerFleetCommands(program);
registerRawCommands(program);
registerEventsCommand(program);

program.parseAsync(process.argv);
