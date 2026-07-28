"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCameras = listCameras;
exports.getCamera = getCamera;
exports.addCamera = addCamera;
exports.removeCamera = removeCamera;
exports.configPath = configPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const CONFIG_DIR = path.join(os.homedir(), '.axis-cli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
}
function readConfig() {
    ensureConfigDir();
    if (!fs.existsSync(CONFIG_PATH)) {
        return { cameras: [] };
    }
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`Failed to read config at ${CONFIG_PATH}: ${err.message}`);
    }
}
function writeConfig(cfg) {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
function listCameras() {
    return readConfig().cameras;
}
function getCamera(name) {
    const cam = readConfig().cameras.find((c) => c.name === name);
    if (!cam) {
        const names = listCameras().map((c) => c.name);
        throw new Error(`No camera profile named "${name}". Known profiles: ${names.length ? names.join(', ') : '(none — run "axis camera add" first)'}`);
    }
    return cam;
}
function addCamera(cam) {
    const cfg = readConfig();
    if (cfg.cameras.some((c) => c.name === cam.name)) {
        throw new Error(`A camera profile named "${cam.name}" already exists. Remove it first or pick another name.`);
    }
    cfg.cameras.push(cam);
    writeConfig(cfg);
}
function removeCamera(name) {
    const cfg = readConfig();
    const before = cfg.cameras.length;
    cfg.cameras = cfg.cameras.filter((c) => c.name !== name);
    if (cfg.cameras.length === before) {
        throw new Error(`No camera profile named "${name}".`);
    }
    writeConfig(cfg);
}
function configPath() {
    return CONFIG_PATH;
}
