import chalk from 'chalk';

export function ok(msg: string) {
    console.log(chalk.green('✓'), msg);
}

export function info(msg: string) {
    console.log(chalk.cyan('ℹ'), msg);
}

export function warn(msg: string) {
    console.log(chalk.yellow('⚠'), msg);
}

export function fail(msg: string) {
    console.error(chalk.red('✗'), msg);
}

export function printJson(data: unknown) {
    console.log(JSON.stringify(data, null, 2));
}

/** Wraps an async command handler so rejected promises print a clean error instead of a raw stack trace. */
export function action(fn: (...args: any[]) => Promise<void>) {
    return async (...args: any[]) => {
        try {
            await fn(...args);
        } catch (err) {
            fail((err as Error).message);
            process.exitCode = 1;
        }
    };
}
