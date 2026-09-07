"use strict";
// SYNCED COPY — do not edit here.
// Source of truth: axis-cli/src/preflight/engine.ts
// Re-run `node sync.mjs` after changing it there.
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERDICT_LABEL = void 0;
exports.evaluate = evaluate;
/**
 * The only import in this file, and a deliberate exception to its no-imports
 * rule: os13.ts is pure data and one pure function, with no runtime dependency
 * of any kind. It travels with this file (see acap/sync.mjs) because the
 * question "does this hardware get AXIS OS 13 at all" cannot be answered from
 * the camera alone — it needs Axis's published list.
 */
const os13_1 = require("./os13");
/**
 * Does this firmware publish the per-application fields A1 and A4 read?
 *
 * Determined from the response rather than a version threshold, because the
 * threshold is not documented and the bench shows the fields simply appearing:
 * 12.11.77 returns CompatibleOsVersions and SignatureStatus on every entry;
 * 10.12.300 returns neither on any entry. So if *no* application carries either
 * field, this firmware does not report them — and a missing declaration means
 * "cannot tell", not "incompatible". If *some* entries carry a field and others
 * do not, the firmware does report it, and the ones without are real findings.
 */
function reportsCompatibility(apps) {
    return apps.some((a) => a.compatibleOsVersions != null);
}
function reportsSignature(apps) {
    return apps.some((a) => a.signatureStatus != null);
}
/** Leading integer of an Axis version string: "12.11" -> 12, "13" -> 13. */
function majorOf(version) {
    if (!version)
        return null;
    const m = version.trim().match(/^(\d+)/);
    return m ? Number(m[1]) : null;
}
/**
 * A1 — mandatory compatibility declaration.
 *
 * `<CompatibleOsVersions><VersionRange Min=".." Max=".."/></CompatibleOsVersions>`
 * is already parsed by vapix/apps.ts, so this rule costs no extra request: the
 * same list.cgi response that `axis apps list` uses answers it.
 *
 * Max is inclusive — an application declaring Max=13 is compatible with 13, and
 * one declaring Max=12 is not. Bench evidence: AXIS Object Analytics 1.26.205,
 * a *bundled* application, declares Max=12 on a 12.11 camera.
 */
function ruleA1(input, apps) {
    const target = input.targetOsMajor;
    if (!reportsCompatibility(apps)) {
        return [
            {
                rule: 'A1',
                severity: 'unknown',
                message: `This firmware (${input.firmware.raw || 'unknown'}) does not publish per-application ` +
                    'compatibility declarations, so whether these applications survive an ' +
                    `AXIS OS ${target} upgrade cannot be determined from the camera. ` +
                    'Check each application with its vendor before upgrading.',
            },
        ];
    }
    return apps.flatMap((app) => {
        const label = app.niceName ? `${app.niceName} (${app.name})` : app.name;
        if (app.compatibleOsVersions == null) {
            return [
                {
                    rule: 'A1',
                    severity: 'blocking',
                    application: app.name,
                    message: `${label}${app.version ? ` ${app.version}` : ''} declares no compatible AXIS OS versions. ` +
                        `The declaration is mandatory from AXIS OS ${target}, so re-installation fails during the ` +
                        'upgrade and the device rolls back.',
                },
            ];
        }
        // Several ranges are permitted; the application is compatible if any of
        // them reaches the target. A range with no Max is treated as open-ended
        // rather than as a failure — the parser only keeps ranges that carry at
        // least one bound.
        const reaches = app.compatibleOsVersions.some((r) => {
            const max = majorOf(r.max);
            return max === null || max >= target;
        });
        if (reaches)
            return [];
        const declared = app.compatibleOsVersions
            .map((r) => `${r.min ?? '?'}–${r.max ?? '?'}`)
            .join(', ');
        return [
            {
                rule: 'A1',
                severity: 'blocking',
                application: app.name,
                message: `${label}${app.version ? ` ${app.version}` : ''} declares compatibility with ${declared}, ` +
                    `which does not reach AXIS OS ${target}. The upgrade rolls back unless this application is ` +
                    'updated or removed first.',
            },
        ];
    });
}
/**
 * A4 — unsigned applications are refused from AXIS OS 13.
 *
 * "Unknown" is treated as a finding rather than ignored: the bench showed it is
 * what locally built packages report, which is exactly the population at risk.
 * It is reported as its own wording, though, because unknown is not a positive
 * statement that the package is unsigned.
 */
