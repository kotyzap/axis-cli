#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const camera_1 = require("./commands/camera");
const info_1 = require("./commands/info");
const param_1 = require("./commands/param");
const ptz_1 = require("./commands/ptz");
const apps_1 = require("./commands/apps");
const overlay_1 = require("./commands/overlay");
const stream_1 = require("./commands/stream");
const switcher_1 = require("./commands/switcher");
const fleet_1 = require("./commands/fleet");
const raw_1 = require("./commands/raw");
const events_1 = require("./commands/events");
const program = new commander_1.Command();
program
    .name('axis')
    .description('CLI for controlling Axis IP cameras: VAPIX, CamOverlay, CamStreamer, CamSwitcher, and fleet health')
    .version('1.0.0');
(0, camera_1.registerCameraCommands)(program);
(0, info_1.registerInfoCommand)(program);
(0, param_1.registerParamCommands)(program);
(0, ptz_1.registerPtzCommands)(program);
(0, apps_1.registerAppsCommands)(program);
(0, overlay_1.registerOverlayCommands)(program);
(0, stream_1.registerStreamCommands)(program);
(0, switcher_1.registerSwitcherCommands)(program);
(0, fleet_1.registerFleetCommands)(program);
(0, raw_1.registerRawCommands)(program);
(0, events_1.registerEventsCommand)(program);
program.parseAsync(process.argv);
