import { DefaultClient } from 'camstreamerlib/node';
import type { CameraProfile } from './config';

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

    async get(params: { path: string; parameters?: Record<string, unknown>; headers?: Record<string, string> }) {
        return fetch(this.buildUrl(params.path, params.parameters), { headers: params.headers });
    }

    async post(params: {
        path: string;
        data: any;
        parameters?: Record<string, unknown>;
        headers?: Record<string, string>;
    }) {
        return fetch(this.buildUrl(params.path, params.parameters), {
            method: 'POST',
            headers: params.headers,
            body: params.data,
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
    });
}

/** Plain connection options, for modules that still take {ip,port,user,pass,tls} directly (e.g. VapixEvents). */
export function connectionOptions(cam: CameraProfile) {
    return {
        ip: cam.ip,
        port: cam.port,
        user: cam.user,
        pass: cam.pass,
        tls: cam.tls,
    };
}
