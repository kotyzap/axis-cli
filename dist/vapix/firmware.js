"use strict";
/**
 * Firmware version handling.
 *
 * Axis version strings are not plain semver. Across the generations you meet:
 *
 *   "5.40.9.2"        older ARTPEC-4/5 releases
 *   "9.80.3.9"        AXIS OS LTS 2020
 *   "10.12.338"       AXIS OS LTS 2022  (what an M1137 tops out at)
 *   "11.11.212"       AXIS OS LTS 2024
 *   "12.11.77"        AXIS OS 12 active track
 *   "10.12.338.1"     hotfix builds carry a fourth component
 *   "12.0.0-beta1"    pre-release suffixes appear on the active track
 *
 * We only ever need "is this device at least X", so parse leniently into a
 * numeric tuple and ignore anything we don't recognise rather than throwing —
 * a device that reports something surprising should degrade to "assume old",
 * not break the command.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFirmware = parseFirmware;
exports.atLeast = atLeast;
exports.osTrack = osTrack;
exports.acapGeneration = acapGeneration;
function parseFirmware(raw) {
    const text = (raw ?? '').trim();
    // Stop at the first non-version character so "12.0.0-beta1" and
    // "9.80.3.9 (build 1234)" both reduce to their numeric prefix.
    const numeric = text.match(/^\d+(?:\.\d+)*/)?.[0] ?? '';
    const parts = numeric ? numeric.split('.').map((p) => parseInt(p, 10)) : [];
    return {
        raw: text,
        parts,
        major: parts[0] ?? null,
        minor: parts[1] ?? null,
    };
}
/**
 * Compare a parsed firmware against a "<major>.<minor>[.<patch>]" threshold.
 *
 * Returns null — not false — when the version is unknown, so callers can tell
 * "definitely too old" apart from "we have no idea". Most callers should treat
 * null optimistically (try the call, handle the failure) because refusing to
 * act on an unrecognised version would be worse than a clean HTTP error.
 */
function atLeast(fw, threshold) {
    if (fw.parts.length === 0)
        return null;
    const want = threshold.split('.').map((p) => parseInt(p, 10));
    if (want.length === 0 || want.some((n) => Number.isNaN(n))) {
        // A malformed threshold is a programming error. Failing loudly beats
        // silently answering "supported", which is what quietly ignoring the bad
        // component used to do.
        throw new Error(`Invalid firmware threshold "${threshold}" — expected e.g. "10.11" or "11.2".`);
    }
    for (let i = 0; i < want.length; i++) {
        // An absent component is zero, not "older". A device reporting a bare "12"
        // is at least 12.0; treating it as pre-12.0 would suppress exactly the
        // advice that applies to it.
        const have = fw.parts[i] ?? 0;
        if (have > want[i])
            return true;
        if (have < want[i])
            return false;
    }
    return true;
}
/**
 * Which AXIS OS LTS/active track a version belongs to. Purely informational,
 * but it is the thing you actually want to know when deciding whether an ACAP
 * or an API will be there.
 */
function osTrack(fw) {
    if (fw.major === null)
        return null;
    switch (fw.major) {
        case 12:
            return 'AXIS OS 12 (LTS 2026 track)';
        case 11:
            return 'AXIS OS 11 (LTS 2024 track)';
        case 10:
            return 'AXIS OS 10 (LTS 2022 track)';
        case 9:
            return 'AXIS OS 9 (LTS 2020 track)';
        default:
            return fw.major < 9 ? `legacy firmware ${fw.major}.x` : `AXIS OS ${fw.major}`;
    }
}
/**
 * The ACAP SDK generation that matches a firmware, per Axis' own versioning
 * chart (developer.axis.com/acap — "ACAP versioning"): from AXIS OS 12.0 the
 * ACAP version tracks the OS version; before that, OS 11.x → ACAP 4 and
 * OS 9.x/10.x → ACAP 3.
 *
 * This is the advisory used before pushing an .eap, so it is deliberately
 * conservative: it reports what Axis documents, not what might happen to work.
 */
function acapGeneration(fw) {
    if (fw.major === null)
        return null;
    if (fw.major >= 12) {
        return {
            label: `ACAP ${fw.major}`,
            docs: 'https://developer.axis.com/acap/',
        };
    }
    if (fw.major === 11) {
        return { label: 'ACAP 4', docs: 'https://developer.axis.com/acap/4/' };
    }
    if (fw.major === 9 || fw.major === 10) {
        // ACAP 4 up to 4.3 also installs on 10.12, but ACAP 3 is the documented
        // target for the whole 9.x/10.x range, so lead with that.
        return { label: 'ACAP 3 (ACAP 4 up to 4.3 on AXIS OS 10.12)', docs: 'https://developer.axis.com/acap/3/' };
    }
    return { label: `pre-ACAP-3 firmware ${fw.major}.x`, docs: 'https://developer.axis.com/acap/3/' };
}
