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
exports.parseIntOrThrow = parseIntOrThrow;
exports.parseKeyValue = parseKeyValue;
exports.promptSecret = promptSecret;
exports.resolveSecret = resolveSecret;
exports.promptLine = promptLine;
exports.promptYesNo = promptYesNo;
const readline = __importStar(require("readline"));
/**
 * Parse an integer CLI value, failing loudly instead of silently producing NaN.
 * Fixes B3: `--port abc` used to be stored as `null`.
 */
function parseIntOrThrow(value, label, opts = {}) {
    const raw = String(value).trim();
    if (!/^-?\d+$/.test(raw)) {
        throw new Error(`Invalid ${label} "${raw}" — expected a whole number.`);
    }
    const n = parseInt(raw, 10);
    if (opts.min !== undefined && n < opts.min) {
        throw new Error(`Invalid ${label} "${raw}" — must be >= ${opts.min}.`);
    }
    if (opts.max !== undefined && n > opts.max) {
        throw new Error(`Invalid ${label} "${raw}" — must be <= ${opts.max}.`);
    }
    return n;
}
/** Split "key=value" pairs, preserving '=' inside the value. */
function parseKeyValue(pairs, what = 'param') {
    const out = {};
    for (const kv of pairs) {
        const idx = kv.indexOf('=');
        if (idx === -1)
            throw new Error(`Invalid ${what} "${kv}", expected key=value`);
        out[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
    return out;
}
/**
 * Read a secret from the terminal without echoing it.
 * Fixes S1: keeps passwords out of shell history and out of `ps` output.
 */
function promptSecret(question) {
    if (!process.stdin.isTTY) {
        return Promise.reject(new Error(`Cannot prompt for a secret: stdin is not a terminal. Pass the value as a flag or via an environment variable.`));
    }
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        // Suppress echo: swallow everything the readline interface tries to write
        // after the prompt itself has been printed once.
        let promptWritten = false;
        const output = rl;
        output._writeToOutput = (str) => {
            if (!promptWritten) {
                process.stdout.write(question);
                promptWritten = true;
                return;
            }
            if (str.includes('\n'))
                process.stdout.write('\n');
        };
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
        rl.on('SIGINT', () => {
            rl.close();
            process.stdout.write('\n');
            reject(new Error('Cancelled.'));
        });
    });
}
/**
 * Resolve a secret from, in order: an explicit CLI flag, an environment
 * variable, then an interactive hidden prompt.
 */
async function resolveSecret(flagValue, envVar, prompt) {
    if (flagValue)
        return flagValue;
    if (process.env[envVar])
        return process.env[envVar];
    if (!process.stdin.isTTY)
        return undefined;
    const value = await promptSecret(prompt);
    return value || undefined;
}
/**
 * Read one line of plain (echoed) input, e.g. for `axis discovery --add`
 * confirmations. Unlike promptSecret, this is for non-sensitive values —
 * profile names, usernames — where seeing what you typed matters more than
 * hiding it.
 */
function promptLine(question, defaultValue) {
    if (!process.stdin.isTTY) {
        return Promise.reject(new Error('Cannot prompt: stdin is not a terminal. Run this in an interactive shell.'));
    }
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : '';
        rl.question(`${question}${suffix}: `, (answer) => {
            rl.close();
            const trimmed = answer.trim();
            resolve(trimmed === '' && defaultValue !== undefined ? defaultValue : trimmed);
        });
        rl.on('SIGINT', () => {
            rl.close();
            process.stdout.write('\n');
            reject(new Error('Cancelled.'));
        });
    });
}
/** A yes/no prompt. Empty input takes `defaultYes`. */
async function promptYesNo(question, defaultYes = false) {
    const answer = (await promptLine(`${question} (${defaultYes ? 'Y/n' : 'y/N'})`)).toLowerCase();
    if (answer === '')
        return defaultYes;
    return answer === 'y' || answer === 'yes';
}
