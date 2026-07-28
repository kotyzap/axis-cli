"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStreamCommands = registerStreamCommands;
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function registerStreamCommands(program) {
    const stream = program.command('stream').description('Control CamStreamer streams (RTMP/HLS/SRT/MPEG-TS)');
    stream
        .command('show <name> <streamId>')
        .description('Show a stream\'s configuration and status')
        .action((0, output_1.action)(async (name, streamId) => {
        const cam = (0, config_1.getCamera)(name);
        const cs = new camstreamerlib_1.CamStreamerAPI((0, client_1.buildClient)(cam));
        const data = await cs.getStream(streamId);
        (0, output_1.printJson)(data);
    }));
    stream
        .command('start <name> <streamId>')
        .description('Enable/start a stream by ID')
        .action((0, output_1.action)(async (name, streamId) => {
        const cam = (0, config_1.getCamera)(name);
        const cs = new camstreamerlib_1.CamStreamerAPI((0, client_1.buildClient)(cam));
        await cs.setStreamEnabled(streamId, true);
        (0, output_1.ok)(`Started stream ${streamId} on "${name}"`);
    }));
    stream
        .command('stop <name> <streamId>')
        .description('Disable/stop a stream by ID')
        .action((0, output_1.action)(async (name, streamId) => {
        const cam = (0, config_1.getCamera)(name);
        const cs = new camstreamerlib_1.CamStreamerAPI((0, client_1.buildClient)(cam));
        await cs.setStreamEnabled(streamId, false);
        (0, output_1.ok)(`Stopped stream ${streamId} on "${name}"`);
    }));
}
