"use strict";
/**
 * Find Axis cameras on the local network without a saved profile.
 *
 * The classic broadcast-based "Axis IP Utility" trick (SSDP/UPnP/mDNS) is
 * unreliable on modern devices: AXIS OS 11/12.x commonly ships with multicast
 * discovery disabled by default. This instead sweeps the local subnet for open
 * web ports and asks each one who it is via the VAPIX Basic Device Info API,
 * which most Axis firmware answers without any credentials at all.
 *
 * Two-tier identification, same idea as capability detection elsewhere in this
 * CLI: prefer the strong signal, fall back to a weaker one rather than reporting
 * nothing.
 *
 *   1. **Confirmed** — `getDeviceInfo()` (src/vapix/deviceinfo.ts) succeeds,
 *      which means either basicdeviceinfo.cgi answered or param.cgi returned a
 *      Brand/Properties group. Both are Axis-specific paths, so a non-Axis web
 *      server on the same port (a router, a NAS, a printer) throws instead —
 *      param.cgi 404s there — and is silently excluded rather than misreported.
 *   2. **Possible (MAC match only)** — the host has an open web port but
 *      declined identification (Basic Device Info disabled, or a custom auth
 *      scheme in front of it), and its MAC prefix is one Axis Communications AB
 *      has registered. Listed separately since it is a weaker signal.
 *
 * `--add` turns a scan into a one-shot setup: for each confirmed camera that
 * isn't already a saved profile, it asks yes/no, then a name/user/password,
 * and calls the same `addCamera()` that `axis camera add` uses. Only
 * confirmed cameras are offered — a MAC-only "possible" match hasn't actually
 * answered as an Axis device, so guessing a profile for it risks saving
 * against the wrong host.
 *
 * Reference: https://developer.axis.com/vapix/network-video/basic-device-information/
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSubnet = defaultSubnet;
exports.hostsInSubnet = hostsInSubnet;
exports.isAxisIdentity = isAxisIdentity;
exports.isAxisMac = isAxisMac;
exports.suggestProfileName = suggestProfileName;
exports.registerDiscoveryCommands = registerDiscoveryCommands;
const net = __importStar(require("net"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const chalk_1 = __importDefault(require("chalk"));
const core_1 = require("../vapix/core");
const deviceinfo_1 = require("../vapix/deviceinfo");
const client_1 = require("../client");
const config_1 = require("../config");
const output_1 = require("../output");
const util_2 = require("../util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * Registered OUI prefixes for Axis Communications AB (source: IEEE OUI
 * registry, checked 2026-07). Axis has registered more over the years than
 * this; treat a miss here as "unknown", never as "not Axis".
 */
const AXIS_OUI_PREFIXES = new Set(['00:40:8c', 'ac:cc:8e', 'b8:a4:4f', 'e8:27:25']);
/**
 * Guess the local /24 from the first non-internal IPv4 interface.
 *
 * Picks whichever adapter Node lists first, which on a machine with several
 * active interfaces (Wi-Fi, Ethernet, a VPN) may not be the one the camera is
 * actually on — pass --subnet explicitly in that case.
 */
function defaultSubnet() {
    for (const addrs of Object.values(os.networkInterfaces())) {
        for (const addr of addrs ?? []) {
            if (addr.family === 'IPv4' && !addr.internal) {
                const parts = addr.address.split('.');
                return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
            }
        }
    }
    throw new Error('Could not auto-detect a local IPv4 subnet (no active network interface found). ' +
        'Pass one explicitly, e.g. --subnet 192.168.1.0/24.');
}
/**
 * Every usable host address in a CIDR range (network and broadcast excluded).
 * /16 through /30 only — anything broader is almost certainly a typo, and a
 * /31 or /32 has no usable host range under this network+broadcast model.
 */
