"use strict";
/**
 * Edge storage — /axis-cgi/disks/list.cgi
 *
 * Reference: https://developer.axis.com/vapix/network-video/edge-storage-api/
 *
 * Available since firmware 5.40, gated by `Properties.LocalStorage.LocalStorage`.
 * That parameter is the capability gate, not a legacy alternative: the CGI and
 * the parameter have coexisted since 5.40, and asking a device without a card
 * slot for its disks is what produces the unhelpful failures.
 *
 * Two shapes to tolerate:
 *  - `diskid=all` returns every disk, including `NetworkShare`. Requesting
 *    `SD_DISK` specifically fails outright on a device with no SD slot, so we ask
 *    for all and pick, which also surfaces network shares for free.
 *  - The docs warn, verbatim, that "some elements contain yes/no and some contain
 *    true/false" in the very same response — so booleans are parsed permissively.
 *
 * **Never report "no disks" as a result of a parse failure.** The response on a
 * device with no card slot is not documented, so "no disks in the reply" has to be
 * a legitimate outcome — which means it must not be reachable by a code path that
 * merely failed to understand the XML. A confidently-reported "no SD card" is the
 * single most misleading thing this file could say.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.asArray = void 0;
exports.parseDiskList = parseDiskList;
exports.supportsLocalStorage = supportsLocalStorage;
exports.listDisks = listDisks;
exports.findSdCard = findSdCard;
exports.formatKb = formatKb;
exports.describeSdCard = describeSdCard;
const xml_1 = require("./xml");
Object.defineProperty(exports, "asArray", { enumerable: true, get: function () { return xml_1.asArray; } });
const DISKS_LIST_CGI = '/axis-cgi/disks/list.cgi';
/**
 * Parse a disk listing, or null when the body could not be understood at all.
 *
 * null and `[]` mean different things and the distinction is load-bearing: `[]`
 * is "the camera says it has no disks", null is "we could not tell".
 */
function parseDiskList(body) {
    let doc;
    try {
        doc = xml_1.xmlParser.parse(body);
    }
    catch {
        return null;
    }
    if (typeof doc !== 'object' || doc === null)
        return null;
    // Searched by local name at any depth rather than via a fixed `root.disks.disk`
    // path, which broke on a namespaced root, a missing <disks> wrapper, and two
    // <disks> blocks — all of which then looked like "no SD card".
    const nodes = (0, xml_1.findElements)(doc, 'disk');
    // Nothing that looks like a disk listing at all: if there is no <disks>
    // wrapper either, this is probably an error page rather than an empty listing.
    if (nodes.length === 0 && (0, xml_1.findElements)(doc, 'disks').length === 0)
        return null;
    return nodes.flatMap((d) => {
        const id = (0, xml_1.str)((0, xml_1.attr)(d, 'diskid', 'id'));
        if (!id)
            return [];
        const raw = {};
        for (const [k, v] of Object.entries(d)) {
            const s = (0, xml_1.str)(v);
            if (s !== null)
                raw[k] = s;
        }
        return [
            {
                id,
                name: (0, xml_1.str)((0, xml_1.attr)(d, 'name')),
                status: (0, xml_1.str)((0, xml_1.attr)(d, 'status')),
                totalSizeKb: (0, xml_1.int)((0, xml_1.attr)(d, 'totalsize')),
                freeSizeKb: (0, xml_1.int)((0, xml_1.attr)(d, 'freesize')),
                filesystem: (0, xml_1.str)((0, xml_1.attr)(d, 'filesystem')),
                full: (0, xml_1.bool)((0, xml_1.attr)(d, 'full')),
                readOnly: (0, xml_1.bool)((0, xml_1.attr)(d, 'readonly')),
                locked: (0, xml_1.bool)((0, xml_1.attr)(d, 'locked')),
                encrypted: (0, xml_1.bool)((0, xml_1.attr)(d, 'diskencrypted', 'encrypted')),
                encryptionEnabled: (0, xml_1.bool)((0, xml_1.attr)(d, 'diskencryptionenabled', 'encryptionenabled')),
                raw,
            },
        ];
    });
}
function supportsLocalStorage(params) {
    // The documented gate is Properties.LocalStorage.LocalStorage=yes. A Version
    // parameter alone is not enough: a device can publish the version while
    // reporting LocalStorage=no, and calling disks/list.cgi on it only produces a
    // failure we would then have to explain away.
    return params.yes('Properties.LocalStorage.LocalStorage');
}
async function listDisks(core, params, options = {}) {
    if (!supportsLocalStorage(params))
        return { status: 'unsupported' };
    try {
        const disks = parseDiskList(await core.getText(DISKS_LIST_CGI, { diskid: 'all' }, options));
        if (disks === null) {
            return { status: 'error', error: 'the camera returned a disk listing that could not be parsed' };
        }
        return { status: 'ok', disks };
    }
    catch (err) {
        // Not propagated: storage is never the point of the command that called us,
        // so a storage problem must not fail an otherwise-good `info` or
        // `fleet health`. But it is reported rather than hidden.
        return { status: 'error', error: err.message };
    }
}
/** Just the SD card, the disk anyone actually asks about. */
function findSdCard(report) {
    if (report.status !== 'ok')
        return null;
    return report.disks.find((d) => d.id.toUpperCase() === 'SD_DISK') ?? null;
}
/** Human-readable size, from the CGI's kilobytes. */
function formatKb(kb) {
    if (kb === null)
        return '-';
    const units = ['kB', 'MB', 'GB', 'TB'];
    let value = kb;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
/** Disk statuses that mean the disk is present and its size figures are meaningful. */
const MOUNTED_STATUSES = new Set(['ok', 'connected']);
/**
 * One-line SD summary for tables. Each distinct outcome reads differently:
 *   "n/a"           — the device has no edge storage at all
 *   "unreadable"    — we could not ask, or could not understand the answer
 *   "none"          — storage exists but the camera reports no disks
 *   "no SD"         — disks exist, but none is an SD card
 *   "<status> (...)" — the card, with free/total when it is mounted
 */
function describeSdCard(report) {
    if (report.status === 'unsupported')
        return 'n/a';
    if (report.status === 'error')
        return 'unreadable';
    const sd = findSdCard(report);
    if (!sd)
        return report.disks.length > 0 ? 'no SD' : 'none';
    // "connected" counts as mounted alongside "OK"; keying only on "OK" hid the
    // capacity of a disk that was reporting it perfectly well.
    if (MOUNTED_STATUSES.has((sd.status ?? '').toLowerCase()) && sd.totalSizeKb) {
        return `${sd.status} (${formatKb(sd.freeSizeKb)} free of ${formatKb(sd.totalSizeKb)})`;
    }
    return sd.status ?? 'unknown';
}
