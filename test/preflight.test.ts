/**
 * Upgrade Preflight tests.
 *
 * The fixtures are verbatim applications/list.cgi responses captured from two
 * real cameras on 2026-09-06 — an AXIS Q1656 on 12.11.77 and an AXIS M1137 on
 * 10.12.300. They are used rather than hand-written XML because every bug this
 * suite guards against came from assuming what a camera returns:
 *
 *   - the Q1656 carries CompatibleOsVersions, SignatureStatus and a Resources
 *     child element; the M1137 carries none of them,
 *   - a bundled Axis application (objectanalytics) declares Max=12, so the
 *     rollback case is real and not hypothetical,
 *   - the 10.12 response uses self-closing <application ... /> elements, which
 *     parse differently from the 12.11 form.
 *
 * The rule that matters most here is the last one in this file: an old camera
 * must never be reported as a pass.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseApplicationList } from '../src/vapix/apps';
import { parseFirmware } from '../src/vapix/firmware';
import { ParamSet } from '../src/vapix/params';
import { evaluate, PreflightInput } from '../src/preflight/engine';

/** AXIS Q1656, AXIS OS 12.11.77, aarch64 — trimmed to the entries that matter. */
const Q1656_APPS = `<reply result="ok">
 <application Name="AXISImageHealthAnalytics" ApplicationID="414427" NiceName="AXIS Image Health Analytics" Vendor="Axis Communications" Version="3.2.1+build125" Bundled="Yes" Status="Stopped" License="None" SignatureStatus="Signed" LicenseName="available"><Resources><Resource name="DeepLearningProcessor" used="No" /></Resources><CompatibleOsVersions><VersionRange><Min>12.11</Min><Max>13</Max></VersionRange></CompatibleOsVersions></application>
 <application Name="camoverlay" ApplicationID="413138" NiceName="CamOverlay App" Vendor="CamStreamer s.r.o." Version="3.4.18" Bundled="No" Status="Running" License="None" SignatureStatus="Signed" LicenseName="available"><Resources><Resource name="DeepLearningProcessor" used="No" /></Resources><CompatibleOsVersions><VersionRange><Min>11</Min><Max>13</Max></VersionRange></CompatibleOsVersions></application>
 <application Name="camwallet" NiceName="CamWallet" Vendor="4XS" Version="0.8.2" Bundled="No" Status="Stopped" License="None" SignatureStatus="Unknown" LicenseName="available"><Resources><Resource name="DeepLearningProcessor" used="No" /></Resources></application>
 <application Name="objectanalytics" ApplicationID="412806" NiceName="AXIS Object Analytics" Vendor="Axis Communications" Version="1.26.205" Bundled="Yes" Status="Running" License="None" SignatureStatus="Signed" LicenseName="available"><Resources><Resource name="DeepLearningProcessor" used="No" /></Resources><CompatibleOsVersions><VersionRange><Min>12</Min><Max>12</Max></VersionRange></CompatibleOsVersions></application>
</reply>`;

/** AXIS M1137, AXIS OS 10.12.300, armv7hf — no compatibility or signature fields at all. */
const M1137_APPS = `<reply result="ok">
 <application Name="cameraconnector" NiceName="CameraConnector" Vendor="NetRex" Version="2.20-2" License="None" Status="Stopped" LicenseName="Available" />
 <application Name="camoverlay" NiceName="CamOverlay App" Vendor="CamStreamer" Version="2.3-18" ApplicationID="413138" License="None" Status="Running" LicenseName="Available" />
 <application Name="ptz_vote_agent" NiceName="PTZ Vote Agent" Vendor="kotyza@gmail.com" Version="0.5.0" Status="Running" License="None" LicenseName="available" />
</reply>`;

const Q1656_PARAMS = new ParamSet({
    'root.System.BoaGroupPolicy.admin': 'both',
    'root.System.BoaGroupPolicy.operator': 'both',
    'root.System.BoaGroupPolicy.viewer': 'both',
    'root.Network.HTTP.AuthenticationPolicy': 'recommended',
    'root.Image.I0.MPEG.SignedVideo.Enabled': 'no',
    'root.Network.UPnP.Enabled': 'no',
});

