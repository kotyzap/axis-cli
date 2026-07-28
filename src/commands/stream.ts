import { Command } from 'commander';
import { CamStreamerAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, ok, printJson } from '../output';

export function registerStreamCommands(program: Command) {
    const stream = program.command('stream').description('Control CamStreamer streams (RTMP/HLS/SRT/MPEG-TS)');

    stream
        .command('show <name> <streamId>')
        .description('Show a stream\'s configuration and status')
        .action(
            action(async (name: string, streamId: string) => {
                const cam = getCamera(name);
                const cs = new CamStreamerAPI(buildClient(cam) as any);
                const data = await cs.getStream(streamId);
                printJson(data);
            })
        );

    stream
        .command('start <name> <streamId>')
        .description('Enable/start a stream by ID')
        .action(
            action(async (name: string, streamId: string) => {
                const cam = getCamera(name);
                const cs = new CamStreamerAPI(buildClient(cam) as any);
                await cs.setStreamEnabled(streamId, true);
                ok(`Started stream ${streamId} on "${name}"`);
            })
        );

    stream
        .command('stop <name> <streamId>')
        .description('Disable/stop a stream by ID')
        .action(
            action(async (name: string, streamId: string) => {
                const cam = getCamera(name);
                const cs = new CamStreamerAPI(buildClient(cam) as any);
                await cs.setStreamEnabled(streamId, false);
                ok(`Stopped stream ${streamId} on "${name}"`);
            })
        );
}
