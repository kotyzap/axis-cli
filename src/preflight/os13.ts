/**
 * Which products get AXIS OS 13 at all.
 *
 * This is the question the tool was silently getting wrong, and it is the most
 * consequential one it answers, because the two possible answers lead to
 * completely different money:
 *
 *   "needs application work"   → a morning of vendor emails
 *   "will never run AXIS OS 13" → a replacement quote
 *
 * Axis states plainly, in the AXIS OS lifecycle guide:
 *
 *     "AXIS OS 13 won't support Artpec-6 products."
 *
 * And in the same document's Y2038 section, under the heading
 * "Affected products (32-bit that will get AXIS OS 13)", it publishes the list
 * reproduced below — the 32-bit products that *do* get it, being ARTPEC-7 and
 * i.MX6SX. Both quotes: https://help.axis.com/en-us/axis-os
 *
 * Put together, for a camera reporting `armv7hf`:
 *
 *   on this list      → gets AXIS OS 13, and the Y2038 ABI break is a real
 *                       problem for its ACAPs. Rule A5.
 *   not on this list  → no published AXIS OS 13. Rule A9.
 *
 * WHY ABSENCE IS NOT ENOUGH ON ITS OWN. The list omits large ARTPEC-7 camera
 * families — the P1375 and P3245 among them — and ARTPEC-7 is not the generation
 * Axis says is unsupported. So "absent from the list" alone cannot mean "no
 * AXIS OS 13" without risking exactly the error this file must not make.
 *
 * The camera settles it, and better than any model table can: an ARTPEC-7
 * product has been offered AXIS OS 11 and 12, while an ARTPEC-6 product is
 * capped on the 10.12 LTS track. So a 32-bit camera absent from the list AND
 * still on AXIS OS 10 never received AXIS OS 11 either — that is a device on a
 * closed track, and the conclusion is firm. The same camera running 11.x or 12.x
 * is on the active track and its AXIS OS 13 status is simply not published; that
 * gets "unknown", not a replacement recommendation.
 *
 * Note this also means the chipset table's inability to tell ARTPEC-6 from
 * ARTPEC-7 stops mattering. The firmware the camera is actually running is a
 * better signal than the generation label, and it comes from the device.
 *
 * A CORRECTION WORTH RECORDING. Earlier in this project the M1137 was read as
 * proof that this list was incomplete — it reports armv7hf and is absent from
 * the list — and A5 was rewritten to use the architecture parameter instead. The
 * list was never incomplete. The M1137 is absent because it is ARTPEC-6 and is
 * not getting AXIS OS 13 at all. The list was answering a question the rule was
 * not asking.
 *
 * WHY THIS RULE HEDGES AND THE OTHERS DO NOT. Every other rule here errs toward
 * "unverified" because a false all-clear is the expensive mistake. This one is
 * the opposite: its false positive tells somebody to replace working hardware.
 * So it says "no published upgrade path" and names its source, rather than
 * "cannot be upgraded", and it tells the reader to confirm with Axis before
 * spending anything.
 */

/**
 * Verbatim from the lifecycle guide, including Axis's own slash notation for
 * variants. Kept in their form rather than pre-expanded so it can be diffed
 * against the page when the page changes.
 *
 * Two things the page does that a careless extraction gets wrong, and both cost
 * a model: "AXIS M4215-LV" is written without the trailing comma that separates
 * every other entry, and "AXIS AXIS P5654-E" carries the prefix twice. A regex
 * that assumed the pattern held silently dropped M4215-LV, P5654-E and the ExCam
 * variant — three products wrongly told they have no upgrade path, which is the
 * most expensive mistake this file can make.
 */
export const OS13_32BIT_PRODUCTS = [
    'A1210/-B',
    'A1214',
    'A1610/-B',
    'A1710-B',
    'A1711',
    'A1810-B',
    'A1811',
    'A9210',
    'C1210-E',
    'C1211-E',
    'C1510',
    'C1511',
    'C1610-VE',
    'C8110',
    'C8210',
    'F9104-B',
    'F9111',
    'F9114/-B',
    'I8016-LVE',
    'M3057-PLR Mk II',
    'M4215-LV',
    'M5000/-G',
    'M5074',
    'M5075/-G',
    'M7104',
    'M7116',
    'P3818-PVE',
    'P3925-LRE',
    'P3925-R',
    'P3935-LR',
    'P5654-E',
    'P5654-E Mk II',
    'P5655-E',
    'P5676-LE',
    'P7304',
    'P7316',
    'Q6074/-E',
    'Q6075/-E/-S/-SE',
    'Q6078-E',
    'Q6135-LE',
    'Q6225-LE',
    'Q6315-LE',
    'Q6318-LE',
    'Q8615-E',
    'Q8752-E & Mk II',
    'V5925',
    'V5938',
    'D201-S XPT Q6075',
    'ExCam XPT Q6075',
] as const;