const M1137_PARAMS = new ParamSet({
    'root.System.BoaGroupPolicy.admin': 'both',
    'root.Network.HTTP.AuthenticationPolicy': 'basic',
    'root.Network.UPnP.Enabled': 'no',
});

function input(over: Partial<PreflightInput>): PreflightInput {
    return {
        targetOsMajor: 13,
        firmware: parseFirmware('12.11.77'),
        architecture: 'aarch64',
        productNumber: 'Q1656',
        apps: parseApplicationList(Q1656_APPS),
        params: Q1656_PARAMS,
        ...over,
    };
}

describe('list.cgi parsing — fields the OS 13 rules depend on', () => {
    test('reads CompatibleOsVersions, SignatureStatus and Resources from a 12.11 response', () => {
        const apps = parseApplicationList(Q1656_APPS);
        const oa = apps.find((a) => a.name === 'objectanalytics')!;
        assert.deepEqual(oa.compatibleOsVersions, [{ min: '12', max: '12' }]);
        assert.equal(oa.signatureStatus, 'Signed');
        assert.deepEqual(oa.resources, [{ name: 'DeepLearningProcessor', used: false }]);
    });

    test('a 10.12 response has none of them, and self-closing elements still parse', () => {
        const apps = parseApplicationList(M1137_APPS);
        assert.equal(apps.length, 3);
        assert.ok(apps.every((a) => a.compatibleOsVersions === null));
        assert.ok(apps.every((a) => a.signatureStatus === null));
        assert.ok(apps.every((a) => a.resources === null));
    });
});

describe('A1 — compatibility declaration', () => {
    test('a bundled Axis app declaring Max=12 blocks the upgrade to 13', () => {
        const r = evaluate(input({}));
        const f = r.findings.find((x) => x.rule === 'A1' && x.application === 'objectanalytics');
        assert.ok(f, 'objectanalytics should be flagged');
        assert.equal(f!.severity, 'blocking');
        assert.equal(r.verdict, 'will-roll-back');
    });

    test('an app with no declaration on firmware that reports them is a blocking finding', () => {
        const r = evaluate(input({}));
        const f = r.findings.find((x) => x.rule === 'A1' && x.application === 'camwallet');
        assert.ok(f);
        assert.equal(f!.severity, 'blocking');
    });

    test('Max=13 reaches the target and is not flagged', () => {
        const r = evaluate(input({}));
        assert.ok(!r.findings.some((x) => x.rule === 'A1' && x.application === 'camoverlay'));
    });

    test('targeting OS 12 clears the app that only declares up to 12', () => {
        const r = evaluate(input({ targetOsMajor: 12 }));
        assert.ok(!r.findings.some((x) => x.rule === 'A1' && x.application === 'objectanalytics'));
    });
});

describe('A4 — signature status', () => {
    test('"Unknown" is flagged, and its wording does not claim the package is unsigned', () => {
        const r = evaluate(input({}));
        const f = r.findings.find((x) => x.rule === 'A4' && x.application === 'camwallet');
        assert.ok(f);
        assert.equal(f!.severity, 'blocking');
        assert.match(f!.message, /signature status "Unknown"/);
        assert.doesNotMatch(f!.message, /\bis unsigned\b/);
    });

    test('Signed apps are not flagged', () => {
        const r = evaluate(input({}));
        assert.ok(!r.findings.some((x) => x.rule === 'A4' && x.application === 'objectanalytics'));
    });
});

