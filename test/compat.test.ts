/**
 * Firmware compatibility tests.
 *
 * Each case encodes a way the CLI used to break, or would break, on a firmware
 * generation other than the newest. They run against MockCamera rather than
 * hardware, because the failures being guarded against only appear on firmware
 * that is not to hand — an M1137 on AXIS OS 10.12 cannot be made to answer like
 * a 12.x device.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { MockCamera } from './mock-camera';
import * as fx from './fixtures';

import { VapixCore, VapixError, findTextError, findJsonError, UnsupportedError } from '../src/vapix/core';
import { atLeast, parseFirmware, osTrack, acapGeneration } from '../src/vapix/firmware';
import { listParams, tryListParams, updateParams, ParamSet, parseParamLines, stripRoot } from '../src/vapix/params';
import { getDeviceInfo, getApiList } from '../src/vapix/deviceinfo';
import {
    parseApplicationList,
    resolveApplication,
    controlApplication,
    getSupportedSdks,
    getAppConfig,
    preflightUpload,
    requireAcapSupport,
    uploadApplication,
} from '../src/vapix/apps';
import { parseEventInstances, summarise as summariseForTest } from '../src/commands/events';
import { parseDiskList, describeSdCard, findSdCard, formatKb, listDisks, supportsLocalStorage } from '../src/vapix/storage';
import { getPosition, getPresets, getAvailableCommands, readPtzSupport, requirePtz } from '../src/vapix/ptz';
import { detectCapabilities, compatibilityNotes } from '../src/capabilities';
import { str, int, bool, attr, findElements, xmlParser } from '../src/vapix/xml';

const PARAM = '/axis-cgi/param.cgi';
const LIST = '/axis-cgi/applications/list.cgi';
const CONTROL = '/axis-cgi/applications/control.cgi';
const INFO = '/axis-cgi/applications/info.cgi';
const CONFIG = '/axis-cgi/applications/config.cgi';
const DISKS = '/axis-cgi/disks/list.cgi';
const PTZ = '/axis-cgi/com/ptz.cgi';
const BDI = '/axis-cgi/basicdeviceinfo.cgi';
const DISCOVERY = '/axis-cgi/apidiscovery.cgi';

/** An M1137 on AXIS OS 10.12: no basicdeviceinfo route, digital PTZ only. */
function m1137(): MockCamera {
    return new MockCamera({
        [PARAM]: { body: fx.PARAMS_FW10_M1137 },
        [LIST]: { body: fx.APPS_FW10_SPARSE },
        [INFO]: { body: fx.APPS_INFO_SDKS },
        [DISKS]: { body: fx.DISKS_SINGLE },
        [PTZ]: {
            respond: (p) =>
                p.query === 'position'
                    ? { body: fx.PTZ_POSITION_FIXED }
                    : p.query === 'presetposcam'
                      ? { body: '' }
                      : { body: fx.PTZ_INFO },
        },
        [DISCOVERY]: { body: fx.DISCOVERY_FW12 },
    });
}

/** A modern PTZ dome on AXIS OS 12.11 with every API present. */
function fw12(): MockCamera {
    return new MockCamera({
        [PARAM]: { body: fx.PARAMS_FW12_PTZ },
        [LIST]: { body: fx.APPS_FW12_FULL },
        [INFO]: { body: fx.APPS_INFO_SDKS },
        [CONFIG]: { body: fx.APP_CONFIG_ALLOW_UNSIGNED_FALSE },
        [DISKS]: { body: fx.DISKS_SD_AND_SHARE },
        [PTZ]: { respond: (p) => (p.query === 'position' ? { body: fx.PTZ_POSITION_FULL } : { body: fx.PTZ_PRESETS }) },
        [BDI]: { body: fx.BDI_SUCCESS },
        [DISCOVERY]: { body: fx.DISCOVERY_FW12 },
    });
}

/** A firmware 5.51 encoder: param.cgi and little else. */
function fw5(): MockCamera {
    return new MockCamera({
        [PARAM]: { body: fx.PARAMS_FW5_LEGACY },
        [PTZ]: { respond: (p) => (p.query === 'position' ? { body: 'pan=0\ntilt=0\nzoom=1' } : { body: fx.PTZ_INFO }) },
    });
}

// ---------------------------------------------------------------------------

describe('firmware version parsing', () => {
    test('parses the version shapes Axis actually ships', () => {
        assert.deepEqual(parseFirmware('10.12.338').parts, [10, 12, 338]);
        assert.deepEqual(parseFirmware('9.80.3.9').parts, [9, 80, 3, 9]);
        assert.deepEqual(parseFirmware('5.51.1.1').parts, [5, 51, 1, 1]);
        // Pre-release and annotated builds must not poison the numeric prefix.
        assert.deepEqual(parseFirmware('12.0.0-beta1').parts, [12, 0, 0]);
        assert.deepEqual(parseFirmware('10.12.338 (build 1)').parts, [10, 12, 338]);
    });

    test('an unknown version yields null, not a wrong answer', () => {
        const fw = parseFirmware(undefined);
        assert.equal(fw.major, null);
        // null, not false: "we cannot tell" must be distinguishable from "too old",
        // because the two lead to opposite decisions.
        assert.equal(atLeast(fw, '10.11'), null);
    });

    test('threshold comparison', () => {
        const fw10 = parseFirmware('10.12.338');
        assert.equal(atLeast(fw10, '10.11'), true);
        assert.equal(atLeast(fw10, '10.12'), true);
        assert.equal(atLeast(fw10, '11.0'), false);
        assert.equal(atLeast(fw10, '11.2'), false);
        assert.equal(atLeast(parseFirmware('11.11.212'), '11.2'), true);
        assert.equal(atLeast(parseFirmware('12.1.0'), '12.1'), true);
        assert.equal(atLeast(parseFirmware('10'), '10.11'), false);
    });

    test('a missing component counts as zero, not as "older"', () => {
        // A device reporting a bare "12" is at least 12.0. Treating it as pre-12.0
        // would suppress exactly the TLS and ACAP-signing advice that applies to it.
        assert.equal(atLeast(parseFirmware('12'), '12.0'), true);
        assert.equal(atLeast(parseFirmware('11'), '11.0'), true);
        assert.equal(atLeast(parseFirmware('11'), '11.2'), false);
    });

    test('a malformed threshold throws rather than answering "supported"', () => {
        // Silently ignoring the bad component used to return true, which is the worst
        // possible answer to give about a capability.
        assert.throws(() => atLeast(parseFirmware('11.2'), '11.x'), /Invalid firmware threshold/);
    });

    test('dotted versions are compared as versions, not as floats', () => {
        // As floats, 1.3 > 1.2 — but as versions, 1.3 is older than 1.20. This is
        // what gates applications/list.cgi.
        assert.equal(atLeast(parseFirmware('1.20'), '1.20'), true);
        assert.equal(atLeast(parseFirmware('2.16'), '1.20'), true);
        assert.equal(atLeast(parseFirmware('1.3'), '1.20'), false);
        assert.equal(atLeast(parseFirmware('1.10'), '1.20'), false);
    });

    test('maps versions to AXIS OS tracks and ACAP generations', () => {
        assert.match(osTrack(parseFirmware('10.12.338'))!, /AXIS OS 10/);
        assert.match(osTrack(parseFirmware('12.11.77'))!, /AXIS OS 12/);
        assert.match(acapGeneration(parseFirmware('10.12.338'))!.label, /ACAP 3/);
        assert.match(acapGeneration(parseFirmware('11.11.212'))!.label, /ACAP 4/);
        assert.match(acapGeneration(parseFirmware('12.11.77'))!.label, /ACAP 12/);
    });
});