/** Source for every claim in this file, quoted in the report and on the page. */
export const OS13_SOURCE = 'https://help.axis.com/en-us/axis-os';

/** Upper-case, single-spaced, no "AXIS" prefix — so M1137-E MK II and "AXIS M1137-E Mk II" match. */
export function normaliseModel(s: string): string {
    return (s ?? '')
        .toUpperCase()
        .replace(/^AXIS\s+/, '')
        .replace(/[^A-Z0-9-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Expand Axis's slash notation into whole model names.
 *
 * "Q6075/-E/-S/-SE" is five products written as one string, and a substring
 * match on it would clear "Q6075-XYZ" too. "Q8752-E & Mk II" is two.
 */
function expand(entry: string): string[] {
    const out = new Set<string>();
    for (const half of entry.split('&')) {
        const parts = half.split('/').map((p) => p.trim()).filter(Boolean);
        if (!parts.length) continue;
        const base = parts[0];
        out.add(normaliseModel(base));
        // A bare "Mk II" suffix belongs to the base model, not a separate one.
        const stem = base.replace(/\s+MK\s+I+$/i, '').trim();
        for (const p of parts.slice(1)) {
            out.add(normaliseModel(p.startsWith('-') ? stem + p : p));
        }
    }
    // "X & Mk II" — the second half is a suffix on the first.
    if (/&/.test(entry)) {
        const [a, b] = entry.split('&').map((x) => x.trim());
        if (b && /^MK\s*I+$/i.test(normaliseModel(b))) {
            out.clear();
            const first = a.split('/')[0].trim();
            out.add(normaliseModel(first));
            out.add(normaliseModel(`${first} ${b}`));
        }
    }
    return [...out].filter(Boolean);
}

const OS13_SET: Set<string> = new Set(OS13_32BIT_PRODUCTS.flatMap(expand));

/** Every model name this list covers, expanded. Exposed so the web page can render it. */
export function os13ThirtyTwoBitModels(): string[] {
    return [...OS13_SET].sort();
}

export type UpgradePath =
    /** 64-bit, or a 32-bit product Axis lists as getting AXIS OS 13. */
    | 'has-path'
    /**
     * 32-bit, absent from that list, and never offered AXIS OS 11 — a device on
     * a closed track. There is no AXIS OS 13 for it.
     */
    | 'no-published-path'
    /** Not enough information, or absent from the list but still on the active track. */
    | 'unknown';

/**
 * Does this camera have a path to the target AXIS OS?
 *
 * Deliberately conservative in both directions: an unreadable architecture or a
 * missing model number is `unknown`, never a guess. Matching is exact on the
 * normalised name — a `startsWith` would clear a P3925-RX because P3925-R is
 * listed, and inventing hardware compatibility is exactly what this must not do.
 */
export function upgradePath(
    architecture: string | null,
    productNumber: string | null,
    /** The AXIS OS major the camera is running now, e.g. 10 for 10.12.300. */
    currentOsMajor: number | null
): UpgradePath {
    const arch = (architecture ?? '').toLowerCase().trim();
    if (!arch) return 'unknown';

    // 64-bit: ARTPEC-8, ARTPEC-9 and CV25 are all on the AXIS OS 13 track.
    if (arch === 'aarch64' || arch === 'arm64' || arch === 'x86_64' || arch === 'amd64') return 'has-path';

    const model = normaliseModel(productNumber ?? '');
    if (!model) return 'unknown';
    if (OS13_SET.has(model)) return 'has-path';

    // Absent from the list. Only the closed-track case is a firm answer: a 32-bit
    // camera still on AXIS OS 10 was never offered 11 either. One on 11.x or 12.x
    // is on the active track, and its AXIS OS 13 status is unpublished, not absent.
    if (currentOsMajor === null) return 'unknown';
    return currentOsMajor <= 10 ? 'no-published-path' : 'unknown';
}

/** Parse the major out of "10.12.300". Null when it is not a version at all. */
export function osMajor(firmware: string | null): number | null {
    const m = /^(\d+)\./.exec((firmware ?? '').trim()) ?? /^(\d+)$/.exec((firmware ?? '').trim());
    return m ? Number(m[1]) : null;
}
