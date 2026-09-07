/**
 * Upgrade Preflight — will this camera survive AXIS OS 13?
 *
 * Everything here is a pure function over data already fetched elsewhere, so the
 * whole ruleset is testable against captured camera responses rather than
 * hardware. That matters more than usual: the failures being predicted only
 * happen during an OS upgrade, which is not something a test can perform.
 *
 * The detections are the ones confirmed against real cameras on 2026-09-06
 * (AXIS Q1656 / 12.11.77 / aarch64 and AXIS M1137 / 10.12.300 / armv7hf). Rules
 * whose detection needs the .eap rather than the camera are deliberately absent:
 * a scanner that cannot see something must say so, not guess.
 *
 * The single most important design rule in this file: **absence of evidence is
 * never reported as a pass.** An older camera that does not publish the fields
 * A1 and A4 rely on yields `unknown`, never `ok`. A false all-clear is the one
 * output that would make this tool worse than not running it.
 */

/*
 * NO IMPORTS BY DESIGN.
 *
 * This file is the one place a Preflight rule is expressed, and it is shared
 * verbatim between axis-cli and the Preflight ACAP (`npm run sync:engine`).
 * Anything it imports would have to exist in both, so it imports nothing and
 * describes what it needs structurally instead — axis-cli's AcapApplication and
 * ParamSet satisfy these shapes as they are.
 *
 * A second implementation of these rules is the failure mode worth the most
 * effort to avoid: two engines drift, and the one that drifts silently is the one
 * telling somebody their fleet is safe.
 */

/** The subset of an installed application the rules read. */
export type AppInfo = {
    name: string;
    niceName?: string | null;
    version?: string | null;
    signatureStatus?: string | null;
    compatibleOsVersions?: { min: string | null; max: string | null }[] | null;
    resources?: { name: string; used: boolean | null }[] | null;
};

/** Just enough of a firmware version for the messages. */
export type FirmwareVersion = { raw?: string | null };

/** Case- and prefix-insensitive parameter lookup. */
export type ParamLookup = { get(name: string): string | undefined };

export type Severity = 'blocking' | 'degraded' | 'advisory' | 'unknown';

/** The per-camera answer, in the words the report uses. */
export type Verdict = 'will-upgrade' | 'will-roll-back' | 'will-lose-function' | 'unknown';

export type Finding = {
    /** Rule id in the published ruleset, e.g. "A1". */
    rule: string;
    severity: Severity;
    /** The application this is about, when it is about one. */
    application?: string;
    message: string;
};

export type PreflightInput = {
    targetOsMajor: number;
    firmware: FirmwareVersion;
    architecture: string | null;
    productNumber: string | null;
    /** Null when the camera cannot list applications at all. */
    apps: AppInfo[] | null;
    /** Why the application list is missing, when it is. */
    appsUnavailableReason?: string;
    params: ParamLookup;
};

export type PreflightResult = {
    verdict: Verdict;
    findings: Finding[];
    /** Counts by severity, for the fleet table. */
    blocking: number;
    unknown: number;
};

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
function reportsCompatibility(apps: AppInfo[]): boolean {
    return apps.some((a) => a.compatibleOsVersions != null);
}

function reportsSignature(apps: AppInfo[]): boolean {
    return apps.some((a) => a.signatureStatus != null);
}