/**
 * The whole class of bug this group guards: a camera sends a *richer* shape than
 * the documented example, and the CLI renders it as "[object Object]" — wrong
 * output, exit code 0, no exception. Found on a real M1137 whose info.cgi sends
 * `<sdk version="3.5">acap3</sdk>` where Axis documents a bare `<sdk>acap3</sdk>`.
 */
describe('XML value coercion', () => {
    test('an element with both text and attributes yields its text', () => {
        assert.equal(str({ '#text': '1.20', major: '1' }), '1.20');
    });

    test('an element with no text and one attribute yields that attribute', () => {
        assert.equal(str({ state: 'Running' }), 'Running');
    });

    test('an ambiguous object yields null rather than "[object Object]"', () => {
        // Two attributes and no text: any choice would be a guess. null renders as
        // "-" or "not reported", which is honest.
        assert.equal(str({ major: '1', minor: '2' }), null);
    });

    test('a repeated element joins its parts', () => {
        assert.equal(str(['a', 'b']), 'a, b');
    });

    test('empty and whitespace-only values are null, not empty strings', () => {
        assert.equal(str(''), null);
        assert.equal(str('   '), null);
        assert.equal(str(undefined), null);
        assert.equal(str(null), null);
    });

    test('int rejects anything not purely numeric', () => {
        // parseInt('1.9 GB') is 1 — a capacity of "1 kB" reported with total
        // confidence is worse than reporting nothing.
        assert.equal(int('62522368'), 62522368);
        assert.equal(int('1.9 GB'), null);
        assert.equal(int('1.5'), null);
        assert.equal(int(''), null);
    });

    test('bool accepts every spelling Axis uses', () => {
        for (const t of ['yes', 'true', '1', 'on', 'YES', 'True']) assert.equal(bool(t), true, t);
        for (const f of ['no', 'false', '0', 'off', 'NO']) assert.equal(bool(f), false, f);
        assert.equal(bool('maybe'), null);
    });

    test('findElements locates elements at any depth and ignores namespace prefixes', () => {
        const doc = xmlParser.parse('<ns:root><ns:disks><ns:disk diskid="SD_DISK"/></ns:disks></ns:root>');
        const found = findElements(doc, 'disk');
        assert.equal(found.length, 1);
        assert.equal(attr(found[0], 'diskid'), 'SD_DISK');
    });
});

describe('in-band error detection', () => {
    test('recognises all three documented text error shapes', () => {
        assert.equal(findTextError('# Error: Error setting \'X\' to \'Y\'!')!.message, "Error setting 'X' to 'Y'!");
        assert.equal(findTextError('Error: 4')!.code, 4);
        // ptz.cgi puts "Error:" alone on its line and the message on the next.
        assert.equal(findTextError(fx.PTZ_ERROR)!.message, 'query: unknown value: postion');
        assert.match(findTextError('# Request failed: no such group')!.message, /no such group/);
    });

    test('a successful body is not mistaken for an error', () => {
        assert.equal(findTextError('OK'), null);
        assert.equal(findTextError(fx.PARAMS_FW10_M1137), null);
        assert.equal(findTextError(fx.PTZ_POSITION_FULL), null);
    });

    test('the word "Error:" inside a value is not an error', () => {
        // camstreamerlib matches /Error:([^<]*)/ anywhere in the body, so a log line
        // or a parameter value containing the word makes a successful call throw.
        const body = 'root.ACAP.LastMessage=Error: disk full\nroot.ACAP.State=running';
        assert.equal(findTextError(body), null);
    });

    test('JSON errors are found regardless of the key inconsistencies in the docs', () => {
        assert.equal(findJsonError(JSON.parse(fx.BDI_FORBIDDEN))!.code, 2001);
        // Axis' own example uses the plural "apiVersions" here; the error object is
        // what matters and must still be found.
        assert.equal(findJsonError(JSON.parse(fx.BDI_ERROR_PLURAL_KEY))!.code, 1000);
        assert.equal(findJsonError(JSON.parse(fx.BDI_SUCCESS)), null);
    });
});

describe('param.cgi', () => {
    test('requests strip the root. prefix, as the docs require', async () => {
        const cam = m1137();
        await listParams(new VapixCore(cam), ['root.Brand', 'Properties']);
        assert.equal(cam.requests[0].parameters.group, 'Brand,Properties');
    });

    test('responses keep the root. prefix and are still findable by short name', async () => {
        const p = await listParams(new VapixCore(m1137()), ['Brand']);
        // Raw keys are preserved so `axis param get` echoes what the camera said...
        assert.ok(Object.keys(p.raw).some((k) => k.startsWith('root.')));
        // ...while lookups work with or without the prefix, and case-insensitively.
        assert.equal(p.get('Brand.ProdShortName'), 'AXIS M1137');
        assert.equal(p.get('root.Brand.ProdShortName'), 'AXIS M1137');
        assert.equal(p.get('brand.prodshortname'), 'AXIS M1137');
    });

    test('a value containing "=" is not truncated', () => {
        const parsed = parseParamLines(fx.PARAMS_WITH_EQUALS);
        assert.equal(parsed['root.Network.Bonjour.FriendlyName'], 'AXIS M1137 - a=b');
        assert.equal(parsed['root.ACAP.Config'], 'key=value&other=thing');
    });

    test('an error body throws instead of silently returning nothing', async () => {
        const cam = new MockCamera({ [PARAM]: { body: fx.PARAMS_ERROR } });
        // camstreamerlib skips "# Error" lines, so a rejected request yields {} —
        // indistinguishable from "the parameter is genuinely absent".
        await assert.rejects(() => listParams(new VapixCore(cam), ['Nonexistent']), VapixError);
    });

    test('tryListParams swallows that error, for probing', async () => {
        const cam = new MockCamera({ [PARAM]: { body: fx.PARAMS_ERROR } });
        const p = await tryListParams(new VapixCore(cam), ['Nonexistent']);
        assert.equal(p.size, 0);
    });

    test('writes go in the POST body, not the query string', async () => {
        const cam = new MockCamera({ [PARAM]: { body: 'OK' } });
        await updateParams(new VapixCore(cam), { 'root.Time.DST.Enabled': 'yes' });
        const req = cam.requests[0];
        assert.equal(req.method, 'POST');
        assert.deepEqual(req.parameters, {});
        // root. stripped here too, and the value is in the body so it stays out of logs.
        assert.match(String(req.body), /Time\.DST\.Enabled=yes/);
        assert.doesNotMatch(String(req.body), /root\./);
    });

    test('a failed write throws', async () => {
        const cam = new MockCamera({ [PARAM]: { body: "# Error: Error setting 'X' to 'Y'!" } });
        await assert.rejects(() => updateParams(new VapixCore(cam), { X: 'Y' }), VapixError);
    });

    test('ParamSet.under collects a subtree', () => {
        const p = new ParamSet(parseParamLines(fx.PARAMS_FW10_M1137));
        const ptz = p.under('Properties.PTZ');
        assert.equal(ptz['Properties.PTZ.DigitalPTZ'], 'yes');
        assert.equal(ptz['Properties.PTZ.PTZ'], 'no');
        assert.equal(Object.keys(ptz).length, 2);
    });

    test('stripRoot is anchored', () => {
        assert.equal(stripRoot('root.Brand.Brand'), 'Brand.Brand');
        // An unanchored replace would mangle any key containing "root." later on.
        assert.equal(stripRoot('Properties.Rootcert.root.x'), 'Properties.Rootcert.root.x');
    });
});

