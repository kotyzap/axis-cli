import { Command } from 'commander';
import { VapixEvents } from 'camstreamerlib/node';
import { openCamera } from '../session';
import { connectionOptions } from '../client';
import { action, fail, info, ok, printTable, isJsonMode } from '../output';
import { UnsupportedError } from '../vapix/core';
import { parseIntOrThrow } from '../util';

/**
 * ONVIF topic expression matching every topic the camera publishes.
 * Used when the caller doesn't narrow things down with --topic.
 */
const ALL_TOPICS = '//.';

/**
 * VapixEvents derives the camera-side `eventFilterList` from its own registered
 * listener names: every non-reserved name you pass to `.on()` is sent verbatim
 * as a `topicFilter`. So the listener name *is* the subscription — it has to be
 * a real ONVIF topic expression, not a label of our choosing.
 *
 * This is what the original `stream.on('event', ...)` got wrong: it asked the
 * camera to subscribe to a topic literally called "event", and the camera
 * answered "Could not use supplied event filter".
 *
 * Because the camera then emits under the *concrete* topic
 * ("tns1:VideoSource/tnsaxis:DayNightVision"), a wildcard listener would never
 * fire. `onAny()` is how we actually receive them, and it doesn't register a
 * name, so it can't pollute the filter list.
 */
function subscribe(stream: any, topics: string[], onEvent: (topic: string, payload: unknown) => void) {
    for (const topic of topics) {
        stream.on(topic, () => {
            /* Registers the topicFilter only; delivery happens via onAny. */
        });
    }
    // VapixEvents emits its own lifecycle signals through the same emitter, and
    // onAny sees those too — without this guard, connecting printed a spurious
    // "(unknown) (no data)" line for the 'open' event.
    const LIFECYCLE = new Set(['open', 'close', 'error']);
    stream.onAny((topic: string, payload: unknown) => {
        if (LIFECYCLE.has(topic)) return;
        onEvent(topic, payload);
    });
}

/**
 * Render one field value for the human-readable event line.
 *
 * `String(v)` is not enough: an event whose data is a nested object printed
 * `coords=[object Object]`, silently discarding the payload the user was watching
 * for. Non-scalars are JSON-encoded instead, which is ugly but true.
 */
function renderValue(v: unknown): string {
    if (v === null) return 'null';
    if (v === undefined) return '';
    if (typeof v === 'object') {
        try {
            return JSON.stringify(v);
        } catch {
            return '(unprintable)';
        }
    }
    return String(v);
}

/**
 * Pull the interesting fields out of an events:notify payload.
 *
 * Deliberately never fabricates a timestamp. The previous version fell back to
 * `new Date()` whenever `timestamp` was not a number — which happens for an ISO
 * string or a seconds-based value — stamping the line with the current wall clock
 * and giving no hint it was invented. For a log of when things happened, a
 * plausible-looking wrong time is worse than an admission of ignorance.
 */
export function summarise(payload: any): { timestamp: string; topic: string; detail: string } {
    const n = payload?.params?.notification ?? {};

    let timestamp: string;
    if (typeof n.timestamp === 'number' && Number.isFinite(n.timestamp)) {
        // Milliseconds since the epoch, per the API. A value small enough to be
        // seconds would land in 1970, so treat that as seconds instead.
        const ms = n.timestamp < 1e11 ? n.timestamp * 1000 : n.timestamp;
        const d = new Date(ms);
        timestamp = Number.isNaN(d.getTime()) ? '(bad timestamp)' : d.toISOString();
    } else if (typeof n.timestamp === 'string' && n.timestamp.trim() !== '') {
        // An ISO string, or something we can at least echo verbatim.
        const d = new Date(n.timestamp);
        timestamp = Number.isNaN(d.getTime()) ? n.timestamp : d.toISOString();
    } else {
        timestamp = '(no timestamp)';
    }

    const message = n.message;
    const parts: string[] = [];
    for (const section of ['source', 'key', 'data'] as const) {
        const value = message?.[section];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'object' || Array.isArray(value)) {
            // A scalar where an object was expected. Iterating it with
            // Object.entries turned a string into "0=h 1=e 2=l ...".
            parts.push(`${section}=${renderValue(value)}`);
            continue;
        }
        for (const [k, v] of Object.entries(value)) parts.push(`${k}=${renderValue(v)}`);
    }

    const topic = typeof n.topic === 'string' && n.topic ? n.topic : '(unknown)';
    return { timestamp, topic, detail: parts.join(' ') || '(no data)' };
}

