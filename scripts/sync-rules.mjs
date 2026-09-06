#!/usr/bin/env node
/**
 * Copy the published ruleset into the CLI.
 *
 * The ruleset is authored in the Preflight repo and *bundled* here, so the
 * scanner works offline and its output is reproducible for a given release.
 * That means two copies, and this script is what keeps them honest.
 *
 * It validates before overwriting: a truncated or hand-edited rules.json would
 * otherwise fail at runtime, inside a maintenance window, which is the worst
 * possible place to discover it.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = resolve(ROOT, 'src/preflight/rules.json');

// Checked in order. PREFLIGHT_RULES wins, so a checkout anywhere else still works.
const CANDIDATES = [
    process.env.PREFLIGHT_RULES,
    resolve(ROOT, '../../Preflight.4xs.dev/rules.json'),
    resolve(ROOT, '../Preflight.4xs.dev/rules.json'),
    resolve(ROOT, '../../../Preflight.4xs.dev/rules.json'),
].filter(Boolean);

const src = CANDIDATES.find((p) => existsSync(p));

if (!src) {
    console.error('Could not find the Preflight ruleset. Looked in:');
    for (const p of CANDIDATES) console.error(`  ${p}`);
    console.error('\nSet PREFLIGHT_RULES to its path:');
    console.error('  PREFLIGHT_RULES=/path/to/Preflight.4xs.dev/rules.json npm run sync:rules');
    process.exit(1);
}

let incoming;
try {
    incoming = JSON.parse(readFileSync(src, 'utf8'));
} catch (err) {
    console.error(`${src} is not valid JSON: ${err.message}`);
    process.exit(1);
}

// Guard the shape the engine and the `preflight rules` command depend on, rather
// than trusting that whatever sits at that path is a ruleset.
const problems = [];
if (typeof incoming.rulesetVersion !== 'string') problems.push('missing rulesetVersion');
if (!Array.isArray(incoming.rules) || incoming.rules.length === 0) problems.push('missing or empty rules array');
for (const r of incoming.rules ?? []) {
    if (!r.id || !r.tier || !r.detection?.status) {
        problems.push(`rule ${r.id ?? '(no id)'} is missing id, tier or detection.status`);
        break;
    }
}
if (problems.length) {
    console.error(`${src} does not look like a Preflight ruleset:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
}

const before = existsSync(DEST) ? JSON.parse(readFileSync(DEST, 'utf8')).rulesetVersion : null;
copyFileSync(src, DEST);

const verified = incoming.rules.filter((r) => r.detection.status === 'verified').length;
console.log(
    `rules.json ${before ?? 'none'} → ${incoming.rulesetVersion} ` +
        `(${incoming.rules.length} rules, ${verified} bench-verified)\n  from ${src}`
);