describe('applications/list.cgi parsing', () => {
    test('sparse AXIS OS 10 entries are kept, not rejected', () => {
        const apps = parseApplicationList(fx.APPS_FW10_SPARSE);
        assert.equal(apps.length, 3);
        const vmd = apps.find((a) => a.name === 'vmd')!;
        // The bundled VMD entry has no NiceName, Vendor or License. A schema
        // requiring those fields throws away the entire listing over this one entry.
        assert.equal(vmd.niceName, null);
        assert.equal(vmd.vendor, null);
        assert.equal(vmd.license, null);
        assert.equal(vmd.status, 'Running');
    });

    test('the full AXIS OS 12 attribute set is read, including nested elements', () => {
        const apps = parseApplicationList(fx.APPS_FW12_FULL);
        const co = apps.find((a) => a.name === 'CamOverlay')!;
        assert.equal(co.licenseExpirationDate, '2027-01-01');
        assert.equal(co.signatureStatus, 'Signed');
        assert.equal(co.bundled, false);
        assert.deepEqual(co.compatibleOsVersions, [{ min: '11.0', max: '12.99' }]);
    });

    test('SignedStatus is accepted as well as SignatureStatus', () => {
        // The prose docs say SignatureStatus, the XSD says SignedStatus.
        const oa = parseApplicationList(fx.APPS_FW12_FULL).find((a) => a.name === 'AXIS_Object_Analytics')!;
        assert.equal(oa.signatureStatus, 'Signed');
        assert.equal(oa.bundled, true);
    });

    test('version strings keep trailing zeros', () => {
        // With attribute value parsing on, "4.4-3" survives but a bare "1.20"
        // becomes the number 1.2 and loses meaning.
        const apps = parseApplicationList(fx.APPS_SINGLE);
        assert.equal(apps[0].version, '4.0.0');
    });

    test('one application parses as a list, not a bare object', () => {
        assert.equal(parseApplicationList(fx.APPS_SINGLE).length, 1);
    });

    test('no applications is an empty list, not an error', () => {
        assert.deepEqual(parseApplicationList(fx.APPS_NONE), []);
    });

    test('the documented error envelope is detected', () => {
        // <error> is a child element; guessing an attribute would parse as success.
        assert.throws(() => parseApplicationList(fx.APPS_ERROR), /gdbus call failed/);
    });

    test('a non-XML reply explains itself', () => {
        assert.throws(() => parseApplicationList(fx.APPS_NOT_XML), /did not return an application list/);
    });

    test('CamStreamer family members are tagged', () => {
        const apps = parseApplicationList(fx.APPS_FW10_SPARSE);
        assert.equal(apps.find((a) => a.name === 'CamScripter')!.familyId, 'CamScripter');
        assert.equal(apps.find((a) => a.name === 'vmd')!.familyId, null);
    });
});

describe('applications/control.cgi', () => {
    test('sends the exact Name, not a lowercased one', async () => {
        const cam = m1137();
        const core = new VapixCore(cam);
        const apps = parseApplicationList(fx.APPS_FW10_SPARSE);

        cam.route(CONTROL, { body: fx.CONTROL_OK });
        const app = resolveApplication(apps, 'camscripter');
        await controlApplication(core, 'start', app.name);

        const req = cam.requests.find((r) => r.path === CONTROL)!;
        // The old code sent package=camscripter. control.cgi matches Name exactly,
        // so anything but "CamScripter" fails with "error 4, application not found".
        assert.equal(req.parameters.package, 'CamScripter');
    });

    test('resolves a third-party ACAP by nice name', () => {
        const apps = parseApplicationList(fx.APPS_FW12_FULL);
        assert.equal(resolveApplication(apps, 'AXIS Object Analytics').name, 'AXIS_Object_Analytics');
        assert.equal(resolveApplication(apps, 'object').name, 'AXIS_Object_Analytics');
    });

    test('an unknown application lists what is installed', () => {
        const apps = parseApplicationList(fx.APPS_FW10_SPARSE);
        assert.throws(() => resolveApplication(apps, 'CamOverlay'), /Installed: CamScripter, CamStreamer, vmd/);
    });

    test('"already running" on start is success, not failure', async () => {
        const cam = new MockCamera({ [CONTROL]: { body: fx.CONTROL_ALREADY_RUNNING } });
        const result = await controlApplication(new VapixCore(cam), 'start', 'CamOverlay');
        // Idempotence matters: these commands end up in scripts and cron jobs.
        assert.equal(result.alreadyInState, true);
    });

    test('"not running" on stop is success', async () => {
        const cam = new MockCamera({ [CONTROL]: { body: fx.CONTROL_NOT_RUNNING } });
        const result = await controlApplication(new VapixCore(cam), 'stop', 'CamOverlay');
        assert.equal(result.alreadyInState, true);
    });

    test('"already running" on stop is still a failure', async () => {
        const cam = new MockCamera({ [CONTROL]: { body: fx.CONTROL_ALREADY_RUNNING } });
        await assert.rejects(
            () => controlApplication(new VapixCore(cam), 'stop', 'CamOverlay'),
            /already running/
        );
    });

    test('error codes become sentences', async () => {
        const cam = new MockCamera({ [CONTROL]: { body: fx.CONTROL_NOT_FOUND } });
        await assert.rejects(
            () => controlApplication(new VapixCore(cam), 'start', 'Nope'),
            /application not found on this camera/
        );
    });
});

