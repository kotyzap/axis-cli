import { DefaultClient } from 'camstreamerlib/node';
import type { CameraProfile } from './config';
import type { VapixTransport } from './vapix/core';

/**
 * Minimal IClient implementation for cameras accessed remotely via
 * CamStreamer Cloud (device-connect.net), which authenticates with a
 * DEVICE_ACCESS_TOKEN query parameter instead of Basic/Digest auth.
 */
class CloudClient {
    constructor(private baseUrl: string, private token: string) {}

    private buildUrl(path: string, parameters?: Record<string, unknown>) {
        const url = new URL(this.baseUrl.replace(/\/$/, '') + path);
        for (const [k, v] of Object.entries(parameters ?? {})) {
            if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
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
    private signal(timeout?: number) {
        return timeout === undefined ? undefined : AbortSignal.timeout(timeout);
    }

    async get(params: {
        path: string;
        parameters?: Record<string, unknown>;
        headers?: Record<string, string>;
        timeout?: number;
    }) {
        return fetch(this.buildUrl(params.path, params.parameters), {
            headers: params.headers,
            signal: this.signal(params.timeout),
        });
    }

    async post(params: {
        path: string;
        data: any;
        parameters?: Record<string, unknown>;
        headers?: Record<string, string>;
        timeout?: number;
    }) {
        return fetch(this.buildUrl(params.path, params.parameters), {
            method: 'POST',
            headers: params.headers,
            body: params.data,
            signal: this.signal(params.timeout),
        });
    }
}

export function buildClient(cam: CameraProfile) {
    if (cam.cloudUrl && cam.cloudToken) {
        return new CloudClient(cam.cloudUrl, cam.cloudToken);
    }
    return new DefaultClient({
        ip: cam.ip,
        port: cam.port,
        user: cam.user,
        pass: cam.pass,
        tls: cam.tls,
        tlsInsecure: cam.tlsInsecure,
    });
}

/** The same client, typed for the hardened VAPIX layer in src/vapix/. */
export function buildTransport(cam: CameraProfile): VapixTransport {
    return buildClient(cam) as unknown as VapixTransport;
}

/** Plain connection options, for modules that still take {ip,port,user,pass,tls} directly (e.g. VapixEvents). */
export function connectionOptions(cam: CameraProfile) {
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