function hostsInSubnet(cidr) {
    const match = cidr.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
    if (!match) {
        throw new Error(`Invalid subnet "${cidr}" — expected CIDR notation, e.g. 192.168.1.0/24.`);
    }
    const octets = match.slice(1, 5).map((o) => parseInt(o, 10));
    const bits = parseInt(match[5], 10);
    if (octets.some((o) => o > 255) || bits < 16 || bits > 30) {
        throw new Error(`Invalid subnet "${cidr}" — octets must be 0-255 and the prefix must be /16-/30 (got /${bits}).`);
    }
    const ipNum = (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
    const hostBits = 32 - bits;
    const size = 2 ** hostBits;
    const network = (ipNum >>> hostBits) << hostBits;
    const hosts = [];
    for (let i = 1; i < size - 1; i++) {
        const n = (network + i) >>> 0;
        hosts.push([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return hosts;
}
function portOpen(ip, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const finish = (result) => {
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, ip);
    });
}
/** Which of 443/80 is open — https preferred, since that is the AXIS OS 11+ default. */
async function findOpenScheme(ip, timeoutMs) {
    const [https, http] = await Promise.all([portOpen(ip, 443, timeoutMs), portOpen(ip, 80, timeoutMs)]);
    if (https)
        return { ip, scheme: 'https', port: 443 };
    if (http)
        return { ip, scheme: 'http', port: 80 };
    return null;
}
/**
 * Ask a candidate host who it is. Returns null for anything that is not
 * identifiable as an Axis device — including a non-Axis web server, which
 * throws inside getDeviceInfo's param.cgi fallback (see the module docstring).
 */
async function identify(candidate, creds, timeoutMs) {
    const profile = {
        name: 'discovery-probe',
        ip: candidate.ip,
        port: candidate.port,
        // getAllUnrestrictedProperties is documented as callable with no
        // credentials at all, so an empty user/pass is the common case here —
        // --user/--pass only matter on a device that has anonymous Basic
        // Device Info turned off (possible from AXIS OS 12.0 on).
        user: creds.user ?? '',
        pass: creds.pass ?? '',
        tls: candidate.scheme === 'https',
        tlsInsecure: true,
    };
    const core = new core_1.VapixCore((0, client_1.buildTransport)(profile));
    try {
        return await (0, deviceinfo_1.getDeviceInfo)(core, { timeout: timeoutMs });
    }
    catch {
        return null;
    }
}
function isAxisIdentity(deviceInfo) {
    return deviceInfo.source === 'basicdeviceinfo.cgi' || (!!deviceInfo.brand && /axis/i.test(deviceInfo.brand));
}
async function arpTable() {
    const table = new Map();
    try {
        const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 5000 });
        // macOS/Linux: "hostname (192.168.1.23) at ac:cc:8e:12:34:56 on en0 ..."
        for (const line of stdout.split('\n')) {
            const m = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-fA-F:]{11,17})/);
            if (m)
                table.set(m[1], m[2].toLowerCase());
        }
    }
    catch {
        // `arp` missing or unsupported on this OS — the MAC-vendor fallback
        // just won't have data; confirmed identification is unaffected.
    }
    return table;
}
function isAxisMac(mac) {
    return AXIS_OUI_PREFIXES.has(mac.slice(0, 8).toLowerCase());
}
/**
 * Turn a found camera into a proposed profile name: "AXIS Q1656" -> "q1656",
 * falling back to the IP when there's no model, and de-duplicated against
 * whatever profile names already exist so the caller can accept it as-is.
 */
