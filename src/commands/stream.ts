import { Command } from 'commander';
import { CamStreamerAPI } from 'camstreamerlib';
import { openCamera } from '../session';
import { buildClient } from '../client';
import { withAcap } from '../acap-guard';
import { action, ok, printJson, printTable } from '../output';
import { parseIntOrThrow } from '../util';

/**
 * camstreamerlib hardcodes a 10s abort timeout when no `options.timeout` is
 * given (see HttpRequestSender.sendRequestWithAuth: `options.timeout ??= 10000`).
 * Starting a stream just flips a flag and returns immediately, but stopping one
 * that's actively publishing can take noticeably longer: the camera has to
 * gracefully tear down its encoder connection to the RTMP/HLS/SRT destination
 * before it answers, and that teardown is what set_stream_enabled.cgi waits on.
 * Hence a longer default here, and a flag to raise it further.
 */
const DEFAULT_START_TIMEOUT_MS = '10000';
const DEFAULT_STOP_TIMEOUT_MS = '20000';

export function registerStreamCommands(program: Command) {
    const stream = program.command('stream').description('Control CamStreamer streams (RTMP/HLS/SRT/MPEG-TS)');

    /**
     * These calls reach the CamStreamer ACAP's own HTTP API rather than camera
     * firmware, so withAcap turns "the ACAP isn't installed or isn't running" —
     * indistinguishable from an unreachable host at the transport level — into an
     * error that says which of the two it is.
     */
    const api = (name: string) => {
        const cam = openCamera(name);
        return { cam, cs: new CamStreamerAPI(buildClient(cam.profile) as any) };
    };

    stream
        .command('list <name>')
        .alias('ls')
        .description('List configured streams')
        .action(
            action(async (name: string) => {
                const { cam, cs } = api(name);
                const streams = (await withAcap(cam, 'CamStreamer', () => cs.getStreamList())) as any[];
                printTable(
                    ['Stream ID', 'Title', 'Platform', 'Enabled', 'Active'],
                    streams.map((s) => [
                        // Every cell gets a fallback: a missing streamId used to print
                        // the literal string "undefined".
                        s.streamId ?? '-',
                        s.title || '-',
                        s.platform ?? '-',
                        s.enabled ? 'yes' : 'no',
                        s.active ? 'yes' : 'no',
                    ]),
                    streams.map((s) => ({
                        streamId: s.streamId,
                        title: s.title,
                        platform: s.platform,
                        enabled: !!s.enabled,
                        active: !!s.active,
                    }))
                );
            })
        );

    stream
        .command('show <name> <streamId>')
        .description("Show a stream's configuration and status")
        .action(
            action(async (name: string, streamId: string) => {
                const { cam, cs } = api(name);
                const data = await withAcap(cam, 'CamStreamer', () => cs.getStream(streamId));
                printJson(data);
            })
        );

    stream
        .command('start <name> <streamId>')
        .description('Enable/start a stream by ID')
        .option('-t, --timeout <ms>', 'How long to wait for the camera to respond', DEFAULT_START_TIMEOUT_MS)
        .action(
            action(async (name: string, streamId: string, opts) => {
                const { cam, cs } = api(name);
                const timeout = parseIntOrThrow(opts.timeout, 'timeout', { min: 100 });
                await withAcap(cam, 'CamStreamer', () => cs.setStreamEnabled(streamId, true, { timeout }));
                ok(`Started stream ${streamId} on "${name}"`);
            })
        );

    stream
        .command('stop <name> <streamId>')
        .description('Disable/stop a stream by ID')
        .option(
            '-t, --timeout <ms>',
            'How long to wait for the camera to respond. Raise this if stopping an actively-publishing stream times out',
            DEFAULT_STOP_TIMEOUT_MS
        )
        .action(
            action(async (name: string, streamId: string, opts) => {
                const { cam, cs } = api(name);
                const timeout = parseIntOrThrow(opts.timeout, 'timeout', { min: 100 });
                await withAcap(cam, 'CamStreamer', () => cs.setStreamEnabled(streamId, false, { timeout }));
                ok(`Stopped stream ${streamId} on "${name}"`);
            })
        );
}
