/**
 * `axis preflight` — will these cameras survive the AXIS OS 13 upgrade?
 *
 * Read-only throughout: it lists applications and reads parameters, both of
 * which every other command here already does. Nothing is written, nothing is
 * installed, and no ACAP is contacted.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { listCameras, CameraProfile } from '../config';
import { CameraSession, openCamera } from '../session';
import { action, info, isJsonMode, ok, printJson, printTable, warn } from '../output';
import { parseIntOrThrow } from '../util';
import { describeError } from '../output';
import { ParamSet, tryListParams } from '../vapix/params';
import { evaluate, Finding, PreflightResult, Severity, VERDICT_LABEL } from '../preflight/engine';
import { renderReport } from '../preflight/report';
import { writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const ruleset = require('../preflight/rules.json');

const SEVERITY_COLOUR: Record<Severity, (s: string) => string> = {
    blocking: chalk.red,
    degraded: chalk.yellow,
    advisory: chalk.cyan,
    unknown: chalk.magenta,
};

type CameraReport = {
    camera: string;
    reachable: boolean;
    product: string | null;
    firmware: string | null;
    architecture: string | null;
    result: PreflightResult | null;
    error?: string;
};

async function scan(cam: CameraSession, targetOsMajor: number, timeout: number): Promise<CameraReport> {
    const options = { timeout };
    const caps = await cam.caps(options);

    // The parameter groups the C rules read. One request, and Brand/Properties
    // are already in caps.params from the capability probe.
    // tryListParams, not listParams: one non-existent group fails the whole
    // request, and Image/Network.UPnP genuinely do not exist on every generation.
    // A missing group must leave the rule silent, not abort the scan.
    const extra = await tryListParams(
        cam.core,
        ['System.BoaGroupPolicy', 'Network.HTTP', 'Network.UPnP', 'Image'],
        options
    );
    const params = new ParamSet({ ...caps.params.raw, ...extra.raw });

    let apps = null;
    let appsUnavailableReason: string | undefined;
    try {
        apps = await cam.apps(options);
    } catch (err) {
        // Listing applications needs Administrator while the rest needs less, so
        // this is a normal outcome on a restricted account — and it must degrade
        // to "unknown", never to a clean pass.
        appsUnavailableReason = describeError(err as Error).split('\n')[0];
    }

    return {
        camera: cam.name,
        reachable: true,
        product: caps.device.productShortName ?? caps.device.productFullName ?? null,
        firmware: caps.device.firmwareVersion ?? null,
        architecture: caps.device.architecture ?? null,
        result: evaluate({
            targetOsMajor,
            firmware: caps.firmware,
            architecture: caps.device.architecture,
            productNumber: caps.device.productNumber,
            apps,
            appsUnavailableReason,
            params,
        }),
    };
}

function verdictCell(r: CameraReport): string {
    if (!r.reachable) return chalk.grey('unreachable');
    const v = r.result!.verdict;
    const label = VERDICT_LABEL[v];
    if (v === 'will-roll-back') return chalk.red.bold(label);
    if (v === 'unknown') return chalk.magenta(label);
    if (v === 'will-lose-function') return chalk.yellow(label);
    return chalk.green(label);
}

function printFindings(findings: Finding[]) {
    for (const f of findings) {
        const colour = SEVERITY_COLOUR[f.severity];
        console.log(`  ${colour(f.severity.padEnd(9))} ${chalk.bold(f.rule)}  ${f.message}`);
    }
}

/**
 * Group findings by application before printing.
 *
 * Several rules can fail on one application — a locally built package typically
 * trips both A1 and A4 — and listing them separately turns four applications
 * into eight lines, then reports "8 blocking" as if there were eight problems.
 * The reader's actual task is a list of applications to update or remove, so
 * that is what this prints.
 */
function printByApplication(findings: Finding[]) {
    const perApp = new Map<string, Finding[]>();
    const cameraWide: Finding[] = [];

    for (const f of findings) {
        if (!f.application) {
            cameraWide.push(f);
            continue;
        }
        const list = perApp.get(f.application) ?? [];
        list.push(f);
        perApp.set(f.application, list);
    }

    for (const f of cameraWide) {
        console.log(`  ${SEVERITY_COLOUR[f.severity](f.severity.padEnd(9))} ${chalk.bold(f.rule)}  ${f.message}`);
    }

    for (const [app, list] of perApp) {
        const worst: Severity = list.some((f) => f.severity === 'blocking')
            ? 'blocking'
            : list.some((f) => f.severity === 'unknown')
              ? 'unknown'
              : 'advisory';
        const rules = list.map((f) => f.rule).join(' + ');
        console.log(`  ${SEVERITY_COLOUR[worst](worst.padEnd(9))} ${chalk.bold(rules.padEnd(7))} ${chalk.bold(app)}`);
        for (const f of list) console.log(`            ${chalk.grey(f.rule)}  ${f.message}`);
    }
}