export function registerEventsCommand(program: Command) {
    const events = program.command('events').description('Live VAPIX event stream');

    events
        .command('watch <name>')
        .description('Stream live VAPIX events from a camera until Ctrl+C (motion, digital I/O, ACAP events, ...)')
        .option(
            '--topic <filter>',
            'ONVIF topic filter to subscribe to; repeatable. Default: //. (everything)',
            (value: string, previous: string[]) => previous.concat([value]),
            [] as string[]
        )
        .option('--raw', 'Print the full JSON payload of each event instead of a one-line summary', false)
        // Fixes B2: this was the only handler not wrapped, so failures printed a
        // raw stack trace and still exited 0.
        .action(
            action(async (name: string, opts) => {
                const cam = openCamera(name);
                if (cam.profile.cloudUrl) {
                    throw new Error(
                        'Live event watching requires local network access (--ip), not a CamStreamer Cloud profile.'
                    );
                }

                // The WebSocket data stream is the transport VapixEvents uses, and it
                // only arrived in AXIS OS 10.11. Without this check an older camera
                // fails the handshake and the user sees a bare socket error with no
                // hint that the firmware, not the network or the credentials, is the
                // problem. Topic *listing* uses SOAP and still works there, so point
                // at it rather than leaving them stuck.
                const caps = await cam.caps();
                if (!caps.events.websocket) {
                    throw new UnsupportedError(
                        `Camera "${name}" runs firmware ${caps.firmware.raw || 'of an unknown version'}, which does ` +
                            'not support event streaming over WebSocket — the transport live watching needs.',
                        {
                            requires: 'AXIS OS 10.11 or later',
                            firmware: caps.firmware,
                            docs: 'https://developer.axis.com/vapix/network-video/event-streaming-over-websocket/',
                            alternative: `axis events topics ${name}`,
                        }
                    );
                }

                const topics: string[] = opts.topic.length > 0 ? opts.topic : [ALL_TOPICS];
                const stream = new VapixEvents(connectionOptions(cam.profile) as any);

                info(
                    `Connecting to "${name}" for live events — ${
                        topics.length === 1 && topics[0] === ALL_TOPICS
                            ? 'all topics'
                            : topics.map((t) => `"${t}"`).join(', ')
                    }... (Ctrl+C to stop)`
                );

                subscribe(stream, topics, (topic, payload) => {
                    if (opts.raw || isJsonMode()) {
                        console.log(JSON.stringify(payload));
                        return;
                    }
                    const s = summarise(payload);
                    console.log(`${s.timestamp}  ${s.topic}  ${s.detail}`);
                    void topic;
                });

                stream.on('open', () => ok('Subscribed. Waiting for events...'));

                // An 'error' listener is mandatory on an EventEmitter — without one,
                // a connection failure would crash the process with a raw trace.
                stream.on('error', (err: any) => {
                    // events:configure rejections arrive as the API's error object
                    // ({code, message}), not an Error instance.
                    const message = err?.message ?? String(err);
                    fail(`Event stream error on "${name}": ${message}`);

                    // Everything below goes to stderr alongside fail(), not through
                    // info() — mixing the two interleaves unpredictably because they
                    // write to different streams.
                    if (/event filter/i.test(message) && !isJsonMode()) {
                        const usedDefault = topics.length === 1 && topics[0] === ALL_TOPICS;
                        console.error('');
                        console.error(
                            usedDefault
                                ? `  This camera rejected the catch-all filter "${ALL_TOPICS}". Subscribe to`
                                : '  The camera rejected one of the topic filters you supplied. Check them'
                        );
                        console.error(usedDefault ? '  specific topics instead:' : '  against what the camera publishes:');
                        console.error('');
                        console.error(`      axis events topics ${name}`);
                        console.error(
                            `      axis events watch ${name} --topic 'tns1:VideoSource/tnsaxis:DayNightVision'`
                        );
                        console.error('');
                        console.error(
                            "  Topic filters are ONVIF topic expressions. A trailing '//.' matches"
                        );
                        console.error("  everything below a branch, e.g. --topic 'tns1:Device//.'");
                    }
                    process.exit(1);
                });

                stream.connect();

                process.on('SIGINT', () => {
                    stream.disconnect();
                    ok('Disconnected.');
                    process.exit(0);
                });
            })
        );

    events
        .command('topics <name>')
        .alias('list')
        .description('List the event topics this camera publishes, for use with "events watch --topic"')
        .option('--filter <substring>', 'Only show topics containing this text (case-insensitive)')
        .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '15000')
        .action(
            action(async (name: string, opts) => {
                const cam = openCamera(name);
                const client = cam.core.transport;

                const caps = await cam.caps();
                if (!caps.events.soap) {
                    throw new UnsupportedError(
                        `Camera "${name}" runs firmware ${caps.firmware.raw || 'of an unknown version'}, which ` +
                            'predates the event and action services used to enumerate topics.',
                        {
                            requires: 'firmware 5.50 or later',
                            firmware: caps.firmware,
                            docs: 'https://developer.axis.com/vapix/network-video/event-and-action-services/',
                        }
                    );
                }

                // GetEventInstances is a SOAP call, but it accepts a bare POST to
                // /vapix/services with the action in the header — no SOAP client needed.
                // This path works all the way back to firmware 5.50, which makes it the
                // only event introspection available on pre-10.11 cameras.
                const body =
                    '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">' +
                    '<s:Body><GetEventInstances xmlns="http://www.axis.com/vapix/ws/event1"/></s:Body>' +
                    '</s:Envelope>';

                const res = await (client as any).post({
                    path: '/vapix/services',
                    data: body,
                    headers: {
                        'Content-Type': 'application/soap+xml; charset=utf-8',
                        SOAPAction: 'http://www.axis.com/vapix/ws/event1/GetEventInstances',
                    },
                    // Passed explicitly: without it camstreamerlib's client applies its
                    // own hardcoded 10s, inconsistent with every other command here.
                    timeout: parseIntOrThrow(opts.timeout, 'timeout', { min: 100 }),
                });

                if (!res.ok) {
                    throw new Error(
                        `GetEventInstances failed with HTTP ${res.status}. ` +
                            'The account may lack the privilege, or the camera may not expose /vapix/services.'
                    );
                }

                const xml = await res.text();
                const topics = parseEventInstances(xml);

                if (topics.length === 0) {
                    throw new Error(
                        'The camera returned no event declarations. Try a raw call to inspect the response:\n' +
                            `  axis vapix post ${name} /vapix/services`
                    );
                }

                const needle = (opts.filter ?? '').toLowerCase();
                const shown = needle ? topics.filter((t) => t.toLowerCase().includes(needle)) : topics;

                if (shown.length === 0) {
                    throw new Error(`No topics matched "${opts.filter}". Run without --filter to see all ${topics.length}.`);
                }

                printTable(
                    ['Topic filter'],
                    shown.map((t) => [t]),
                    shown
                );
                if (!isJsonMode()) {
                    info(`${shown.length} topic${shown.length === 1 ? '' : 's'} — use one with:`);
                    console.log(`    axis events watch ${name} --topic '${shown[0]}'`);
                }
            })
        );
}