function ruleA4(input, apps) {
    if (!reportsSignature(apps)) {
        return [
            {
                rule: 'A4',
                severity: 'unknown',
                message: `This firmware (${input.firmware.raw || 'unknown'}) does not report per-application signature ` +
                    `status, so unsigned packages cannot be identified from here. AXIS OS ${input.targetOsMajor} ` +
                    'refuses them.',
            },
        ];
    }
    return apps.flatMap((app) => {
        const status = (app.signatureStatus ?? '').toLowerCase();
        if (status === 'signed')
            return [];
        const label = app.niceName ? `${app.niceName} (${app.name})` : app.name;
        if (status === 'unsigned') {
            return [
                {
                    rule: 'A4',
                    severity: 'blocking',
                    application: app.name,
                    message: `${label} is unsigned. AXIS OS ${input.targetOsMajor} accepts only signed applications ` +
                        'and the AllowUnsigned override has been removed, so re-installation fails and the device rolls back.',
                },
            ];
        }
        return [
            {
                rule: 'A4',
                severity: 'blocking',
                application: app.name,
                message: `${label} reports signature status "${app.signatureStatus}". Anything other than Signed is ` +
                    `refused by AXIS OS ${input.targetOsMajor}. Locally built packages report this — sign the ` +
                    'package or remove it before upgrading.',
            },
        ];
    });
}
/**
 * A5 — Y2038 64-bit time_t ABI break on 32-bit products.
 *
 * Reads `Properties.System.Architecture` rather than matching the product
 * against Axis's published 32-bit model list. The bench is the reason: an AXIS
 * M1137 reports armv7hf and does **not** appear on that list, so the model-list
 * detection would have cleared a genuinely exposed camera. The architecture
 * comes from the device and cannot go stale.
 */
const THIRTY_TWO_BIT = new Set(['armv7hf', 'armv6', 'armv7l', 'mips', 'i386', 'x86']);
function ruleA5(input) {
    const arch = (input.architecture ?? '').toLowerCase();
    if (!arch) {
        return [
            {
                rule: 'A5',
                severity: 'unknown',
                message: 'This camera does not report Properties.System.Architecture, so its exposure to the ' +
                    'Y2038 ABI break cannot be determined.',
            },
        ];
    }
    if (!THIRTY_TWO_BIT.has(arch))
        return [];
    // The ABI break only causes a rollback through an ACAP that fails to re-install.
    // Axis rebuilds its own services, so a 32-bit camera carrying no applications is
    // exposed to nothing — calling it "will roll back" would be a false positive, and
    // on a large fleet those are what get a tool ignored.
    const appCount = input.apps?.length ?? null;
    if (appCount === 0) {
        return [
            {
                rule: 'A5',
                severity: 'advisory',
                message: `This is a 32-bit product (${arch}), so AXIS OS ${input.targetOsMajor} is an ABI break for ` +
                    'ACAPs on it. No applications are installed, so there is nothing here to rebuild.',
            },
        ];
    }
    const scope = appCount === null
        ? 'The application list could not be read, so how many are affected is unknown.'
        : `All ${appCount} installed application(s) must be rebuilt against the new ABI, or removed before the upgrade.`;
    return [
        {
            rule: 'A5',
            severity: appCount === null ? 'unknown' : 'blocking',
            message: `This is a 32-bit product (${arch}). AXIS OS ${input.targetOsMajor} moves to 64-bit time_t, ` +
                `which is an ABI break. ${scope}`,
        },
    ];
}
/**
 * A8 — DLPU usage must be declared in the manifest.
 *
 * Only half of this is knowable from the camera. list.cgi reports the
 * declaration; nothing reports whether the application actually touches the
 * DLPU. So this reports what is declared and stays advisory — claiming a
 * mismatch we cannot observe would be exactly the confident wrong answer this
 * tool exists to prevent.
 */
