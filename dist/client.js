"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClient = buildClient;
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
    async get(params) {
        return fetch(this.buildUrl(params.path, params.parameters), { headers: params.headers });
    }
    async post(params) {
        return fetch(this.buildUrl(params.path, params.parameters), {
            method: 'POST',
            headers: params.headers,
            body: params.data,
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
    });
}
/** Plain connection options, for modules that still take {ip,port,user,pass,tls} directly (e.g. VapixEvents). */
function connectionOptions(cam) {
    return {
        ip: cam.ip,
        port: cam.port,
        user: cam.user,
        pass: cam.pass,
        tls: cam.tls,
    };
}