describe('A5 — Y2038 32-bit ABI break', () => {
    test('armv7hf is flagged as blocking', () => {
        const r = evaluate(input({ architecture: 'armv7hf' }));
        const f = r.findings.find((x) => x.rule === 'A5');
        assert.ok(f);
        assert.equal(f!.severity, 'blocking');
    });

    test('aarch64 is not flagged', () => {
        assert.ok(!evaluate(input({})).findings.some((x) => x.rule === 'A5'));
    });

    test('a 32-bit camera missing from Axis’s published model list is still caught', () => {
        // The whole point of reading the architecture rather than matching the
        // model: the M1137 is armv7hf and is not on the published 32-bit list.
        const r = evaluate(input({ architecture: 'armv7hf', productNumber: 'M1137' }));
        assert.ok(r.findings.some((x) => x.rule === 'A5' && x.severity === 'blocking'));
    });

    test('a 32-bit camera with no applications is advisory, not a rollback', () => {
        // Nothing to rebuild means nothing to fail re-installation. Flagging this
        // as "will roll back" is a false positive, and on a fleet those are what
        // get the whole tool ignored.
        const r = evaluate(input({ architecture: 'armv7hf', apps: [] }));
        const f = r.findings.find((x) => x.rule === 'A5')!;
        assert.equal(f.severity, 'advisory');
        assert.notEqual(r.verdict, 'will-roll-back');
    });

    test('an unreported architecture is unknown, never a pass', () => {
        const r = evaluate(input({ architecture: null }));
        const f = r.findings.find((x) => x.rule === 'A5');
        assert.equal(f!.severity, 'unknown');
    });
});

describe('Tier C parameter reads', () => {
    test('BoaGroupPolicy=both is reported, and says an in-place upgrade keeps the setting', () => {
        const f = evaluate(input({})).findings.find((x) => x.rule === 'C1');
        assert.ok(f);
        assert.match(f!.message, /in-place upgrade keeps the current setting/);
    });

    test('a non-digest authentication policy is reported', () => {
        const f = evaluate(input({})).findings.find((x) => x.rule === 'C2');
        assert.ok(f);
        assert.match(f!.message, /"recommended"/);
    });

    test('a missing SignedVideo parameter produces no finding rather than a false one', () => {
        // Absent on 10.12: the feature does not exist there, which is not "off".
        const r = evaluate(input({ params: M1137_PARAMS }));
        assert.ok(!r.findings.some((x) => x.rule === 'C3'));
    });

    test('UPnP already disabled is not flagged', () => {
        assert.ok(!evaluate(input({})).findings.some((x) => x.rule === 'C4'));
    });
});

describe('absence of evidence is never a pass', () => {
    test('firmware that reports no compatibility fields yields unknown, not will-upgrade', () => {
        const r = evaluate(
            input({
                firmware: parseFirmware('10.12.300'),
                architecture: 'aarch64', // isolate: do not let A5 supply the verdict
                apps: parseApplicationList(M1137_APPS),
                params: M1137_PARAMS,
            })
        );
        assert.equal(r.verdict, 'unknown');
        assert.equal(r.blocking, 0);
        assert.ok(r.unknown > 0);
        const a1 = r.findings.find((x) => x.rule === 'A1')!;
        assert.match(a1.message, /cannot be determined/);
    });

    test('an unreadable application list yields unknown and names the reason', () => {
        const r = evaluate(input({ apps: null, appsUnavailableReason: 'needs Administrator' }));
        assert.equal(r.verdict, 'unknown');
        assert.match(r.findings[0].message, /needs Administrator/);
    });

    test('a genuinely clean camera does report will-upgrade', () => {
        // Guard against the pessimism above collapsing into "nothing ever passes",
        // which would make the tool useless in the other direction.
        const clean = parseApplicationList(`<reply result="ok">
 <application Name="camoverlay" NiceName="CamOverlay App" Version="3.4.18" Status="Running" SignatureStatus="Signed"><CompatibleOsVersions><VersionRange><Min>11</Min><Max>13</Max></VersionRange></CompatibleOsVersions></application>
</reply>`);
        const r = evaluate(
            input({
                apps: clean,
                params: new ParamSet({
                    'root.System.BoaGroupPolicy.admin': 'https',
                    'root.System.BoaGroupPolicy.operator': 'https',
                    'root.System.BoaGroupPolicy.viewer': 'https',
                    'root.Image.I0.MPEG.SignedVideo.Enabled': 'yes',
                    'root.Network.UPnP.Enabled': 'no',
                }),
            })
        );
        assert.equal(r.verdict, 'will-upgrade');
        assert.equal(r.findings.length, 0);
    });
});