/**
 * Flatten the GetEventInstances topic tree into ONVIF topic expressions.
 *
 * The response nests elements inside <wstop:TopicSet> to form the topic path
 * and marks each subscribable leaf with wstop:topic="true":
 *
 *   <wstop:TopicSet>
 *     <tns1:VideoSource>
 *       <tnsaxis:DayNightVision wstop:topic="true"> ... </tnsaxis:DayNightVision>
 *
 * yields "tns1:VideoSource/tnsaxis:DayNightVision".
 *
 * Two details that a naive scan gets wrong:
 *
 *  - **Segments are not always prefixed.** ACAP events look like
 *    "tnsaxis:CameraApplicationPlatform/VMD/Camera1ProfileANY", where only the
 *    first segment carries a prefix. Filtering on "has a colon" silently
 *    mangles those, so instead we walk everything inside TopicSet and exclude
 *    the known metadata wrappers by name.
 *  - **aev:* subtrees describe the message shape, not the topic.** They nest
 *    arbitrarily deep and must not contribute path segments.
 *
 * Hand-scanned rather than pulling in an XML parser for one command; the
 * document is machine-generated, and we only care about element nesting.
 */
export function parseEventInstances(xml: string): string[] {
    const topics = new Set<string>();
    const path: string[] = [];

    /**
     * Metadata wrappers: present inside TopicSet but not part of any topic.
     *
     * Matched two ways, because a fixed prefix allow-list is not enough. A camera
     * using an unlisted prefix (or none at all) for `MessageInstance` used to have
     * those elements treated as topic path segments, inventing subscribable-looking
     * topics such as `tns1:A/axsev:MessageInstance/axsev:DataInstance`. The command
     * then printed one as a ready-to-paste example, and the camera rejected it with
     * "Could not use supplied event filter" — the exact confusion this command
     * exists to prevent.
     *
     * Every message-description element in the schema ends in "Instance", so the
     * local name is the reliable signal.
     */
    const WRAPPER_PREFIX = /^(aev|tt|wstop|wsnt|xsd|xsi):/i;
    const METADATA_LOCAL_NAME = /(^|:)(MessageInstance|SourceInstance|DataInstance|KeyInstance|SimpleItemInstance|ElementItemInstance)$/i;
    const isWrapperName = (qname: string) => WRAPPER_PREFIX.test(qname) || METADATA_LOCAL_NAME.test(qname);

    const clean = xml
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
        .replace(/<\?[\s\S]*?\?>/g, '');

    // Only the region inside TopicSet describes topics; the SOAP envelope around
    // it would otherwise contribute bogus leading segments.
    const start = clean.search(/<[\w.-]*:?TopicSet\b/);
    if (start === -1) return [];
    const region = clean.slice(start);

    const tag = /<(\/?)([A-Za-z_][\w.-]*(?::[\w.-]+)?)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
    let depth = 0; // nesting depth inside an aev:* metadata subtree

    let m: RegExpExecArray | null;
    while ((m = tag.exec(region)) !== null) {
        const [, closing, qname, attrs, selfClosing] = m;
        const isTopicSet = /(^|:)TopicSet$/.test(qname);
        const isWrapper = isWrapperName(qname);

        if (isTopicSet) continue;

        // Skip over metadata subtrees wholesale.
        if (depth > 0) {
            if (!selfClosing) depth += closing ? -1 : 1;
            continue;
        }
        if (isWrapper) {
            if (!closing && !selfClosing) depth = 1;
            continue;
        }

        if (closing) {
            if (path[path.length - 1] === qname) path.pop();
            continue;
        }

        path.push(qname);
        if (/wstop:topic\s*=\s*["']true["']/i.test(attrs) || /(^|\s)topic\s*=\s*["']true["']/i.test(attrs)) {
            topics.add(path.join('/'));
        }
        if (selfClosing) path.pop();
    }

    return [...topics].sort();
}