describe('ACAP support gating', () => {
    test('info.cgi reports the SDKs the device accepts', async () => {
        const sdks = await getSupportedSdks(new VapixCore(m1137()));
        assert.deepEqual(sdks, ['acap3', 'acap4-cv', 'acap4-native']);
    });

    test('a camera without info.cgi returns null rather than throwing', async () => {
        assert.equal(await getSupportedSdks(new VapixCore(fw5())), null);
    });

    test('sdk elements with attributes yield names, not "[object Object]"', async () => {
        // What an M1137 on 10.12.300 actually sends. With attribute parsing on, an
        // element that has both text and attributes becomes an object, and stringifying
        // it printed "[object Object], [object Object]" in `caps` and `info`.
        const cam = m1137().route(INFO, { body: fx.APPS_INFO_SDKS_WITH_ATTRS });
        assert.deepEqual(await getSupportedSdks(new VapixCore(cam)), ['acap3', 'acap4-native']);
    });

    test('a single sdk element parses as a list', async () => {
        const cam = m1137().route(INFO, { body: fx.APPS_INFO_SDKS_SINGLE });
        assert.deepEqual(await getSupportedSdks(new VapixCore(cam)), ['acap3']);
    });

    test('an sdk name carried only in an attribute is still found', async () => {
        const cam = m1137().route(INFO, { body: fx.APPS_INFO_SDKS_ATTR_ONLY });
        assert.deepEqual(await getSupportedSdks(new VapixCore(cam)), ['acap4-native']);
    });

    test('capability detection surfaces the SDK list as plain strings', async () => {
        const cam = m1137().route(INFO, { body: fx.APPS_INFO_SDKS_WITH_ATTRS });
        const caps = await detectCapabilities(new VapixCore(cam));
        // The end-to-end guarantee: whatever reaches the display layer is joinable.
        assert.equal(caps.acap.supportedSdks!.join(', '), 'acap3, acap4-native');
        assert.ok(caps.acap.supportedSdks!.every((s) => typeof s === 'string'));
    });

    test('config.cgi is not attempted below AXIS OS 11.2', async () => {
        const cam = m1137();
        const value = await getAppConfig(new VapixCore(cam), 'AllowUnsigned', parseFirmware('10.12.338'));
        assert.equal(value, null);
        // Not merely null — the request must not have been made at all.
        assert.equal(cam.countRequests(CONFIG), 0);
    });

    test('config.cgi is read on AXIS OS 12', async () => {
        const value = await getAppConfig(new VapixCore(fw12()), 'AllowUnsigned', parseFirmware('12.11.77'));
        assert.equal(value, false);
    });

    test('a device with no ACAP support is refused with an explanation', () => {
        assert.throws(() => requireAcapSupport(null, parseFirmware('5.51.1.1')), UnsupportedError);
    });
});

describe('upload pre-flight', () => {
    test('an architecture mismatch blocks the upload', () => {
        const findings = preflightUpload({
            fileName: 'myapp_1_0_0_aarch64.eap',
            firmware: parseFirmware('10.12.338'),
            architecture: 'armv7hf',
            supportedSdks: ['acap3'],
        });
        const blocking = findings.filter((f) => f.blocking);
        assert.equal(blocking.length, 1);
        assert.match(blocking[0].message, /aarch64/);
        assert.match(blocking[0].message, /armv7hf/);
    });

    test('a matching architecture blocks nothing', () => {
        const findings = preflightUpload({
            fileName: 'myapp_1_0_0_armv7hf.eap',
            firmware: parseFirmware('10.12.338'),
            architecture: 'armv7hf',
            supportedSdks: ['acap3'],
        });
        assert.equal(findings.filter((f) => f.blocking).length, 0);
    });

    test('AllowUnsigned=false informs but must never block', () => {
        // This is the *default* from AXIS OS 12.0 and says nothing about the file in
        // hand. Blocking on it refused every upload to a stock 12.x camera, including
        // correctly signed packages — the normal case.
        const findings = preflightUpload({
            fileName: 'myapp_1_0_0_aarch64.eap',
            firmware: parseFirmware('12.11.77'),
            architecture: 'aarch64',
            supportedSdks: ['acap12'],
            allowUnsigned: false,
        });
        assert.equal(findings.filter((f) => f.blocking).length, 0);
        assert.ok(findings.some((f) => /unsigned/i.test(f.message)));
    });

    test('warns about the AXIS OS 12 unsigned default when the policy is unreadable', () => {
        const findings = preflightUpload({
            fileName: 'myapp_1_0_0_aarch64.eap',
            firmware: parseFirmware('12.11.77'),
            architecture: 'aarch64',
            supportedSdks: ['acap12'],
            allowUnsigned: null,
        });
        assert.ok(findings.some((f) => /From AXIS OS 12\.0/.test(f.message)));
    });

    test('falls back to the firmware-to-ACAP mapping when the device will not say', () => {
        const findings = preflightUpload({
            fileName: 'myapp_1_0_0_armv7hf.eap',
            firmware: parseFirmware('10.12.338'),
            architecture: 'armv7hf',
            supportedSdks: null,
        });
        assert.ok(findings.some((f) => /ACAP 3/.test(f.message)));
    });
});

/** Wrap a parsed disk list as a successful StorageReport. */
const ok_ = (disks: ReturnType<typeof parseDiskList>) => ({ status: 'ok' as const, disks: disks ?? [] });

describe('nested-element regressions (the "[object Object]" family)', () => {
    test('an application whose Version is a nested element still shows a version', () => {
        const apps = parseApplicationList(fx.APPS_NESTED_ELEMENTS);
        const a = apps[0];
        // Every one of these used to render "[object Object]" — in the apps table,
        // in info's ACAP list, and in the "Started X" confirmation.
        assert.equal(a.version, '1.20');
        assert.equal(a.niceName, 'Hello');
        assert.equal(a.status, 'Running');
        assert.ok(!JSON.stringify(a).includes('[object Object]'));
    });

    test('a status carried as a nested element still filters as running', () => {
        // apps list --running and the fleet health count both compare
        // status.toLowerCase() === 'running'; "[object Object]" made the app vanish
        // from the list and the fleet count read 0/N.
        const apps = parseApplicationList(fx.APPS_NESTED_ELEMENTS);
        assert.equal(apps.filter((a) => (a.status ?? '').toLowerCase() === 'running').length, 1);
    });

    test('a disk whose status is a nested element still reports a status', () => {
        const disks = parseDiskList(fx.DISKS_NESTED_STATUS)!;
        assert.equal(disks[0].status, 'OK');
        assert.ok(!describeSdCard(ok_(disks)).includes('[object Object]'));
    });

    test('a VersionRange with no usable bounds is dropped, not reported as nulls', () => {
        const apps = parseApplicationList(fx.APPS_VERSIONRANGE_TEXT);
        assert.equal(apps[0].compatibleOsVersions, null);
    });

    test('Min/Max work as attributes as well as child elements', () => {
        const apps = parseApplicationList(fx.APPS_VERSIONRANGE_ATTRS);
        assert.deepEqual(apps[0].compatibleOsVersions, [{ min: '11.0', max: '12.99' }]);
    });
});

