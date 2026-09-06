/**
 * A camera session: the profile, a VAPIX transport, and lazily-probed capabilities.
 *
 * Capability detection costs one or two round-trips, so it must not happen on
 * every command unconditionally — but every command that branches on firmware
 * needs it. Making it a memoised accessor means a command pays for it only if it
 * asks, and never pays twice.
 */

import { getCamera, CameraProfile } from './config';
import { buildTransport } from './client';
import { VapixCore, RequestOptions, UnsupportedError } from './vapix/core';
import { Capabilities, detectCapabilities } from './capabilities';
import { AcapApplication, listApplications, requireAcapSupport } from './vapix/apps';

export class CameraSession {
    readonly core: VapixCore;
    private capsPromise?: Promise<Capabilities>;
    private appsPromise?: Promise<AcapApplication[]>;

    constructor(readonly profile: CameraProfile) {
        this.core = new VapixCore(buildTransport(profile));
    }

    get name(): string {
        return this.profile.name;
    }

    /** Probe the device, once per process. */
    caps(options: RequestOptions = {}): Promise<Capabilities> {
        this.capsPromise ??= detectCapabilities(this.core, options);
        return this.capsPromise;
    }

    /**
     * Installed ACAPs, once per process, refusing early on a device that cannot
     * run them at all so the error names the real problem.
     */
    async apps(options: RequestOptions = {}): Promise<AcapApplication[]> {
        if (!this.appsPromise) {
            const caps = await this.caps(options);
            requireAcapSupport(caps.acap.embeddedDevelopmentVersion, caps.firmware);
            // list.cgi needs EmbeddedDevelopment 1.20 or later. Without this check a
            // device that supports ACAPs but predates the listing CGI just 404s, and
            // the error blames a missing endpoint rather than naming the version.
            if (!caps.acap.canList) {
                throw new UnsupportedError(
                    `Camera "${this.name}" cannot list its installed applications: ` +
                        `applications/list.cgi needs Properties.EmbeddedDevelopment.Version 1.20 or later, ` +
                        `and this device reports ${caps.acap.embeddedDevelopmentVersion}.`,
                    {
                        requires: 'ACAP support version 1.20 or later',
                        firmware: caps.firmware,
                        docs: 'https://developer.axis.com/vapix/applications/application-api/',
                    }
                );
            }
            this.appsPromise = listApplications(this.core, options);
        }
        return this.appsPromise;
    }

    /**
     * Discard the memoised application list and re-read it.
     * Needed after installing or removing an ACAP, when the cached list is stale
     * by construction.
     */
    async refreshApps(options: RequestOptions = {}): Promise<AcapApplication[]> {
        this.appsPromise = undefined;
        return this.apps(options);
    }

    /** Is a CamStreamer-family ACAP installed and running? Used for actionable errors. */
    async familyStatus(familyId: string, options: RequestOptions = {}) {
        try {
            const apps = await this.apps(options);
            const app = apps.find((a) => a.familyId?.toLowerCase() === familyId.toLowerCase());
            return {
                installed: !!app,
                running: (app?.status ?? '').toLowerCase() === 'running',
                version: app?.version ?? null,
            };
        } catch {
            // Never let a diagnostic probe be the thing that fails a command.
            return null;
        }
    }
}

export function openCamera(name: string): CameraSession {
    return new CameraSession(getCamera(name));
}