function ruleA8(input, apps) {
    const anyDeclared = apps.some((a) => a.resources != null);
    if (!anyDeclared)
        return [];
    return apps.flatMap((app) => {
        if (app.resources == null)
            return [];
        const dlpu = app.resources.find((r) => r.name.toLowerCase() === 'deeplearningprocessor');
        if (!dlpu || !dlpu.used)
            return [];
        const label = app.niceName ?? app.name;
        return [
            {
                rule: 'A8',
                severity: 'advisory',
                application: app.name,
                message: `${label} declares deep-learning processor use, which AXIS OS ${input.targetOsMajor} requires. ` +
                    'The declaration is present, so this is informational.',
            },
        ];
    });
}
/** C1 — HTTPS-only becomes the factory default; port 80 disabled. */
function ruleC1(input) {
    const roles = ['admin', 'operator', 'viewer'];
    const both = roles.filter((r) => (input.params.get(`System.BoaGroupPolicy.${r}`) ?? '').toLowerCase() === 'both');
    if (both.length === 0)
        return [];
    return [
        {
            rule: 'C1',
            severity: 'advisory',
            message: `HTTP is still accepted for: ${both.join(', ')}. AXIS OS ${input.targetOsMajor} makes HTTPS-only ` +
                'the factory default and disables port 80, so anything calling this camera over http:// should be ' +
                'moved to https:// before a factory reset — an in-place upgrade keeps the current setting.',
        },
    ];
}
/**
 * C2 — authentication policy.
 *
 * Reported rather than judged. Bench evidence: policy "recommended" (12.11) and
 * "basic" (10.12) both refused digest and accepted basic over HTTPS, so a client
 * hardcoded to digest is already broken today, independently of AXIS OS 13.
 */
function ruleC2(input) {
    const policy = input.params.get('Network.HTTP.AuthenticationPolicy');
    if (!policy)
        return [];
    if (policy.toLowerCase() === 'digest')
        return [];
    return [
        {
            rule: 'C2',
            severity: 'advisory',
            message: `Authentication policy is "${policy}". Under the policies observed on hardware, digest is refused ` +
                'and basic-over-HTTPS is accepted, so any client hardcoded to digest authentication fails against ' +
                'this camera now — not only after the upgrade.',
        },
    ];
}
/** C3 — Signed Video switches on by default, raising bitrate. */
function ruleC3(input) {
    const value = input.params.get('Image.I0.MPEG.SignedVideo.Enabled');
    // Absent means the firmware predates the feature — not "off". Saying nothing
    // is correct here; inventing a finding from a missing parameter is not.
    if (value === undefined)
        return [];
    if (value.toLowerCase() === 'yes')
        return [];
    return [
        {
            rule: 'C3',
            severity: 'advisory',
            message: `Signed Video is off. AXIS OS ${input.targetOsMajor} enables it by default, which raises the video ` +
                'bitrate in some situations — worth accounting for in storage and bandwidth planning.',
        },
    ];
}
/**
 * A9 — no published AXIS OS 13 path for this hardware.
 *
 * The rule that changes what somebody does with their money, so it is the one
 * that hedges. Every other rule here errs toward "unverified" because a false
 * all-clear is the expensive mistake; this one's false positive tells a customer
 * to replace working cameras. Hence "no published upgrade path", the source
 * named in the message, and an explicit instruction to confirm before spending.
 *
 * When it fires, A5 is suppressed: telling someone to rebuild their applications
 * against an ABI they will never meet is worse than saying nothing.
 */
