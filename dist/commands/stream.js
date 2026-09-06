"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStreamCommands = registerStreamCommands;
const camstreamerlib_1 = require("camstreamerlib");
const session_1 = require("../session");
const client_1 = require("../client");
const acap_guard_1 = require("../acap-guard");
const output_1 = require("../output");
const util_1 = require("../util");
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
function registerStreamCommands(program) {
    const stream = program.command('stream').description('Control CamStreamer streams (RTMP/HLS/SRT/MPEG-TS)');
    /**
     * These calls reach the CamStreamer ACAP's own HTTP API rather than camera
     * firmware, so withAcap turns "the ACAP isn't installed or isn't running" —
     * indistinguishable from an unreachable host at the transport level — into an
     * error that says which of the two it is.
     */
    const api = (name) => {
        const cam = (0, session_1.openCamera)(name);
        return { cam, cs: new camstreamerlib_1.CamStreamerAPI((0, client_1.buildClient)(cam.profile)) };
    };
    stream
        .command('list <name>')
        .alias('ls')
        .description('List configured streams')
        .action((0, output_1.action)(async (name) => {
        const { cam, cs } = api(name);
        const streams = (await (0, acap_guard_1.withAcap)(cam, 'CamStreamer', () => cs.getStreamList()));
        (0, output_1.printTable)(['Stream ID', 'Title', 'Platform', 'Enabled', 'Active'], streams.map((s) => [
            // Every cell gets a fallback: a missing streamId used to print
            // the literal string "undefined".
            s.streamId ?? '-',
            s.title || '-',
            s.platform ?? '-',
            s.enabled ? 'yes' : 'no',
            s.active ? 'yes' : 'no',
        ]), streams.map((s) => ({
            streamId: s.streamId,
            title: s.title,
            platform: s.platform,
            enabled: !!s.enabled,
            active: !!s.active,
        })));
    }));
    stream
        .command('show <name> <streamId>')
        .description("Show a stream's configuration and status")
        .action((0, output_1.action)(async (name, streamId) => {
        const { cam, cs } = api(name);
        const data = await (0, acap_guard_1.withAcap)(cam, 'CamStreamer', () => cs.getStream(streamId));
        (0, output_1.printJson)(data);
    }));
    stream
        .command('start <name> <streamId>')
        .description('Enable/start a stream by ID')
        .option('-t, --timeout <ms>', 'How long to wait for the camera to respond', DEFAULT_START_TIMEOUT_MS)
        .action((0, output_1.action)(async (name, streamId, opts) => {
        const { cam, cs } = api(name);
        const timeout = (0, util_1.parseIntOrThrow)(opts.timeout, 'timeout', { min: 100 });
        await (0, acap_guard_1.withAcap)(cam, 'CamStreamer', () => cs.setStreamEnabled(streamId, true, { timeout }));
        (0, output_1.ok)(`Started stream ${streamId} on "${name}"`);
    }));
    stream
        .command('stop <name> <streamId>')
        .description('Disable/stop a stream by ID')
        .option('-t, --timeout <ms>', 'How long to wait for the camera to respond. Raise this if stopping an actively-publishing stream times out', DEFAULT_STOP_TIMEOUT_MS)
        .action((0, output_1.action)(async (name, streamId, opts) => {
        const { cam, cs } = api(name);
        const timeout = (0, util_1.parseIntOrThrow)(opts.timeout, 'timeout', { min: 100 });
        await (0, acap_guard_1.withAcap)(cam, 'CamStreamer', () => cs.setStreamEnabled(streamId, false, { timeout }));
        (0, output_1.ok)(`Stopped stream ${streamId} on "${name}"`);
    }));
}
