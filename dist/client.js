"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClient = buildClient;
exports.buildTransport = buildTransport;
exports.connectionOptions = connectionOptions;
const node_1 = require("camstreamerlib/node");
/**
 * Minimal IClient implementation for cameras accessed remotely via
 * CamStreamer Cloud (device-connect.net), which authenticates with a
 * DEVICE_ACCESS_TOKEN query parameter instead of Basic/Digest auth.
 */
class CloudClient {
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    buildUrl(path, parameters) {
        const url = new URL(this.baseUrl.replace(/\/$/, '') + path);
        for (const [k, v] of Object.entries(parameters ?? {})) {
            if (v !== undefined && v !== null)
                url.searchParams.set(k, String(v));
        }
        url.searchParams.set('DEVICE_ACCESS_TOKEN', this.token);
        return url.toString();
    }
    /**
     * Cloud requests traverse the internet and a relay, so an unbounded fetch can
     * hang far longer than the same call would on the LAN. Honour the timeout the
     * VAPIX layer passes instead of silently dropping it — without this,
     * "fleet health --timeout" had no effect on cloud profiles.
     */
    signal(timeout) {
        return timeout === undefined ? undefined : AbortSignal.timeout(timeout);
    }
    async get(params) {
        return fetch(this.buildUrl(params.path, params.parameters), {
            headers: params.headers,
            signal: this.signal(params.timeout),
        });
    }
    async post(params) {
        return fetch(this.buildUrl(params.path, params.parameters), {
            method: 'POST',
            headers: params.headers,
            body: params.data,
            signal: this.signal(params.timeout),
        });
    }
}
function buildClient(cam) {
    if (cam.cloudUrl && cam.cloudToken) {
        return new CloudClient(cam.cloudUrl, cam.cloudToken);
    }
    return new node_1.DefaultClient({
        ip: cam.ip,
        port: cam.port,
        user: cam.user,
        pass: cam.pass,
        tls: cam.tls,
        tlsInsecure: cam.tlsInsecure,
    });
}
/** The same client, typed for the hardened VAPIX layer in src/vapix/. */
function buildTransport(cam) {
    return buildClient(cam);
}
/** Plain connection options, for modules that still take {ip,port,user,pass,tls} directly (e.g. VapixEvents). */
function connectionOptions(cam) {
    return {
        ip: cam.ip,
        port: cam.port,
        user: cam.user,
        pass: cam.pass,
        tls: cam.tls,
        // Was omitted, which made `events watch` reject the self-signed
        // certificate on any --tls profile even though the profile said
        // --tls-insecure. VapixEvents reads this to configure the WSS socket.
        tlsInsecure: cam.tlsInsecure,
    };
}