describe('disk listing shape tolerance', () => {
    test('a namespaced root is still parsed', () => {
        // Hardcoding root.disks.disk made this look like "no SD card".
        assert.equal(parseDiskList(fx.DISKS_NAMESPACED)!.length, 1);
    });

    test('a missing <disks> wrapper is still parsed', () => {
        assert.equal(parseDiskList(fx.DISKS_NO_WRAPPER)!.length, 1);
    });

    test('two <disks> blocks are still parsed', () => {
        assert.equal(parseDiskList(fx.DISKS_TWO_BLOCKS)!.length, 2);
    });

    test('an HTML error page yields null, never an empty disk list', () => {
        // The critical distinction: null becomes "unreadable", [] becomes "none".
        // Reporting "no SD card" because we failed to parse the answer is the most
        // misleading thing this code could say.
        assert.equal(parseDiskList('<html><body>403 Forbidden</body></html>'), null);
        assert.equal(parseDiskList('not xml at all'), null);
    });

    test('an empty listing is still an empty listing', () => {
        assert.deepEqual(parseDiskList(fx.DISKS_NONE), []);
    });

    test('a non-numeric size is null rather than a wrong number', () => {
        const sd = findSdCard(ok_(parseDiskList(fx.DISKS_UNIT_SUFFIXED_SIZE)));
        assert.equal(sd!.totalSizeKb, null);
        // And the summary must not claim a capacity it does not have.
        assert.doesNotMatch(describeSdCard(ok_(parseDiskList(fx.DISKS_UNIT_SUFFIXED_SIZE))), /kB|MB|GB/);
    });
});

describe('a refused application listing is not an empty one', () => {
    test('a text-only <error> element is detected', () => {
        // <error>Access denied</error> parses to a string; reading only attributes
        // saw "no error" and reported zero installed ACAPs, exit 0.
        assert.throws(() => parseApplicationList(fx.APPS_ERROR_TEXT), /Access denied/);
    });

    test('a text-only <reply> is not treated as an empty listing', () => {
        assert.throws(() => parseApplicationList('<reply>Not authorized</reply>'), /unexpected reply|Not authorized/);
    });

    test('result="error" with no detail is still an error', () => {
        assert.throws(() => parseApplicationList('<reply result="error"></reply>'), /unspecified error/);
    });
});