function ruleA9(input) {
    if (input.targetOsMajor < 13)
        return [];
    const path = (0, os13_1.upgradePath)(input.architecture, input.productNumber, (0, os13_1.osMajor)(input.firmware.raw));
    if (path === 'has-path')
        return [];
    if (path === 'unknown') {
        return [
            {
                rule: 'A9',
                severity: 'unknown',
                message: 'Whether AXIS OS ' +
                    input.targetOsMajor +
                    ' exists for this hardware could not be determined. It is a 32-bit product that Axis ' +
                    'does not name among the 32-bit products receiving AXIS OS ' +
                    input.targetOsMajor +
                    ', but it is on the active AXIS OS track, so its absence from that list is not proof ' +
                    'there is no upgrade. Ask Axis for this model before planning either work or replacement. ' +
                    'Source: ' +
                    os13_1.OS13_SOURCE,
            },
        ];
    }
    const model = input.productNumber ? `The ${input.productNumber}` : 'This camera';
    const fw = input.firmware.raw ? ` It stays on AXIS OS ${input.firmware.raw}.` : '';
    return [
        {
            rule: 'A9',
            severity: 'blocking',
            message: `${model} is a 32-bit product, is not on Axis's published list of 32-bit products that will ` +
                `receive AXIS OS ${input.targetOsMajor}, and is still on AXIS OS 10 — so it was never offered ` +
                `AXIS OS 11 either. That is a device on a closed track, and Axis states that AXIS OS 13 will ` +
                `not support ARTPEC-6 products. There is no AXIS OS ${input.targetOsMajor} to prepare for ` +
                `here: no application change makes one available.${fw} Confirm with Axis before replacing ` +
                `hardware on the strength of this. Source: ${os13_1.OS13_SOURCE}`,
        },
    ];
}
/** C4 — UPnP discovery removed entirely. */
function ruleC4(input) {
    const value = input.params.get('Network.UPnP.Enabled');
    if (value === undefined)
        return [];
    if (value.toLowerCase() !== 'yes')
        return [];
    return [
        {
            rule: 'C4',
            severity: 'advisory',
            message: `UPnP discovery is enabled. AXIS OS ${input.targetOsMajor} removes it entirely, so tooling that ` +
                'finds this camera over UPnP will stop finding it.',
        },
    ];
}
/**
 * Run every rule this scanner can evaluate read-only.
 *
 * The verdict is deliberately pessimistic in one direction only: any blocking
 * finding means the upgrade reverts, and any unknown outranks a clean pass.
 */
function evaluate(input) {
    const findings = [];
    if (input.apps === null) {
        findings.push({
            rule: 'A1',
            severity: 'unknown',
            message: 'The installed-application list could not be read' +
                (input.appsUnavailableReason ? `: ${input.appsUnavailableReason}` : '.') +
                ' Without it, nothing can be said about whether this camera survives the upgrade.',
        });
    }
    else {
        findings.push(...ruleA1(input, input.apps));
        findings.push(...ruleA4(input, input.apps));
        findings.push(...ruleA8(input, input.apps));
    }
    // A9 first: if there is no AXIS OS 13 for this hardware, A5's advice to
    // rebuild every application against the new ABI is advice about an upgrade
    // that will never be offered.
    const noPath = ruleA9(input);
    findings.push(...noPath);
    const strandedHardware = noPath.some((f) => f.rule === 'A9' && f.severity === 'blocking');
    if (!strandedHardware)
        findings.push(...ruleA5(input));
    findings.push(...ruleC1(input));
    findings.push(...ruleC2(input));
    findings.push(...ruleC3(input));
    findings.push(...ruleC4(input));
    const blocking = findings.filter((f) => f.severity === 'blocking').length;
    const unknown = findings.filter((f) => f.severity === 'unknown').length;
    const degraded = findings.filter((f) => f.severity === 'degraded').length;
    let verdict;
    // Checked before rollback: a camera with no AXIS OS 13 cannot roll back from
    // an upgrade it will never be offered, and reporting it as a rollback risk
    // sends the reader to fix applications instead of to their account manager.
    if (strandedHardware)
        verdict = 'no-upgrade-path';
    else if (blocking > 0)
        verdict = 'will-roll-back';
    else if (unknown > 0)
        verdict = 'unknown';
    else if (degraded > 0)
        verdict = 'will-lose-function';
    else
        verdict = 'will-upgrade';
    return { verdict, findings, blocking, unknown, appCount: input.apps ? input.apps.length : null };
}
exports.VERDICT_LABEL = {
    'no-upgrade-path': 'no upgrade path',
    'will-upgrade': 'will upgrade',
    'will-roll-back': 'WILL ROLL BACK',
    'will-lose-function': 'will lose function',
    unknown: 'unknown',
};
