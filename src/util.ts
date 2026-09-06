import * as readline from 'readline';

/**
 * Parse an integer CLI value, failing loudly instead of silently producing NaN.
 * Fixes B3: `--port abc` used to be stored as `null`.
 */
export function parseIntOrThrow(value: unknown, label: string, opts: { min?: number; max?: number } = {}): number {
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
export function parseKeyValue(pairs: string[], what = 'param'): Record<string, string> {
    const out: Record<string, string> = {};
    for (const kv of pairs) {
        const idx = kv.indexOf('=');
        if (idx === -1) throw new Error(`Invalid ${what} "${kv}", expected key=value`);
        out[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
    return out;
}

/**
 * Read a secret from the terminal without echoing it.
 * Fixes S1: keeps passwords out of shell history and out of `ps` output.
 */
export function promptSecret(question: string): Promise<string> {
    if (!process.stdin.isTTY) {
        return Promise.reject(
            new Error(`Cannot prompt for a secret: stdin is not a terminal. Pass the value as a flag or via an environment variable.`)
        );
    }

    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

        // Suppress echo: swallow everything the readline interface tries to write
        // after the prompt itself has been printed once.
        let promptWritten = false;
        const output = rl as unknown as { output: NodeJS.WritableStream; _writeToOutput?: (s: string) => void };
        output._writeToOutput = (str: string) => {
            if (!promptWritten) {
                process.stdout.write(question);
                promptWritten = true;
                return;
            }
            if (str.includes('\n')) process.stdout.write('\n');
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
export async function resolveSecret(
    flagValue: string | undefined,
    envVar: string,
    prompt: string
): Promise<string | undefined> {
    if (flagValue) return flagValue;
    if (process.env[envVar]) return process.env[envVar];
    if (!process.stdin.isTTY) return undefined;
    const value = await promptSecret(prompt);
    return value || undefined;
}

/**
 * Read one line of plain (echoed) input, e.g. for `axis discovery --add`
 * confirmations. Unlike promptSecret, this is for non-sensitive values —
 * profile names, usernames — where seeing what you typed matters more than
 * hiding it.
 */
export function promptLine(question: string, defaultValue?: string): Promise<string> {
    if (!process.stdin.isTTY) {
        return Promise.reject(
            new Error('Cannot prompt: stdin is not a terminal. Run this in an interactive shell.')
        );
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
export async function promptYesNo(question: string, defaultYes = false): Promise<boolean> {
    const answer = (await promptLine(`${question} (${defaultYes ? 'Y/n' : 'y/N'})`)).toLowerCase();
    if (answer === '') return defaultYes;
    return answer === 'y' || answer === 'yes';
}