describe('storage', () => {
    test('parses a mixed SD-and-share listing with mixed boolean styles', () => {
        const disks = parseDiskList(fx.DISKS_SD_AND_SHARE)!;
        assert.equal(disks.length, 2);
        const sd = findSdCard(ok_(disks))!;
        assert.equal(sd.status, 'OK');
        // "no" and "false" both appear in the same response; Axis documents this.
        assert.equal(sd.full, false);
        assert.equal(sd.encrypted, false);
        assert.equal(sd.filesystem, 'ext4');
    });

    test('a single disk parses as a list', () => {
        assert.equal(parseDiskList(fx.DISKS_SINGLE)!.length, 1);
    });

    test('no disks is an empty list', () => {
        assert.deepEqual(parseDiskList(fx.DISKS_NONE), []);
    });

    test('tells apart no-slot, empty-slot and could-not-ask', () => {
        // Three different answers that used to collapse into one "n/a": the first is
        // fine, the second may be a fault, the third is usually a permissions problem.
        assert.equal(describeSdCard({ status: 'unsupported' }), 'n/a');
        assert.equal(describeSdCard({ status: 'error', error: 'HTTP 403' }), 'unreadable');
        assert.match(describeSdCard(ok_(parseDiskList(fx.DISKS_EMPTY_SLOT))), /disconnected/);
        assert.match(describeSdCard(ok_(parseDiskList(fx.DISKS_SD_AND_SHARE))), /OK/);
    });

    test('a "connected" disk still reports its size', () => {
        // Keying only on "OK" hid the capacity of a disk that was reporting it
        // perfectly well; "connected" is an equally valid mounted state.
        const report = ok_(parseDiskList(fx.DISKS_CONNECTED_NOT_OK));
        assert.match(describeSdCard(report), /connected \(.*free of/);
    });

    test('attribute casing does not matter', () => {
        const disks = parseDiskList(fx.DISKS_ODD_CASING)!;
        assert.equal(disks.length, 1);
        assert.equal(disks[0].status, 'OK');
        assert.equal(disks[0].totalSizeKb, 1000);
    });

    test('edge storage needs LocalStorage=yes, not merely a Version', () => {
        // A device can publish the version while reporting LocalStorage=no; calling
        // disks/list.cgi on it only produces a failure to explain away.
        const no = new ParamSet(parseParamLines('root.Properties.LocalStorage.LocalStorage=no\nroot.Properties.LocalStorage.Version=1.00'));
        assert.equal(supportsLocalStorage(no), false);
        const yes = new ParamSet(parseParamLines(fx.PARAMS_FW10_M1137));
        assert.equal(supportsLocalStorage(yes), true);
    });

    test('a read failure is reported as such, not as "no storage"', async () => {
        const cam = new MockCamera({ [PARAM]: { body: fx.PARAMS_FW10_M1137 }, [DISKS]: { status: 403, body: '' } });
        const params = await listParams(new VapixCore(cam), ['Brand', 'Properties']);
        const report = await listDisks(new VapixCore(cam), params);
        assert.equal(report.status, 'error');
    });

    test('a device with no edge storage is not asked', async () => {
        const cam = new MockCamera({ [PARAM]: { body: fx.PARAMS_FW5_NO_STORAGE }, [DISKS]: { body: fx.DISKS_SINGLE } });
        const params = await listParams(new VapixCore(cam), ['Brand', 'Properties']);
        const report = await listDisks(new VapixCore(cam), params);
        assert.equal(report.status, 'unsupported');
        assert.equal(cam.countRequests(DISKS), 0);
    });

    test('sizes are rendered from the CGI kilobytes', () => {
        assert.equal(formatKb(null), '-');
        assert.equal(formatKb(62522368), '60 GB');
    });
});

describe('PTZ', () => {
    test('a fixed camera with digital PTZ reports zoom but no pan or tilt', async () => {
        const pos = await getPosition(new VapixCore(m1137()), 1);
        // "pan=nan" is what an M1137 actually sends. The old strict schema failed
        // here with "pan: expected number, received nan".
        assert.equal(pos.pan, null);
        assert.equal(pos.tilt, null);
        assert.equal(pos.zoom, 1);
        assert.equal(pos.autofocus, false);
    });

    test('a real dome reports every axis', async () => {
        const pos = await getPosition(new VapixCore(fw12()), 1);
        assert.equal(pos.pan, 12.5);
        assert.equal(pos.tilt, -30);
        assert.equal(pos.zoom, 4200);
        assert.equal(pos.autoiris, true);
    });

    test('an Error: body served as HTTP 200 still throws', async () => {
        const cam = new MockCamera({ [PTZ]: { body: fx.PTZ_ERROR } });
        await assert.rejects(() => getPosition(new VapixCore(cam), 1), VapixError);
    });

    test('the channel parameter is sent as camera=, which is what ptz.cgi documents', async () => {
        const cam = fw12();
        await getPosition(new VapixCore(cam), 2);
        const req = cam.requests.find((r) => r.path === PTZ)!;
        assert.equal(req.parameters.camera, 2);
        assert.equal(req.parameters.channel, undefined);
    });

    test('presets parse from the flat presetposno list', async () => {
        assert.deepEqual(await getPresets(new VapixCore(fw12()), 1), [
            { number: 1, name: 'Home' },
            { number: 2, name: 'Gate' },
            { number: 3, name: 'Loading bay' },
        ]);
    });

    test('available commands ignore indented argument lines', async () => {
        const commands = await getAvailableCommands(new VapixCore(m1137()), 1);
        assert.ok(commands.includes('areazoom'));
        assert.ok(commands.includes('zoom'));
        // "imagewidth" is an argument to center/areazoom, not a command.
        assert.ok(!commands.includes('imagewidth'));
    });

    test('an axis reported with an empty value is "not reported", not zero', () => {
        // Number('') is 0, so `pan=` read as a measured pan of zero — the wrong
        // answer on exactly the fixed cameras this file exists for, and it defeated
        // the "not reported by this camera" logic entirely.
        const cam = new MockCamera({ [PTZ]: { body: 'pan=\ntilt=   \nzoom=1500' } });
        return getPosition(new VapixCore(cam), 1).then((pos) => {
            assert.equal(pos.pan, null);
            assert.equal(pos.tilt, null);
            assert.equal(pos.zoom, 1500);
        });
    });

    test('autofocus is read whichever way the camera spells it', async () => {
        const cam = new MockCamera({ [PTZ]: { body: 'zoom=1\nautofocus=true\nautoiris=no' } });
        const pos = await getPosition(new VapixCore(cam), 1);
        assert.equal(pos.autofocus, true);
        assert.equal(pos.autoiris, false);
    });

    test('preset numbers are the camera\'s own, not row positions', async () => {
        // Preset numbers are not contiguous. Renumbering by row displayed a number
        // that does not exist on the camera, which anyone using
        // gotoserverpresetno would then act on.
        const cam = new MockCamera({ [PTZ]: { body: 'presetposno3=Gate\npresetposno7=Dock' } });
        assert.deepEqual(await getPresets(new VapixCore(cam), 1), [
            { number: 3, name: 'Gate' },
            { number: 7, name: 'Dock' },
        ]);
    });

    test('an unnamed preset is listed rather than silently dropped', async () => {
        // Dropping it shifted every later preset's position by one.
        const cam = new MockCamera({ [PTZ]: { body: 'presetposno1=\npresetposno2=Gate' } });
        const presets = await getPresets(new VapixCore(cam), 1);
        assert.equal(presets.length, 2);
        assert.deepEqual(presets[0], { number: 1, name: '' });
    });

    test('command names containing _ or - are not hidden', async () => {
        const cam = new MockCamera({ [PTZ]: { body: 'area_zoom=[x],[y]\nauto-focus=on\nzoom=[n]' } });
        const commands = await getAvailableCommands(new VapixCore(cam), 1);
        assert.deepEqual(commands, ['area_zoom', 'auto-focus', 'zoom']);
    });

    test('digital and mechanical PTZ are told apart', () => {
        const m = readPtzSupport(new ParamSet(parseParamLines(fx.PARAMS_FW10_M1137)));
        assert.equal(m.mechanical, false);
        assert.equal(m.digital, true);
        assert.equal(m.any, true);

        const dome = readPtzSupport(new ParamSet(parseParamLines(fx.PARAMS_FW12_PTZ)));
        assert.equal(dome.mechanical, true);
        assert.equal(dome.digital, false);
    });

    test('a camera with neither kind of PTZ is refused clearly', () => {
        const none = { mechanical: false, digital: false, any: false };
        assert.throws(() => requirePtz(none, parseFirmware('10.12.338'), 'cam1'), UnsupportedError);
        // Digital-only must NOT be refused — an M1137 can still zoom.
        assert.doesNotThrow(() =>
            requirePtz({ mechanical: false, digital: true, any: true }, parseFirmware('10.12.338'), 'cam1')
        );
    });
});

describe('device info', () => {
    test('prefers basicdeviceinfo.cgi when present', async () => {
        const info = await getDeviceInfo(new VapixCore(fw12()));
        assert.equal(info.source, 'basicdeviceinfo.cgi');
        assert.equal(info.architecture, 'aarch64');
        assert.equal(info.soc, 'Axis Artpec-8');
    });

    test('falls back to param.cgi when basicdeviceinfo.cgi is absent', async () => {
        // An M1137 on 10.12 has the CGI, but a device where it is disabled or
        // missing must still identify itself — this is the path that keeps the CLI
        // working from firmware 5.00 upward.
        const info = await getDeviceInfo(new VapixCore(m1137()));
        assert.equal(info.source, 'param.cgi');
        assert.equal(info.productShortName, 'AXIS M1137');
        assert.equal(info.firmwareVersion, '10.12.338');
        assert.equal(info.architecture, 'armv7hf');
    });

    test('a 403 from basicdeviceinfo.cgi falls back rather than failing', async () => {
        // getAllProperties needs Operator. A Viewer account must still get identity
        // via param.cgi instead of the whole command dying.
        const cam = m1137().route(BDI, { status: 200, body: fx.BDI_FORBIDDEN });
        const info = await getDeviceInfo(new VapixCore(cam));
        assert.equal(info.source, 'param.cgi');
    });

    test('firmware 5.x identifies itself through parameters alone', async () => {
        const info = await getDeviceInfo(new VapixCore(fw5()));
        assert.equal(info.productShortName, 'AXIS Q7401');
        assert.equal(info.firmwareVersion, '5.51.1.1');
        assert.equal(info.architecture, null);
    });

    test('apidiscovery.cgi is parsed into a lookup, or null when absent', async () => {
        const apis = await getApiList(new VapixCore(fw12()));
        assert.ok(apis!.has('event-streaming-over-websocket'));
        assert.equal(apis!.get('fwmgr')!.version, '1.4');
        assert.equal(await getApiList(new VapixCore(fw5())), null);
    });
});

describe('capability detection end to end', () => {
    test('AXIS OS 10.12 M1137', async () => {
        const cam = m1137();
        const caps = await detectCapabilities(new VapixCore(cam));

        assert.equal(caps.firmware.raw, '10.12.338');
        assert.match(caps.osTrack!, /AXIS OS 10/);
        assert.equal(caps.ptz.mechanical, false);
        assert.equal(caps.ptz.digital, true);
        assert.equal(caps.storage.supported, true);
        assert.equal(caps.acap.embeddedDevelopmentVersion, '2.16');
        assert.equal(caps.acap.canList, true);
        // config.cgi is AXIS OS 11.2+, so a 10.12 camera must report it unavailable.
        assert.equal(caps.acap.canConfig, false);
        assert.deepEqual(caps.acap.supportedSdks, ['acap3', 'acap4-cv', 'acap4-native']);
    });

    test('AXIS OS 12.11 dome', async () => {
        const caps = await detectCapabilities(new VapixCore(fw12()));
        assert.equal(caps.acap.canConfig, true);
        assert.equal(caps.ptz.mechanical, true);
        assert.equal(caps.firmwareManagement, true);
        assert.equal(caps.events.websocket, true);
        assert.equal(caps.device.source, 'basicdeviceinfo.cgi');
    });

    test('firmware 5.51 encoder degrades without erroring', async () => {
        const caps = await detectCapabilities(new VapixCore(fw5()));
        assert.equal(caps.apiDiscovery, false);
        assert.equal(caps.basicDeviceInfo, false);
        assert.equal(caps.firmwareManagement, false);
        // EmbeddedDevelopment 1.10 is below the 1.20 list.cgi requires.
        assert.equal(caps.acap.canList, false);
        assert.equal(caps.events.websocket, false);
        assert.equal(caps.events.soap, true);
    });

    test('WebSocket events are gated on discovery when discovery exists', async () => {
        // A 9.80 device: discovery is present and does NOT list the WebSocket API,
        // so discovery is authoritative and the answer is no.
        const cam = new MockCamera({
            [PARAM]: { body: fx.PARAMS_FW10_M1137.replace('10.12.338', '9.80.3.9') },
            [DISCOVERY]: { body: fx.DISCOVERY_FW9 },
            [LIST]: { body: fx.APPS_FW10_SPARSE },
            [INFO]: { body: fx.APPS_INFO_SDKS },
        });
        const caps = await detectCapabilities(new VapixCore(cam));
        assert.equal(caps.events.websocket, false);
        assert.ok(compatibilityNotes(caps).some((n) => /WebSocket/.test(n)));
    });

    test('without discovery, the version threshold decides', async () => {
        const cam = new MockCamera({
            [PARAM]: { body: fx.PARAMS_FW10_M1137.replace('10.12.338', '10.5.0') },
        });
        assert.equal((await detectCapabilities(new VapixCore(cam))).events.websocket, false);

        const newer = new MockCamera({
            [PARAM]: { body: fx.PARAMS_FW10_M1137.replace('10.12.338', '10.11.55') },
        });
        assert.equal((await detectCapabilities(new VapixCore(newer))).events.websocket, true);
    });

    test('a broken basicdeviceinfo.cgi must not fail capability detection', async () => {
        // This is the one that matters most: detectCapabilities runs before nearly
        // every command, so an in-band JSON error here used to take down info, caps,
        // ptz, apps, fleet and camera test on a camera whose param.cgi was perfect.
        const cam = m1137().route(BDI, { body: fx.BDI_INTERNAL_ERROR });
        const caps = await detectCapabilities(new VapixCore(cam));
        assert.equal(caps.device.source, 'param.cgi');
        assert.equal(caps.device.productShortName, 'AXIS M1137');
        assert.equal(caps.firmware.raw, '10.12.338');
    });

    test('a broken apidiscovery.cgi likewise falls back to parameters', async () => {
        const cam = m1137().route(DISCOVERY, { status: 500, body: '' });
        const caps = await detectCapabilities(new VapixCore(cam));
        assert.equal(caps.apis, null);
        // Properties.ApiDiscovery.ApiDiscovery=yes is still in the parameters.
        assert.equal(caps.apiDiscovery, true);
        // And the version threshold still decides WebSocket support.
        assert.equal(caps.events.websocket, true);
    });

    test('basicdeviceinfo.cgi is recognised from the parameter alone', async () => {
        // Needs the Properties. prefix. Without it this could never match, since only
        // Brand and Properties are listed — so an 8.4x device with no discovery was
        // reported as lacking an API it advertises.
        const cam = new MockCamera({ [PARAM]: { body: fx.PARAMS_FW8_BDI_PARAM_ONLY } });
        const caps = await detectCapabilities(new VapixCore(cam));
        assert.equal(caps.basicDeviceInfo, true);
        assert.equal(caps.apiDiscovery, false);
    });

    test('discovery omitting the WebSocket API does not veto a satisfied version', async () => {
        // Axis does not guarantee 10.11/10.12 register this id. Letting an absent id
        // override the version produced a self-refuting error: "firmware 10.12.338
        // does not support this; requires 10.11 or later".
        const cam = m1137().route(DISCOVERY, { body: fx.DISCOVERY_FW9 });
        const caps = await detectCapabilities(new VapixCore(cam));
        assert.equal(caps.events.websocket, true);
    });

    test('an unparseable version leaves config.cgi reported as available', async () => {
        // Must agree with getAppConfig, which uses `=== false` and so will attempt the
        // call. Reporting false would contradict what the code does.
        const cam = new MockCamera({
            [PARAM]: {
                body: 'root.Brand.Brand=AXIS\nroot.Properties.Firmware.Version=custom\nroot.Properties.EmbeddedDevelopment.Version=2.16',
            },
        });
        const caps = await detectCapabilities(new VapixCore(cam));
        assert.equal(caps.acap.canConfig, true);
    });

    test('canList compares the ACAP version as a version', async () => {
        const older = new MockCamera({
            [PARAM]: { body: fx.PARAMS_FW5_LEGACY.replace('1.10', '1.3') },
        });
        // 1.3 is older than 1.20, even though 1.3 > 1.2 as a float.
        assert.equal((await detectCapabilities(new VapixCore(older))).acap.canList, false);
        assert.equal((await detectCapabilities(new VapixCore(m1137()))).acap.canList, true);
    });

    test('an unknown firmware version is treated optimistically', async () => {
        // Refusing to act on a version we failed to parse would be worse than
        // letting the camera answer for itself.
        const cam = new MockCamera({
            [PARAM]: { body: 'root.Brand.Brand=AXIS\nroot.Properties.Firmware.Version=custom-build' },
        });
        const caps = await detectCapabilities(new VapixCore(cam));
        assert.equal(caps.events.websocket, true);
        assert.ok(compatibilityNotes(caps).some((n) => /parseable firmware version/.test(n)));
    });

    test('notes explain the AXIS OS 12 auth and signing changes', async () => {
        const notes = compatibilityNotes(await detectCapabilities(new VapixCore(fw12())));
        assert.ok(notes.some((n) => /12\.0/.test(n)));
        assert.ok(notes.some((n) => /12\.1/.test(n)));
        assert.ok(notes.some((n) => /without a default "root" account/.test(n)));
    });

    test('one probe serves the whole session', async () => {
        const cam = m1137();
        const core = new VapixCore(cam);
        await detectCapabilities(core);
        // Capability detection must be one param.cgi request, not one per feature —
        // otherwise fleet health multiplies it by the size of the fleet.
        assert.equal(cam.countRequests(PARAM), 1);
    });
});

describe('transport behaviour', () => {
    test('a 404 explains that the firmware may predate the API', async () => {
        const cam = new MockCamera({});
        await assert.rejects(
            () => new VapixCore(cam).getText('/axis-cgi/whatever.cgi'),
            /does not exist on this camera/
        );
    });

    test('a 401 mentions the missing default root user on modern firmware', async () => {
        const cam = new MockCamera({ [PARAM]: { status: 401, body: '' } });
        await assert.rejects(() => listParams(new VapixCore(cam), ['Brand']), /no default "root" user/);
    });

    test('a 403 names the privilege levels', async () => {
        const cam = new MockCamera({ [LIST]: { status: 403, body: '' } });
        await assert.rejects(() => new VapixCore(cam).callCgi(LIST), /Administrator/);
    });

    test('a bodyless POST that is rejected is retried as a GET', async () => {
        // Documented as POST-only, but some firmware and proxy combinations answer
        // 400 to a POST with no body while GET has always worked.
        let calls = 0;
        const cam = new MockCamera({
            [LIST]: {
                respond: () => {
                    calls++;
                    return calls === 1 ? { status: 400, body: '' } : { body: fx.APPS_SINGLE };
                },
            },
        });
        const apps = parseApplicationList(await new VapixCore(cam).callCgi(LIST));
        assert.equal(apps.length, 1);
        assert.equal(cam.requests[0].method, 'POST');
        assert.equal(cam.requests[1].method, 'GET');
    });

    test('204 counts as success', async () => {
        const cam = new MockCamera({ [PTZ]: { status: 204, body: '' } });
        // ptz.cgi answers 204 for control commands, so treating only 200 as success
        // would report every successful move as a failure.
        await assert.doesNotReject(() => new VapixCore(cam).getText(PTZ, { camera: 1, zoom: 100 }));
    });

    test('an optional JSON probe returns null on 404 rather than throwing', async () => {
        const cam = new MockCamera({});
        assert.equal(await new VapixCore(cam).postJsonOptional(BDI, { method: 'getAllProperties' }), null);
    });

    test('an optional JSON probe returns null for every in-band error code', async () => {
        // Not just 2003/2004. A probe's caller always has a fallback, so the only
        // useful answer is "this didn't work" — never an exception.
        for (const code of [1000, 2001, 2002, 2003, 2004, 4000, 4002, 8000]) {
            const cam = new MockCamera({
                [BDI]: { body: JSON.stringify({ apiVersion: '1.0', error: { code, message: 'x' } }) },
            });
            assert.equal(
                await new VapixCore(cam).postJsonOptional(BDI, { method: 'getAllProperties' }),
                null,
                `code ${code} should yield null`
            );
        }
    });

    test('postJson, by contrast, fails loudly and explains the code', async () => {
        const cam = new MockCamera({ [BDI]: { body: fx.BDI_FORBIDDEN } });
        await assert.rejects(
            () => new VapixCore(cam).postJson(BDI, { method: 'getAllProperties' }),
            /access forbidden/
        );
    });
});

describe('.eap upload', () => {
    const UPLOAD = '/axis-cgi/applications/upload.cgi';

    test('the multipart field is named "file"', async () => {
        const cam = new MockCamera({ [UPLOAD]: { body: 'OK' } });
        await uploadApplication(new VapixCore(cam), 'myapp_1_0_0_armv7hf.eap', new Uint8Array([1, 2, 3]));

        const req = cam.requests.find((r) => r.path === UPLOAD)!;
        const form = req.body as FormData;
        // Several third-party clients use "packfil", which Axis has never documented
        // and which the CGI ignores — producing a bewildering "error 1".
        assert.ok(form.has('file'));
        assert.equal((form.get('file') as File).name, 'myapp_1_0_0_armv7hf.eap');
        // Content-Type must be left unset so fetch generates the boundary.
        assert.equal(req.headers?.['Content-Type'], undefined);
    });

    test('upload error codes become sentences', async () => {
        const cam = new MockCamera({ [UPLOAD]: { body: fx.UPLOAD_NOT_COMPATIBLE } });
        await assert.rejects(
            () => uploadApplication(new VapixCore(cam), 'app.eap', new Uint8Array([1])),
            /not compatible with this device/
        );

        const unsigned = new MockCamera({ [UPLOAD]: { body: fx.UPLOAD_UNSIGNED } });
        await assert.rejects(
            () => uploadApplication(new VapixCore(unsigned), 'app.eap', new Uint8Array([1])),
            /signature/
        );
    });
});

describe('event topic parsing', () => {
    test('flattens the TopicSet tree into ONVIF topic expressions', () => {
        const topics = parseEventInstances(fx.EVENT_INSTANCES);
        assert.ok(topics.includes('tns1:VideoSource/tnsaxis:DayNightVision'));
        // ACAP events have a prefix on the first segment only, so filtering on
        // "contains a colon" would mangle them.
        assert.ok(topics.includes('tnsaxis:CameraApplicationPlatform/VMD/Camera1ProfileANY'));
    });

    test('aev:* metadata subtrees contribute no path segments', () => {
        const topics = parseEventInstances(fx.EVENT_INSTANCES);
        assert.ok(!topics.some((t) => t.includes('aev:')));
        assert.ok(!topics.some((t) => t.includes('MessageInstance')));
    });

    test('non-leaf branches are not offered as topics', () => {
        // Only elements marked wstop:topic="true" are subscribable.
        assert.ok(!parseEventInstances(fx.EVENT_INSTANCES).includes('tns1:VideoSource'));
    });

    test('a response with no TopicSet yields nothing rather than throwing', () => {
        assert.deepEqual(parseEventInstances('<s:Envelope><s:Body/></s:Envelope>'), []);
    });

    test('metadata elements under an unlisted prefix do not become topics', () => {
        // A fixed prefix allow-list let `axsev:MessageInstance` count as a topic
        // path segment, so the command printed a fabricated topic as a
        // ready-to-paste example — which the camera then rejected with "Could not
        // use supplied event filter", the exact confusion it exists to prevent.
        const topics = parseEventInstances(fx.EVENT_INSTANCES_ODD_PREFIX);
        assert.ok(!topics.some((t) => /Instance/i.test(t)));
        assert.ok(topics.includes('tns1:VideoSource/tnsaxis:MotionAlarm'));
    });

    test('unprefixed metadata elements are also excluded', () => {
        const topics = parseEventInstances(fx.EVENT_INSTANCES_NO_PREFIX);
        assert.ok(!topics.some((t) => /Instance/i.test(t)));
    });
});

describe('event line rendering', () => {
    test('a nested data value is JSON-encoded, not "[object Object]"', () => {
        const line = summariseForTest({
            params: { notification: { topic: 'tns1:X', timestamp: 1700000000000, message: { data: { coords: { x: 1 } } } } },
        });
        assert.match(line.detail, /coords=\{"x":1\}/);
    });

    test('a missing timestamp is admitted, never invented', () => {
        // Falling back to new Date() stamped the line with the current wall clock
        // and gave no hint it was made up. In a log of when things happened, a
        // plausible wrong time is worse than "(no timestamp)".
        const line = summariseForTest({ params: { notification: { topic: 'tns1:X' } } });
        assert.equal(line.timestamp, '(no timestamp)');
    });

    test('an ISO-string timestamp is used rather than discarded', () => {
        const line = summariseForTest({
            params: { notification: { topic: 'tns1:X', timestamp: '2026-07-29T10:00:00Z' } },
        });
        assert.equal(line.timestamp, '2026-07-29T10:00:00.000Z');
    });

    test('a seconds-based timestamp is not rendered as 1970', () => {
        const line = summariseForTest({ params: { notification: { topic: 'tns1:X', timestamp: 1700000000 } } });
        assert.match(line.timestamp, /^2023-/);
    });

    test('a scalar where an object was expected is not spelled out character by character', () => {
        // Object.entries('hello') gave "0=h 1=e 2=l 3=l 4=o".
        const line = summariseForTest({
            params: { notification: { topic: 'tns1:X', timestamp: 1700000000000, message: { data: 'hello' } } },
        });
        assert.equal(line.detail, 'data=hello');
    });
});
