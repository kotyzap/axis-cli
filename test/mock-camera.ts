/**
 * A fake camera: a VapixTransport that answers from a routing table.
 *
 * This lets the whole stack above the socket — VapixCore, the parsers, capability
 * detection — be exercised against a chosen firmware generation. Without it,
 * "does this work on AXIS OS 10?" can only be answered by owning an AXIS OS 10
 * device, which is precisely the problem this compatibility work is trying to
 * solve.
 *
 * Faithfulness details that matter, because getting them wrong would make the
 * tests pass while the real thing fails:
 *  - a missing route returns **404**, like a camera that lacks the CGI;
 *  - a route can return HTTP 200 with an error body, which is how VAPIX
 *    actually reports most failures;
 *  - every request is recorded, so tests can assert on what was sent (the exact
 *    `package=` value, whether `root.` was stripped) rather than only on results.
 */

import type { VapixResponse, VapixTransport } from '../src/vapix/core';

/** A fixed reply, or a function of the request parameters. */
export type Route =
    | {
          /** HTTP status to answer with. Defaults to 200. */
          status?: number;
          body: string;
          respond?: never;
      }
    | {
          status?: never;
          body?: never;
          /** Called with the parameters, so one path can answer differently per query. */
          respond: (parameters: Record<string, unknown>) => { status?: number; body: string };
      };

export type RecordedRequest = {
    method: 'GET' | 'POST';
    path: string;
    parameters: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
};

function makeResponse(status: number, body: string): VapixResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
        headers: { get: () => null },
    };
}

export class MockCamera implements VapixTransport {
    readonly requests: RecordedRequest[] = [];

    constructor(private routes: Record<string, Route>) {}

    /** Add or replace a route mid-test. */
    route(path: string, route: Route) {
        this.routes[path] = route;
        return this;
    }

    /** Remove a route, so the camera starts 404ing it — i.e. "older firmware". */
    unroute(path: string) {
        delete this.routes[path];
        return this;
    }

    /** How many times a path was requested. Used to assert on caching. */
    countRequests(path: string): number {
        return this.requests.filter((r) => r.path === path).length;
    }

    private handle(
        method: 'GET' | 'POST',
        path: string,
        parameters: Record<string, unknown> = {},
        body?: unknown,
        headers?: Record<string, string>
    ): Promise<VapixResponse> {
        this.requests.push({ method, path, parameters, body, headers });
        const route = this.routes[path];
        if (!route) return Promise.resolve(makeResponse(404, 'Not Found'));
        const result = route.respond ? route.respond(parameters) : { status: route.status, body: route.body };
        return Promise.resolve(makeResponse(result.status ?? 200, result.body ?? ''));
    }

    get(params: {
        path: string;
        parameters?: Record<string, unknown>;
        headers?: Record<string, string>;
        timeout?: number;
    }) {
        return this.handle('GET', params.path, params.parameters, undefined, params.headers);
    }

    post(params: {
        path: string;
        data: unknown;
        parameters?: Record<string, unknown>;
        headers?: Record<string, string>;
        timeout?: number;
    }) {
        return this.handle('POST', params.path, params.parameters, params.data, params.headers);
    }
}
