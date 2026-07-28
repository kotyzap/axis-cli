"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerEventsCommand = registerEventsCommand;
const node_1 = require("camstreamerlib/node");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function registerEventsCommand(program) {
    const events = program.command('events').description('Live VAPIX event stream');
    events
        .command('watch <name>')
        .description('Stream live VAPIX events from a camera until Ctrl+C (motion, digital I/O, ACAP events, ...)')
        .action((name) => {
        const cam = (0, config_1.getCamera)(name);
        if (cam.cloudUrl) {
            throw new Error('Live event watching requires local network access (--ip), not a CamStreamer Cloud profile.');
        }
        const events = new node_1.VapixEvents((0, client_1.connectionOptions)(cam));
        (0, output_1.info)(`Connecting to "${name}" for live events... (Ctrl+C to stop)`);
        events.on('event', (event) => {
            console.log(`[${new Date().toISOString()}]`, JSON.stringify(event));
        });
        events.connect();
        process.on('SIGINT', () => {
            events.disconnect();
            (0, output_1.ok)('Disconnected.');
            process.exit(0);
        });
    });
}