/**
 * Write the customer-facing report.
 *
 * Kept out of --json: the report is a deliverable an integrator hands to a client,
 * whereas --json is for piping into another system. Emitting both from one flag
 * would mean one of them is always noise.
 */
function writeReport(cameras: CameraReport[], target: number, file: string, fleetName?: string) {
    const path = resolvePath(file);
    writeFileSync(
        path,
        renderReport({
            cameras,
            targetOsMajor: target,
            rulesetVersion: ruleset.rulesetVersion,
            generated: new Date(),
            fleetName,
            sourceUrl: 'https://preflight.4xs.dev',
        })
    );
    if (!isJsonMode()) {
        ok(`Report written to ${path}`);
        info('Open it in a browser and print to PDF (A4) — the layout is designed for it.');
    }
}

export function registerPreflightCommands(program: Command) {
    const pf = program
        .command('preflight')
        .description('Check whether cameras survive an AXIS OS upgrade, before you start it (read-only)');

    pf.command('check <camera>', { isDefault: true })
        .description('Scan one camera and report whether it will upgrade or roll back')
        .option('--target <major>', 'AXIS OS major version to check against', '13')
        .option('-t, --timeout <ms>', 'Per-request timeout in milliseconds', '10000')
        .option('--report <file.html>', 'Also write a customer-ready report; open it and print to PDF')
        .action(
            action(async (name: string, opts) => {
                const target = parseIntOrThrow(opts.target, 'target', { min: 1, max: 99 });
                const timeout = parseIntOrThrow(opts.timeout, 'timeout', { min: 100 });

                const report = await scan(openCamera(name), target, timeout);
                const result = report.result!;

                if (isJsonMode()) {
                    printJson({ rulesetVersion: ruleset.rulesetVersion, target, ...report });
                } else {
                    console.log();
                    console.log(
                        `  ${chalk.bold(report.camera)}  ${report.product ?? '-'}  ` +
                            `firmware ${report.firmware ?? '-'}  ${report.architecture ?? '-'}`
                    );
                    console.log(`  AXIS OS ${target}: ${verdictCell(report)}`);
                    console.log();
                    if (result.findings.length === 0) {
                        info('No findings. Every check this scanner can make read-only came back clean.');
                    } else {
                        printByApplication(result.findings);
                    }
                    console.log();
                    if (result.unknown > 0) {
                        warn(
                            'Some checks could not be made from this camera. Unknown is not a pass — ' +
                                'treat those as unverified rather than safe.'
                        );
                    }
                    info(`Ruleset ${ruleset.rulesetVersion}. Rules and sources: https://preflight.4xs.dev`);
                }

                if (opts.report) {
                    writeReport([report], target, opts.report);
                }

                // Scripts and maintenance-window checks read the exit code.
                if (result.verdict === 'will-roll-back') process.exitCode = 2;
                else if (result.verdict === 'unknown') process.exitCode = 1;
            })
        );

    pf.command('fleet')
        .description('Scan every saved camera profile and summarise which ones will roll back')
        .option('--target <major>', 'AXIS OS major version to check against', '13')
        .option('-t, --timeout <ms>', 'Per-request timeout in milliseconds', '10000')
        .option('-j, --concurrency <n>', 'How many cameras to scan in parallel', '8')
        .option('--failed-only', 'Show only cameras that will roll back or came back unknown', false)
        .option('--report <file.html>', 'Also write a customer-ready report; open it and print to PDF')
        .option('--fleet-name <name>', 'Site or customer name, printed on the report')
        .action(
            action(async (opts) => {
                const cams = listCameras();
                if (cams.length === 0) {
                    info('No camera profiles saved yet. Add one with: axis camera add <name> --ip <ip>');
                    return;
                }

                const target = parseIntOrThrow(opts.target, 'target', { min: 1, max: 99 });
                const timeout = parseIntOrThrow(opts.timeout, 'timeout', { min: 100 });
                const concurrency = parseIntOrThrow(opts.concurrency, 'concurrency', { min: 1, max: 64 });

                const one = async (profile: CameraProfile): Promise<CameraReport> => {
                    try {
                        return await scan(new CameraSession(profile), target, timeout);
                    } catch (err) {
                        return {
                            camera: profile.name,
                            reachable: false,
                            product: null,
                            firmware: null,
                            architecture: null,
                            result: null,
                            error: describeError(err as Error),
                        };
                    }
                };

                const reports: CameraReport[] = [];
                for (let i = 0; i < cams.length; i += concurrency) {
                    reports.push(...(await Promise.all(cams.slice(i, i + concurrency).map(one))));
                }

                const shown = opts.failedOnly
                    ? reports.filter((r) => !r.reachable || r.result!.verdict !== 'will-upgrade')
                    : reports;

                printTable(
                    ['Camera', 'Product', 'Firmware', 'Arch', `AXIS OS ${target}`, 'Blocking', 'Unknown'],
                    shown.map((r) => [
                        r.camera,
                        r.product ?? '-',
                        r.firmware ?? '-',
                        r.architecture ?? '-',
                        verdictCell(r),
                        r.result ? String(r.result.blocking) : '-',
                        r.result ? String(r.result.unknown) : '-',
                    ]),
                    { rulesetVersion: ruleset.rulesetVersion, target, cameras: shown }
                );

                if (!isJsonMode()) {
                    const rollback = reports.filter((r) => r.result?.verdict === 'will-roll-back');
                    const unknown = reports.filter((r) => r.result?.verdict === 'unknown');

                    console.log();
                    for (const r of rollback) {
                        const blocking = r.result!.findings.filter((f) => f.severity === 'blocking');
                        const apps = new Set(blocking.filter((f) => f.application).map((f) => f.application!));
                        const scope = apps.size > 0 ? ` — ${apps.size} application(s) to update or remove` : '';
                        console.log(chalk.red.bold(`  ${r.camera} will roll back${scope}:`));
                        printByApplication(blocking);
                        console.log();
                    }
                    if (rollback.length > 0) console.log();
                    const withUnknowns = reports.filter((r) => (r.result?.unknown ?? 0) > 0);
                    if (withUnknowns.length > 0) {
                        warn(
                            `${withUnknowns.length} camera(s) have checks that could not be made: ` +
                                withUnknowns.map((r) => `${r.camera} (${r.result!.unknown})`).join(', ') +
                                '. Unknown is not a pass — run "axis preflight check <camera>" to see which.'
                        );
                    }
                    info(`Ruleset ${ruleset.rulesetVersion}. Rules and sources: https://preflight.4xs.dev`);
                }

                if (opts.report) {
                    writeReport(reports, target, opts.report, opts.fleetName);
                }

                if (reports.some((r) => r.result?.verdict === 'will-roll-back')) process.exitCode = 2;
                else if (reports.some((r) => !r.reachable || r.result?.verdict === 'unknown')) process.exitCode = 1;
            })
        );

    pf.command('rules')
        .description('List the published ruleset this scanner is built from')
        .option('--tier <tier>', 'Filter by tier: A, B, C or future')
        .option('--detectable', 'Show only rules this CLI can actually check read-only', false)
        .action(
            action(async (opts) => {
                let rules = ruleset.rules as any[];
                if (opts.tier) {
                    const want = String(opts.tier).toUpperCase();
                    rules = rules.filter((r) => r.tier.toUpperCase() === want);
                }
                if (opts.detectable) rules = rules.filter((r) => r.detection.status === 'verified');

                printTable(
                    ['Rule', 'Tier', 'OS', 'Title', 'Detection', 'Status'],
                    rules.map((r) => [
                        r.id,
                        r.tier,
                        r.version,
                        r.title.length > 58 ? r.title.slice(0, 57) + '…' : r.title,
                        r.detection.method,
                        r.detection.status,
                    ]),
                    rules
                );
                if (!isJsonMode()) {
                    info(
                        `Ruleset ${ruleset.rulesetVersion}, ${(ruleset.rules as any[]).length} rules. ` +
                            'Only rules marked "verified" are checked by this command; the rest need the .eap ' +
                            'or live in your integration, not on the camera.'
                    );
                }
            })
        );
}