function suggestProfileName(cam, existingNames) {
    const base = (cam.model || cam.ip)
        .toLowerCase()
        .replace(/^axis\s+/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'camera';
    if (!existingNames.has(base))
        return base;
    for (let i = 2;; i++) {
        const candidate = `${base}-${i}`;
        if (!existingNames.has(candidate))
            return candidate;
    }
}
async function scanNetwork(opts) {
    const subnet = opts.subnet ?? defaultSubnet();
    const hosts = hostsInSubnet(subnet);
    opts.onProgress?.(`Scanning ${subnet} (${hosts.length} hosts) on ports 443/80 ...`);
    // Phase 1: which hosts even have a web server up. Cheap TCP connects, so
    // the full /24 is fine at reasonable concurrency.
    const openHosts = [];
    for (let i = 0; i < hosts.length; i += opts.concurrency) {
        const batch = hosts.slice(i, i + opts.concurrency);
        const results = await Promise.all(batch.map((ip) => findOpenScheme(ip, opts.timeout)));
        for (const r of results)
            if (r)
                openHosts.push(r);
    }
    // Phase 2: identify only the hosts that answered at all.
    const confirmed = [];
    const unconfirmedOpen = [];
    for (let i = 0; i < openHosts.length; i += opts.concurrency) {
        const batch = openHosts.slice(i, i + opts.concurrency);
        const results = await Promise.all(batch.map(async (candidate) => ({
            candidate,
            device: await identify(candidate, { user: opts.user, pass: opts.pass }, opts.timeout),
        })));
        for (const { candidate, device } of results) {
            if (device && isAxisIdentity(device)) {
                confirmed.push({
                    ip: candidate.ip,
                    port: candidate.port,
                    tls: candidate.scheme === 'https',
                    model: device.productShortName ?? device.productNumber ?? '',
                    serial: device.serialNumber ?? '',
                    firmware: device.firmwareVersion ?? '',
                    mac: '',
                    confidence: 'confirmed',
                });
            }
            else {
                unconfirmedOpen.push(candidate.ip);
            }
        }
    }
    const arp = await arpTable();
    for (const cam of confirmed)
        cam.mac = arp.get(cam.ip) ?? '';
    const confirmedIps = new Set(confirmed.map((c) => c.ip));
    const possible = unconfirmedOpen
        .filter((ip) => !confirmedIps.has(ip))
        .map((ip) => ({ ip, mac: arp.get(ip) ?? '' }))
        .filter((h) => isAxisMac(h.mac));
    confirmed.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    possible.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    return { subnet, confirmed, possible };
}
/**
 * Interactively offer to save each newly-found camera as a profile.
 * Skips anything whose IP is already a saved profile.
 */
async function offerToAdd(confirmed) {
    const saved = (0, config_1.listCameras)();
    const existingNames = new Set(saved.map((c) => c.name));
    const savedIps = new Set(saved.map((c) => c.ip));
    const candidates = confirmed.filter((c) => !savedIps.has(c.ip));
    if (candidates.length === 0) {
        if (confirmed.length > 0)
            (0, output_1.info)('Every confirmed camera is already a saved profile — nothing to add.');
        return;
    }
    console.log('');
    for (const cam of candidates) {
        const label = cam.model ? `${cam.model} at ${cam.ip}` : cam.ip;
        let wants;
        try {
            wants = await (0, util_2.promptYesNo)(`Add ${label}?`, true);
        }
        catch (err) {
            // Ctrl+C during the prompt: stop the whole loop, not just this camera.
            throw err;
        }
        if (!wants)
            continue;
        try {
            const suggested = suggestProfileName(cam, existingNames);
            const name = await (0, util_2.promptLine)('  Profile name', suggested);
            if (existingNames.has(name)) {
                (0, output_1.warn)(`  A profile named "${name}" already exists — skipping ${cam.ip}. Re-run to try another name.`);
                continue;
            }
            const user = await (0, util_2.promptLine)('  Username', 'root');
            const pass = await (0, util_2.resolveSecret)(undefined, 'AXIS_PASS', `  Password for ${user}@${cam.ip}: `);
            if (!pass) {
                (0, output_1.warn)(`  No password given — skipping ${cam.ip}.`);
                continue;
            }
            (0, config_1.addCamera)({ name, ip: cam.ip, port: cam.port, user, pass, tls: cam.tls, tlsInsecure: true });
            existingNames.add(name);
            (0, output_1.ok)(`  Saved camera profile "${name}" (${cam.ip}) to ${(0, config_1.configPath)()}`);
        }
        catch (err) {
            // A per-camera failure (bad input, unexpected error) shouldn't abort
            // the rest of the batch — only Ctrl+C (rethrown above) does that.
            (0, output_1.warn)(`  Could not save a profile for ${cam.ip}: ${err.message}`);
        }
    }
}
function registerDiscoveryCommands(program) {
    program
        .command('discovery')
        .alias('discover')
        .description('Scan the local network for Axis cameras — no saved profile needed')
        .option('--subnet <cidr>', 'CIDR to scan, e.g. 192.168.1.0/24 (default: auto-detect your /24)')
        .option('-t, --timeout <ms>', 'Per-host timeout in milliseconds', '800')
        .option('-j, --concurrency <n>', 'How many hosts to probe in parallel', '64')
        .option('--user <user>', 'Credentials to try if anonymous Basic Device Info is disabled')
        .option('--pass <pass>', 'Password to go with --user')
        .option('--add', 'After scanning, interactively offer to save each new camera as a profile', false)
        .action((0, output_1.action)(async (opts) => {
        if (opts.add && (0, output_1.isJsonMode)()) {
            throw new Error('--add is interactive and cannot be combined with --json.');
        }
        if (opts.add && !process.stdin.isTTY) {
            throw new Error('--add needs an interactive terminal to ask yes/no and read a name/password. ' +
                'Run without --add to just list what was found, or use "axis camera add" directly.');
        }
        const timeout = (0, util_2.parseIntOrThrow)(opts.timeout, 'timeout', { min: 50 });
        const concurrency = (0, util_2.parseIntOrThrow)(opts.concurrency, 'concurrency', { min: 1, max: 256 });
        const { subnet, confirmed, possible } = await scanNetwork({
            subnet: opts.subnet,
            timeout,
            concurrency,
            user: opts.user,
            pass: opts.pass,
            onProgress: (0, output_1.isJsonMode)() ? undefined : (msg) => (0, output_1.info)(msg),
        });
        if ((0, output_1.isJsonMode)()) {
            (0, output_1.printJson)({ subnet, confirmed, possible });
            return;
        }
        if (confirmed.length === 0 && possible.length === 0) {
            (0, output_1.info)('No Axis cameras found.');
            (0, output_1.info)('Make sure this machine is on the same subnet/VLAN as the camera, that it has ' +
                'finished booting, and that it is not on a non-default HTTP(S) port.');
            return;
        }
        if (confirmed.length > 0) {
            (0, output_1.printTable)(['IP', 'Model', 'Serial', 'Firmware', 'MAC'], confirmed.map((c) => [c.ip, c.model || '-', c.serial || '-', c.firmware || '-', c.mac || '-']));
        }
        if (possible.length > 0) {
            console.log('');
            console.log(chalk_1.default.yellow('Possible Axis devices (MAC vendor match only — unconfirmed):'));
            for (const h of possible)
                console.log(`  ${h.ip.padEnd(16)}${h.mac}`);
            (0, output_1.info)('These answered on port 80/443 but declined identification — Basic Device Info may be');
            (0, output_1.info)('disabled, or a non-default account is required. Try adding them with credentials:');
            (0, output_1.info)('  axis camera add <name> --ip <ip> --user root --pass <pass>, then "axis info <name>"');
        }
        if (opts.add) {
            await offerToAdd(confirmed);
        }
        else if (confirmed.length > 0) {
            (0, output_1.info)('Add one with: axis camera add <name> --ip <ip> --user root');
            (0, output_1.info)('...or scan and add interactively with: axis discovery --add');
        }
    }));
}
