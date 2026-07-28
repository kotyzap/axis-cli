import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type CameraProfile = {
    name: string;
    ip: string;
    port: number;
    user: string;
    pass: string;
    tls: boolean;
    /** Optional CamStreamer Cloud device-connect.net URL, used instead of ip/port when set */
    cloudUrl?: string;
    /** Optional CamStreamer Cloud DEVICE_ACCESS_TOKEN, used instead of user/pass when cloudUrl is set */
    cloudToken?: string;
};

type ConfigFile = {
    cameras: CameraProfile[];
};

const CONFIG_DIR = path.join(os.homedir(), '.axis-cli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
}

function readConfig(): ConfigFile {
    ensureConfigDir();
    if (!fs.existsSync(CONFIG_PATH)) {
        return { cameras: [] };
    }
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(raw) as ConfigFile;
    } catch (err) {
        throw new Error(`Failed to read config at ${CONFIG_PATH}: ${(err as Error).message}`);
    }
}

function writeConfig(cfg: ConfigFile) {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function listCameras(): CameraProfile[] {
    return readConfig().cameras;
}

export function getCamera(name: string): CameraProfile {
    const cam = readConfig().cameras.find((c) => c.name === name);
    if (!cam) {
        const names = listCameras().map((c) => c.name);
        throw new Error(
            `No camera profile named "${name}". Known profiles: ${names.length ? names.join(', ') : '(none — run "axis camera add" first)'}`
        );
    }
    return cam;
}

export function addCamera(cam: CameraProfile) {
    const cfg = readConfig();
    if (cfg.cameras.some((c) => c.name === cam.name)) {
        throw new Error(`A camera profile named "${cam.name}" already exists. Remove it first or pick another name.`);
    }
    cfg.cameras.push(cam);
    writeConfig(cfg);
}

export function removeCamera(name: string) {
    const cfg = readConfig();
    const before = cfg.cameras.length;
    cfg.cameras = cfg.cameras.filter((c) => c.name !== name);
    if (cfg.cameras.length === before) {
        throw new Error(`No camera profile named "${name}".`);
    }
    writeConfig(cfg);
}

export function configPath(): string {
    return CONFIG_PATH;
}
