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

import { VapixCore, RequestOptions } from './core';
import { ParamSet } from './params';
import { asArray, attr, bool, findElements, int, str, xmlParser } from './xml';

const DISKS_LIST_CGI = '/axis-cgi/disks/list.cgi';

export type Disk = {
    id: string;
    name: string | null;
    /**
     * "OK" | "connected" | "disconnected" | "failed" | "no passphrase" |
     * "wrong passphrase" | "not encrypted" — note the mixed casing is Axis' own,
     * so this is kept as reported rather than normalised.
     */
    status: string | null;
    /** Kilobytes, as the CGI reports them. */
    totalSizeKb: number | null;
    freeSizeKb: number | null;
    filesystem: string | null;
    full: boolean | null;
    readOnly: boolean | null;
    locked: boolean | null;
    encrypted: boolean | null;
    encryptionEnabled: boolean | null;
    raw: Record<string, string>;
};

/**
 * Parse a disk listing, or null when the body could not be understood at all.
 *
 * null and `[]` mean different things and the distinction is load-bearing: `[]`
 * is "the camera says it has no disks", null is "we could not tell".
 */
export function parseDiskList(body: string): Disk[] | null {
    let doc: unknown;
    try {
        doc = xmlParser.parse(body);
    } catch {
        return null;
    }
    if (typeof doc !== 'object' || doc === null) return null;

    // Searched by local name at any depth rather than via a fixed `root.disks.disk`
    // path, which broke on a namespaced root, a missing <disks> wrapper, and two
    // <disks> blocks — all of which then looked like "no SD card".
    const nodes = findElements(doc, 'disk');

    // Nothing that looks like a disk listing at all: if there is no <disks>
    // wrapper either, this is probably an error page rather than an empty listing.
    if (nodes.length === 0 && findElements(doc, 'disks').length === 0) return null;

    return nodes.flatMap((d) => {
        const id = str(attr(d, 'diskid', 'id'));
        if (!id) return [];

        const raw: Record<string, string> = {};
        for (const [k, v] of Object.entries(d)) {
            const s = str(v);
            if (s !== null) raw[k] = s;
        }

        return [
            {
                id,
                name: str(attr(d, 'name')),
                status: str(attr(d, 'status')),
                totalSizeKb: int(attr(d, 'totalsize')),
                freeSizeKb: int(attr(d, 'freesize')),
                filesystem: str(attr(d, 'filesystem')),
                full: bool(attr(d, 'full')),
                readOnly: bool(attr(d, 'readonly')),
                locked: bool(attr(d, 'locked')),
                encrypted: bool(attr(d, 'diskencrypted', 'encrypted')),
                encryptionEnabled: bool(attr(d, 'diskencryptionenabled', 'encryptionenabled')),
                raw,
            },
        ];
    });
}

export function supportsLocalStorage(params: ParamSet): boolean {
    // The documented gate is Properties.LocalStorage.LocalStorage=yes. A Version
    // parameter alone is not enough: a device can publish the version while
    // reporting LocalStorage=no, and calling disks/list.cgi on it only produces a
    // failure we would then have to explain away.
    return params.yes('Properties.LocalStorage.LocalStorage');
}

/**
 * The outcome of asking a camera about its disks.
 *
 * Three distinct answers, deliberately not collapsed into one. "This model has no
 * card slot" is fine; "the slot is empty" may be a fault; "we couldn't ask" is
 * neither, and usually means the account lacks Operator. Reporting all three as
 * the same "n/a" is exactly the kind of conflation this rewrite exists to remove.
 */
export type StorageReport =
    | { status: 'unsupported' }
    | { status: 'error'; error: string }
    | { status: 'ok'; disks: Disk[] };

export async function listDisks(
    core: VapixCore,
    params: ParamSet,
    options: RequestOptions = {}
): Promise<StorageReport> {
    if (!supportsLocalStorage(params)) return { status: 'unsupported' };
    try {
        const disks = parseDiskList(await core.getText(DISKS_LIST_CGI, { diskid: 'all' }, options));
        if (disks === null) {
            return { status: 'error', error: 'the camera returned a disk listing that could not be parsed' };
        }
        return { status: 'ok', disks };
    } catch (err) {
        // Not propagated: storage is never the point of the command that called us,
        // so a storage problem must not fail an otherwise-good `info` or
        // `fleet health`. But it is reported rather than hidden.
        return { status: 'error', error: (err as Error).message };
    }
}

/** Just the SD card, the disk anyone actually asks about. */
export function findSdCard(report: StorageReport): Disk | null {
    if (report.status !== 'ok') return null;
    return report.disks.find((d) => d.id.toUpperCase() === 'SD_DISK') ?? null;
}

/** Human-readable size, from the CGI's kilobytes. */
export function formatKb(kb: number | null): string {
    if (kb === null) return '-';
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
export function describeSdCard(report: StorageReport): string {
    if (report.status === 'unsupported') return 'n/a';
    if (report.status === 'error') return 'unreadable';

    const sd = findSdCard(report);
    if (!sd) return report.disks.length > 0 ? 'no SD' : 'none';

    // "connected" counts as mounted alongside "OK"; keying only on "OK" hid the
    // capacity of a disk that was reporting it perfectly well.
    if (MOUNTED_STATUSES.has((sd.status ?? '').toLowerCase()) && sd.totalSizeKb) {
        return `${sd.status} (${formatKb(sd.freeSizeKb)} free of ${formatKb(sd.totalSizeKb)})`;
    }
    return sd.status ?? 'unknown';
}

/** Re-exported so tests and other modules need not reach into ./xml. */
export { asArray };
