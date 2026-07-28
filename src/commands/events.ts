import { Command } from 'commander';
import { VapixEvents } from 'camstreamerlib/node';
import { getCamera } from '../config';
import { connectionOptions } from '../client';
import { info, ok } from '../output';

export function registerEventsCommand(program: Command) {
    const events = program.command('events').description('Live VAPIX event stream');

    events
        .command('watch <name>')
        .description('Stream live VAPIX events from a camera until Ctrl+C (motion, digital I/O, ACAP events, ...)')
        .action((name: string) => {
            const cam = getCamera(name);
            if (cam.cloudUrl) {
                throw new Error('Live event watching requires local network access (--ip), not a CamStreamer Cloud profile.');
            }
            const events = new VapixEvents(connectionOptions(cam) as any);
            info(`Connecting to "${name}" for live events... (Ctrl+C to stop)`);
            events.on('event', (event: any) => {
                console.log(`[${new Date().toISOString()}]`, JSON.stringify(event));
            });
            events.connect();
            process.on('SIGINT', () => {
                events.disconnect();
                ok('Disconnected.');
                process.exit(0);
            });
        });
}