/** Leading integer of an Axis version string: "12.11" -> 12, "13" -> 13. */
function majorOf(version: string | null): number | null {
    if (!version) return null;
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
function ruleA1(input: PreflightInput, apps: AppInfo[]): Finding[] {
    const target = input.targetOsMajor;

    if (!reportsCompatibility(apps)) {
        return [
            {
                rule: 'A1',
                severity: 'unknown',
                message:
                    `This firmware (${input.firmware.raw || 'unknown'}) does not publish per-application ` +
                    'compatibility declarations, so whether these applications survive an ' +
                    `AXIS OS ${target} upgrade cannot be determined from the camera. ` +
                    'Check each application with its vendor before upgrading.',
            },
        ];
    }

    return apps.flatMap((app): Finding[] => {
        const label = app.niceName ? `${app.niceName} (${app.name})` : app.name;

        if (app.compatibleOsVersions == null) {
            return [
                {
                    rule: 'A1',
                    severity: 'blocking',
                    application: app.name,
                    message:
                        `${label}${app.version ? ` ${app.version}` : ''} declares no compatible AXIS OS versions. ` +
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
        if (reaches) return [];

        const declared = app.compatibleOsVersions
            .map((r) => `${r.min ?? '?'}–${r.max ?? '?'}`)
            .join(', ');
        return [
            {
                rule: 'A1',
                severity: 'blocking',
                application: app.name,
                message:
                    `${label}${app.version ? ` ${app.version}` : ''} declares compatibility with ${declared}, ` +
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
function ruleA4(input: PreflightInput, apps: AppInfo[]): Finding[] {
    if (!reportsSignature(apps)) {
        return [
            {
                rule: 'A4',
                severity: 'unknown',
                message:
                    `This firmware (${input.firmware.raw || 'unknown'}) does not report per-application signature ` +
                    `status, so unsigned packages cannot be identified from here. AXIS OS ${input.targetOsMajor} ` +
                    'refuses them.',
            },
        ];
    }

    return apps.flatMap((app): Finding[] => {
        const status = (app.signatureStatus ?? '').toLowerCase();
        if (status === 'signed') return [];
        const label = app.niceName ? `${app.niceName} (${app.name})` : app.name;

        if (status === 'unsigned') {
            return [
                {
                    rule: 'A4',
                    severity: 'blocking',
                    application: app.name,
                    message:
                        `${label} is unsigned. AXIS OS ${input.targetOsMajor} accepts only signed applications ` +
                        'and the AllowUnsigned override has been removed, so re-installation fails and the device rolls back.',
                },
            ];
        }
        return [
            {
                rule: 'A4',
                severity: 'blocking',
                application: app.name,
                message:
                    `${label} reports signature status "${app.signatureStatus}". Anything other than Signed is ` +
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

function ruleA5(input: PreflightInput): Finding[] {
    const arch = (input.architecture ?? '').toLowerCase();

    if (!arch) {
        return [
            {
                rule: 'A5',
                severity: 'unknown',
                message:
                    'This camera does not report Properties.System.Architecture, so its exposure to the ' +
                    'Y2038 ABI break cannot be determined.',
            },
        ];
    }
    if (!THIRTY_TWO_BIT.has(arch)) return [];

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
                message:
                    `This is a 32-bit product (${arch}), so AXIS OS ${input.targetOsMajor} is an ABI break for ` +
                    'ACAPs on it. No applications are installed, so there is nothing here to rebuild.',
            },
        ];
    }

    const scope =
        appCount === null
            ? 'The application list could not be read, so how many are affected is unknown.'
            : `All ${appCount} installed application(s) must be rebuilt against the new ABI, or removed before the upgrade.`;

    return [
        {
            rule: 'A5',
            severity: appCount === null ? 'unknown' : 'blocking',
            message:
                `This is a 32-bit product (${arch}). AXIS OS ${input.targetOsMajor} moves to 64-bit time_t, ` +
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
function ruleA8(input: PreflightInput, apps: AppInfo[]): Finding[] {
    const anyDeclared = apps.some((a) => a.resources != null);
    if (!anyDeclared) return [];

    return apps.flatMap((app): Finding[] => {
        if (app.resources == null) return [];
        const dlpu = app.resources.find((r) => r.name.toLowerCase() === 'deeplearningprocessor');
        if (!dlpu || !dlpu.used) return [];
        const label = app.niceName ?? app.name;
        return [
            {
                rule: 'A8',
                severity: 'advisory',
                application: app.name,
                message:
                    `${label} declares deep-learning processor use, which AXIS OS ${input.targetOsMajor} requires. ` +
                    'The declaration is present, so this is informational.',
            },
        ];
    });
}

/** C1 — HTTPS-only becomes the factory default; port 80 disabled. */
function ruleC1(input: PreflightInput): Finding[] {
    const roles = ['admin', 'operator', 'viewer'] as const;
    const both = roles.filter((r) => (input.params.get(`System.BoaGroupPolicy.${r}`) ?? '').toLowerCase() === 'both');
    if (both.length === 0) return [];

    return [
        {
            rule: 'C1',
            severity: 'advisory',
            message:
                `HTTP is still accepted for: ${both.join(', ')}. AXIS OS ${input.targetOsMajor} makes HTTPS-only ` +
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
function ruleC2(input: PreflightInput): Finding[] {
    const policy = input.params.get('Network.HTTP.AuthenticationPolicy');
    if (!policy) return [];
    if (policy.toLowerCase() === 'digest') return [];

    return [
        {
            rule: 'C2',
            severity: 'advisory',
            message:
                `Authentication policy is "${policy}". Under the policies observed on hardware, digest is refused ` +
                'and basic-over-HTTPS is accepted, so any client hardcoded to digest authentication fails against ' +
                'this camera now — not only after the upgrade.',
        },
    ];
}

/** C3 — Signed Video switches on by default, raising bitrate. */
function ruleC3(input: PreflightInput): Finding[] {
    const value = input.params.get('Image.I0.MPEG.SignedVideo.Enabled');
    // Absent means the firmware predates the feature — not "off". Saying nothing
    // is correct here; inventing a finding from a missing parameter is not.
    if (value === undefined) return [];
    if (value.toLowerCase() === 'yes') return [];

    return [
        {
            rule: 'C3',
            severity: 'advisory',
            message:
                `Signed Video is off. AXIS OS ${input.targetOsMajor} enables it by default, which raises the video ` +
                'bitrate in some situations — worth accounting for in storage and bandwidth planning.',
        },
    ];
}

/** C4 — UPnP discovery removed entirely. */
function ruleC4(input: PreflightInput): Finding[] {
    const value = input.params.get('Network.UPnP.Enabled');
    if (value === undefined) return [];
    if (value.toLowerCase() !== 'yes') return [];

    return [
        {
            rule: 'C4',
            severity: 'advisory',
            message:
                `UPnP discovery is enabled. AXIS OS ${input.targetOsMajor} removes it entirely, so tooling that ` +
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
export function evaluate(input: PreflightInput): PreflightResult {
    const findings: Finding[] = [];

    if (input.apps === null) {
        findings.push({
            rule: 'A1',
            severity: 'unknown',
            message:
                'The installed-application list could not be read' +
                (input.appsUnavailableReason ? `: ${input.appsUnavailableReason}` : '.') +
                ' Without it, nothing can be said about whether this camera survives the upgrade.',
        });
    } else {
        findings.push(...ruleA1(input, input.apps));
        findings.push(...ruleA4(input, input.apps));
        findings.push(...ruleA8(input, input.apps));
    }

    findings.push(...ruleA5(input));
    findings.push(...ruleC1(input));
    findings.push(...ruleC2(input));
    findings.push(...ruleC3(input));
    findings.push(...ruleC4(input));

    const blocking = findings.filter((f) => f.severity === 'blocking').length;
    const unknown = findings.filter((f) => f.severity === 'unknown').length;
    const degraded = findings.filter((f) => f.severity === 'degraded').length;

    let verdict: Verdict;
    if (blocking > 0) verdict = 'will-roll-back';
    else if (unknown > 0) verdict = 'unknown';
    else if (degraded > 0) verdict = 'will-lose-function';
    else verdict = 'will-upgrade';

    return { verdict, findings, blocking, unknown };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
    'will-upgrade': 'will upgrade',
    'will-roll-back': 'WILL ROLL BACK',
    'will-lose-function': 'will lose function',
    unknown: 'unknown',
};
