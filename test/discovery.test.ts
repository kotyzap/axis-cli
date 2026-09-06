/**
 * Pure-function tests for `axis discovery`.
 *
 * The network side (TCP probing, VAPIX identification, `arp -a`) is not
 * covered here — it needs a real interface and real hosts to mean anything,
 * which is exactly what `live-test.sh` is for. This file guards the logic
 * that decides which hosts to scan and which answers count as "Axis":
 * getting either wrong either misses a camera silently or, worse, scans
 * addresses the user never asked for.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { hostsInSubnet, isAxisMac, isAxisIdentity, suggestProfileName } from '../src/commands/discovery';
import type { DeviceInfo } from '../src/vapix/deviceinfo';

describe('hostsInSubnet', () => {
    test('a /24 yields 254 hosts, network and broadcast excluded', () => {
        const hosts = hostsInSubnet('192.168.1.0/24');
        assert.equal(hosts.length, 254);
        assert.equal(hosts[0], '192.168.1.1');
        assert.equal(hosts[hosts.length - 1], '192.168.1.254');
        assert.ok(!hosts.includes('192.168.1.0'));
        assert.ok(!hosts.includes('192.168.1.255'));
    });

    test('a /29 yields 6 hosts', () => {
        assert.deepEqual(hostsInSubnet('192.168.1.8/29'), [
            '192.168.1.9',
            '192.168.1.10',
            '192.168.1.11',
            '192.168.1.12',
            '192.168.1.13',
            '192.168.1.14',
        ]);
    });

    test('a host address (not the network address) still resolves the right range', () => {
        // Someone will paste their own IP here rather than the network address —
        // the scan should still cover the subnet that IP belongs to.
        assert.deepEqual(hostsInSubnet('192.168.1.130/29'), hostsInSubnet('192.168.1.128/29'));
    });

    test('a /16 does not overflow into the next octet', () => {
        const hosts = hostsInSubnet('10.0.0.0/16');
        assert.equal(hosts.length, 65534);
        assert.equal(hosts[0], '10.0.0.1');
        assert.equal(hosts[hosts.length - 1], '10.0.255.254');
    });

    test('rejects malformed CIDR input rather than scanning something unintended', () => {
        assert.throws(() => hostsInSubnet('not-an-ip'), /Invalid subnet/);
        assert.throws(() => hostsInSubnet('192.168.1.0'), /Invalid subnet/);
        assert.throws(() => hostsInSubnet('192.168.1.999/24'), /Invalid subnet/);
    });

    test('rejects a prefix outside /16-/30', () => {
        // /8 on a LAN scan is almost certainly a typo (192.168.1.0/8 meant /24),
        // and a /31 or /32 has no usable host range under this model.
        assert.throws(() => hostsInSubnet('10.0.0.0/8'), /Invalid subnet/);
        assert.throws(() => hostsInSubnet('192.168.1.0/31'), /Invalid subnet/);
        assert.throws(() => hostsInSubnet('192.168.1.1/32'), /Invalid subnet/);
    });
});

describe('isAxisMac', () => {
    test('recognises every registered Axis Communications AB OUI', () => {
        for (const mac of ['00:40:8c:11:22:33', 'AC:CC:8E:aa:bb:cc', 'b8:a4:4f:00:00:01', 'e8:27:25:ff:ff:ff']) {
            assert.equal(isAxisMac(mac), true, mac);
        }
    });

    test('a MAC from an unrelated vendor is not mistaken for Axis', () => {
        assert.equal(isAxisMac('00:1a:2b:3c:4d:5e'), false);
    });

    test('an empty or malformed MAC is treated as unknown, not Axis', () => {
        assert.equal(isAxisMac(''), false);
        assert.equal(isAxisMac('garbage'), false);
    });
});

describe('isAxisIdentity', () => {
    const base: DeviceInfo = {
        brand: null,
        productFullName: null,
        productShortName: null,
        productNumber: null,
        productType: null,
        serialNumber: null,
        firmwareVersion: null,
        hardwareId: null,
        architecture: null,
        soc: null,
        buildDate: null,
        source: 'param.cgi',
    };

    test('basicdeviceinfo.cgi answering at all is a confirmed signal, brand or not', () => {
        // getAllUnrestrictedProperties can omit Brand on some firmware; the CGI
        // itself only exists on Axis devices, so its presence alone is enough.
        assert.equal(isAxisIdentity({ ...base, source: 'basicdeviceinfo.cgi', brand: null }), true);
    });

    test('a param.cgi identity is only trusted when Brand says AXIS', () => {
        assert.equal(isAxisIdentity({ ...base, source: 'param.cgi', brand: 'AXIS' }), true);
        assert.equal(isAxisIdentity({ ...base, source: 'param.cgi', brand: 'axis' }), true);
    });

    test('a param.cgi reply with no Axis brand is not treated as a camera', () => {
        // This is the boundary that keeps a stray non-Axis web server exposing a
        // path that happens to look like param.cgi from being reported as found.
        assert.equal(isAxisIdentity({ ...base, source: 'param.cgi', brand: null }), false);
        assert.equal(isAxisIdentity({ ...base, source: 'param.cgi', brand: 'SomeOtherVendor' }), false);
    });
});

describe('suggestProfileName (for `axis discovery --add`)', () => {
    test('strips the "AXIS " prefix and lowercases the model', () => {
        assert.equal(suggestProfileName({ model: 'AXIS Q1656', ip: '192.168.1.50' }, new Set()), 'q1656');
    });

    test('non-alphanumeric characters become single dashes', () => {
        assert.equal(
            suggestProfileName({ model: 'AXIS M1137 Network Camera', ip: '192.168.1.50' }, new Set()),
            'm1137-network-camera'
        );
    });

    test('falls back to the IP when there is no model', () => {
        assert.equal(suggestProfileName({ model: '', ip: '192.168.1.50' }, new Set()), '192-168-1-50');
    });

    test('a name collision gets a numeric suffix, not silently overwritten', () => {
        const existing = new Set(['q1656']);
        assert.equal(suggestProfileName({ model: 'AXIS Q1656', ip: '192.168.1.51' }, existing), 'q1656-2');
    });

    test('multiple collisions increment past every taken suffix', () => {
        const existing = new Set(['q1656', 'q1656-2', 'q1656-3']);
        assert.equal(suggestProfileName({ model: 'AXIS Q1656', ip: '192.168.1.51' }, existing), 'q1656-4');
    });
});
