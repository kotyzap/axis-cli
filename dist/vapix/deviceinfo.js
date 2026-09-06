"use strict";
/**
 * Device identity and API discovery.
 *
 * There are three ways to ask an Axis device who it is, and which of them work
 * depends entirely on the firmware:
 *
 *   basicdeviceinfo.cgi   AXIS OS 8.40+   JSON, richest (adds Soc, Architecture)
 *   apidiscovery.cgi      AXIS OS 8.50+   authoritative list of available APIs
 *   param.cgi             firmware 5.00+  always there, and the only option below 8.40
 *
 * AXIS OS 12.0 additionally made it possible to *disable* anonymous Basic Device
 * Info, and 12.0 removed `getBrand.cgi` and `axis-release/releaseinfo.cgi`
 * outright, so neither of the older shortcuts is a safe fallback any more.
 * param.cgi is.
 *
 * References:
 *   https://developer.axis.com/vapix/network-video/basic-device-information/
 *   https://developer.axis.com/vapix/network-video/api-discovery-service/
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeviceInfo = getDeviceInfo;
exports.deviceInfoFromParams = deviceInfoFromParams;
exports.getApiList = getApiList;
const params_1 = require("./params");
const BDI_CGI = '/axis-cgi/basicdeviceinfo.cgi';
const DISCOVERY_CGI = '/axis-cgi/apidiscovery.cgi';
/**
 * Read device identity, preferring the JSON API and falling back to parameters.
 *
 * `params` may be supplied when the caller has already listed Brand/Properties,
 * which avoids a second round-trip — worth it in `fleet health`, where this runs
 * once per camera.
 */
async function getDeviceInfo(core, options = {}) {
    const { params: preloaded, ...req } = options;
    // getAllProperties needs Operator and returns the most; getAllUnrestrictedProperties
    // needs nothing but omits Architecture, Soc and SocSerialNumber. Try the rich
    // one first, but fall through to the other if it is refused.
    for (const method of ['getAllProperties', 'getAllUnrestrictedProperties']) {
        const reply = await core.postJsonOptional(BDI_CGI, { apiVersion: '1.0', context: 'axis-cli', method }, req);
        const list = reply?.data?.propertyList;
        if (!list || Object.keys(list).length === 0)
            continue;
        // Looked up case-insensitively. Exact-case access meant a device that
        // capitalised a key differently produced an all-null result while still
        // passing the non-empty check above — no fallback, and `caps` would claim
        // the identity came from basicdeviceinfo.cgi.
        const pick = (key) => {
            const wanted = key.toLowerCase();
            for (const [k, v] of Object.entries(list)) {
                if (k.toLowerCase() !== wanted)
                    continue;
                if (typeof v === 'string')
                    return v.trim() === '' ? null : v;
                if (typeof v === 'number' || typeof v === 'boolean')
                    return String(v);
                return null; // an object here would render as "[object Object]"
            }
            return null;
        };
        const info = {
            brand: pick('Brand'),
            productFullName: pick('ProdFullName'),
            productShortName: pick('ProdShortName'),
            productNumber: pick('ProdNbr'),
            productType: pick('ProdType'),
            serialNumber: pick('SerialNumber'),
            firmwareVersion: pick('Version'),
            hardwareId: pick('HardwareID'),
            architecture: pick('Architecture'),
            soc: pick('Soc'),
            buildDate: pick('BuildDate'),
            source: 'basicdeviceinfo.cgi',
        };
        // Fill the gaps from parameters. This matters more than it looks:
        // getAllUnrestrictedProperties omits Architecture, which is the input to the
        // only *blocking* check in the .eap upload pre-flight. Without this merge, a
        // Viewer-level account silently disabled that check and the CLI would push a
        // whole package over the network to earn "package not compatible".
        const missing = Object.keys(info).filter((k) => k !== 'source' && info[k] === null);
        if (missing.length > 0) {
            const params = preloaded ?? (await (0, params_1.listParams)(core, ['Brand', 'Properties'], req).catch(() => null));
            if (params) {
                const fromParams = deviceInfoFromParams(params);
                for (const key of missing) {
                    if (key === 'source')
                        continue;
                    info[key] = fromParams[key];
                }
            }
        }
        return info;
    }
    return deviceInfoFromParams(preloaded ?? (await (0, params_1.listParams)(core, ['Brand', 'Properties'], req)));
}
/**
 * Device identity read purely from parameters.
 *
 * Split out so capability detection can use it as a last-resort fallback without
 * another request, if even the parameter-based path above somehow throws.
 */
function deviceInfoFromParams(p) {
    return {
        brand: p.get('Brand.Brand') ?? null,
        productFullName: p.get('Brand.ProdFullName') ?? null,
        productShortName: p.get('Brand.ProdShortName') ?? null,
        productNumber: p.get('Brand.ProdNbr') ?? null,
        productType: p.get('Brand.ProdType') ?? null,
        serialNumber: p.get('Properties.System.SerialNumber') ?? null,
        firmwareVersion: p.get('Properties.Firmware.Version') ?? null,
        hardwareId: p.get('Properties.System.HardwareID') ?? null,
        architecture: p.get('Properties.System.Architecture') ?? null,
        soc: p.get('Properties.System.Soc') ?? null,
        buildDate: p.get('Properties.Firmware.BuildDate') ?? null,
        source: 'param.cgi',
    };
}
/**
 * The device's own list of available APIs, or null when apidiscovery.cgi is not
 * there (below AXIS OS 8.50) or refused us.
 *
 * Worth noting for anyone debugging this: discovery is documented as anonymous,
 * *except* on AXIS OS 9.80 and 10.12, which require authentication. Since we
 * always send credentials that carve-out does not bite us, but it explains why
 * an unauthenticated curl against an M1137 fails where the CLI succeeds.
 */
async function getApiList(core, options = {}) {
    const reply = await core.postJsonOptional(DISCOVERY_CGI, { apiVersion: '1.0', context: 'axis-cli', method: 'getApiList' }, options);
    const list = reply?.data?.apiList;
    if (!Array.isArray(list))
        return null;
    const out = new Map();
    for (const entry of list) {
        if (!entry?.id)
            continue;
        out.set(entry.id, {
            id: entry.id,
            version: entry.version ?? '',
            status: entry.status ?? '',
        });
    }
    return out;
}
