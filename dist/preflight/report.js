"use strict";
// SYNCED COPY — do not edit here.
// Source of truth: axis-cli/src/preflight/report.ts
// Re-run `node sync.mjs` after changing it there.
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReport = renderReport;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VERDICT_COPY = {
    'no-upgrade-path': {
        label: 'No AXIS OS 13',
        cls: 'v-nopath',
        meaning: 'Axis publishes no AXIS OS 13 for this hardware, and it never received AXIS OS 11 either. ' +
            'Nothing to prepare; it stays on its current firmware until it is replaced.',
    },
    'will-roll-back': {
        label: 'Will roll back',
        cls: 'v-bad',
        meaning: 'The upgrade will fail on this camera and revert it to its current AXIS OS.',
    },
    unknown: {
        label: 'Cannot be determined',
        cls: 'v-unk',
        meaning: 'This camera does not report what the check needs. Treat as unverified, not as safe.',
    },
    'will-lose-function': {
        label: 'Will lose function',
        cls: 'v-warn',
        meaning: 'The upgrade succeeds, but something on this camera stops working.',
    },
    'will-upgrade': {
        label: 'Will upgrade',
        cls: 'v-ok',
        meaning: 'Every check that can be made read-only came back clean.',
    },
};
/** Group an application's findings so the reader sees work items, not rule hits. */
function byApplication(findings) {
    const perApp = new Map();
    const cameraWide = [];
    for (const f of findings) {
        if (!f.application) {
            cameraWide.push(f);
            continue;
        }
        perApp.set(f.application, [...(perApp.get(f.application) ?? []), f]);
    }
    return { perApp, cameraWide };
}
const worstOf = (list) => list.some((f) => f.severity === 'blocking')
    ? 'blocking'
    : list.some((f) => f.severity === 'unknown')
        ? 'unknown'
        : list.some((f) => f.severity === 'degraded')
            ? 'degraded'
            : 'advisory';
function cameraSection(c, input) {
    if (!c.reachable || !c.result) {
        return `<section class="cam">
  <header class="cam-head">
    <h3>${esc(c.camera)}</h3>
    <span class="verdict v-unk">Not reached</span>
  </header>
  <p class="cam-meta">This camera did not respond, so nothing can be said about it.
  ${c.error ? `<br><span class="err">${esc(c.error.split('\n')[0])}</span>` : ''}</p>
</section>`;
    }
    const v = VERDICT_COPY[c.result.verdict];
    const { perApp, cameraWide } = byApplication(c.result.findings);
    const urgentWide = cameraWide.filter((f) => f.severity === 'blocking' || f.severity === 'unknown');
    const laterWide = cameraWide.filter((f) => f.severity !== 'blocking' && f.severity !== 'unknown');
    const appRows = [...perApp.entries()]
        .map(([app, list]) => {
        const worst = worstOf(list);
        return `<tr class="s-${worst}">
      <td class="app">${esc(app)}</td>
      <td class="rules">${list.map((f) => esc(f.rule)).join(' + ')}</td>
      <td class="why">${list.map((f) => esc(f.message)).join('<br>')}</td>
    </tr>`;
    })
        .join('\n');
    return `<section class="cam">
  <header class="cam-head">
    <h3>${esc(c.camera)}</h3>
    <span class="verdict ${v.cls}">${esc(v.label)}</span>
  </header>
  <p class="cam-meta">${esc(c.product ?? 'unknown model')} · AXIS OS ${esc(c.firmware ?? '?')} · ${esc(c.architecture ?? 'architecture not reported')}</p>
  <p class="cam-meaning">${esc(v.meaning)}</p>
  ${urgentWide.length
        ? `<ul class="wide">${urgentWide
            .map((f) => `<li class="s-${esc(f.severity)}"><span class="rid">${esc(f.rule)}</span> ${esc(f.message)}</li>`)
            .join('')}</ul>`
        : ''}
  ${perApp.size
        ? `<table class="apps">
    <thead><tr><th>Application</th><th>Rule</th><th>What has to happen before the upgrade</th></tr></thead>
    <tbody>${appRows}</tbody>
  </table>`
        : ''}
  ${laterWide.length
        ? `<div class="later"><p class="later-h">Also worth knowing — these do not block the upgrade</p>
    <ul class="wide">${laterWide
            .map((f) => `<li class="s-${esc(f.severity)}"><span class="rid">${esc(f.rule)}</span> ${esc(f.message)}</li>`)
            .join('')}</ul></div>`
        : ''}
  ${c.result.findings.length === 0
        ? `<p class="clean">No findings. Nothing on this camera blocks the upgrade to AXIS OS ${input.targetOsMajor}.</p>`
        : ''}
</section>`;
}
function renderReport(input) {
    const cams = input.cameras;
    // Excludes cameras with no AXIS OS 13 path: they are counted and explained
    // separately, and a rollback figure that includes them overstates the work.
    const rollback = cams.filter((c) => c.result?.verdict === 'will-roll-back');
    // Cameras carrying ANY unverifiable check, not just those whose overall verdict
    // is unknown — a camera can roll back for one reason and still have checks that
    // could not be made.
    const withUnknowns = cams.filter((c) => (c.result?.unknown ?? 0) > 0);
    const clean = cams.filter((c) => c.result?.verdict === 'will-upgrade');
    // Kept apart from every other group in this report on purpose. These cameras
    // are not a risk to manage or a task to schedule — they are a line in next
    // year's budget, and mixing them into the rollback count means somebody
    // spends a morning trying to fix hardware that cannot be fixed.
    const stranded = cams.filter((c) => c.result?.verdict === 'no-upgrade-path');
    const strandedByModel = [...stranded.reduce((m, c) => {
            const k = c.product ?? 'Unidentified model';
            return m.set(k, (m.get(k) ?? 0) + 1);
        }, new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const unreachable = cams.filter((c) => !c.reachable);
    // The number the reader acts on: distinct applications to deal with, across
    // the fleet — not the number of rule hits, which double-counts an app that
    // trips two rules.
    const appsToFix = new Set();
    for (const c of cams) {
        for (const f of c.result?.findings ?? []) {
            if (f.application && f.severity === 'blocking')
                appsToFix.add(f.application);
        }
    }
    const date = input.generated.toISOString().slice(0, 10);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AXIS OS ${input.targetOsMajor} upgrade report${input.fleetName ? ` — ${esc(input.fleetName)}` : ''}</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm; }

:root{
  --ink:#16181d; --muted:#5b616d; --line:#dcdad4; --paper:#fff; --panel:#f7f6f3;
  --bad:#a8261c; --bad-bg:#fbeeec;
  --unk:#8a5a09; --unk-bg:#fcf3e3;
  --ok:#0d6f68;  --ok-bg:#e8f2f0;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font:11pt/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.sheet{max-width:190mm;margin:0 auto;padding:14mm 10mm}
@media print{ .sheet{max-width:none;margin:0;padding:0} }

/* masthead */
.top{display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:2px solid var(--ink);padding-bottom:8px;margin-bottom:22px}
.brand{font-weight:700;font-size:13pt;letter-spacing:-.01em}
.brand span{color:var(--bad)}
.top .meta{font:9pt/1.4 var(--mono);color:var(--muted);text-align:right}

h1{font-size:20pt;line-height:1.15;margin:0 0 6px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0 0 20px;max-width:60ch}

/* verdict summary */
.headline{border-left:4px solid var(--bad);background:var(--bad-bg);
  padding:14px 18px;border-radius:0 5px 5px 0;margin:0 0 20px}
.headline.none{border-left-color:var(--ok);background:var(--ok-bg)}
.headline p{margin:0;font-size:12pt}
.headline strong{font-size:13pt}

.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 24px}
.tile{border:1px solid var(--line);border-radius:5px;padding:10px 12px;background:var(--panel)}
.tile b{display:block;font-size:19pt;line-height:1.1;font-variant-numeric:tabular-nums}
.tile span{font-size:8.5pt;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.tile.bad b{color:var(--bad)} .tile.unk b{color:var(--unk)} .tile.ok b{color:var(--ok)}

/* fleet table */
h2{font-size:12pt;margin:26px 0 10px;letter-spacing:-.01em}
table{width:100%;border-collapse:collapse;font-size:9.5pt}
th{text-align:left;font:600 8.5pt/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;
  color:var(--muted);border-bottom:1px solid var(--ink);padding:0 8px 6px 0}
td{padding:7px 8px 7px 0;border-bottom:1px solid var(--line);vertical-align:top}
.fleet td.cam{font-weight:600}
.verdict{display:inline-block;font:600 8.5pt/1 var(--mono);padding:4px 7px;border-radius:3px;white-space:nowrap}
.v-bad{background:var(--bad-bg);color:var(--bad)}
.v-unk{background:var(--unk-bg);color:var(--unk)}
.v-warn{background:var(--unk-bg);color:var(--unk)}
.v-nopath{background:#eef2fb;color:#1d4ed8}
.headline.nopath{border-left-color:#1d4ed8;background:#eef2fb}
table.replace{width:100%;border-collapse:collapse;margin-top:8px;font-size:10pt}
table.replace th{text-align:left;border-bottom:1px solid #333;padding:0 8px 4px 0;font-size:8.5pt;
  text-transform:uppercase;letter-spacing:.05em}
table.replace td{padding:4px 8px 4px 0;border-bottom:1px solid #e2e2dd}
table.replace td.n{text-align:right;font-variant-numeric:tabular-nums;width:5em}
.v-ok{background:var(--ok-bg);color:var(--ok)}

/* per-camera detail */
.cam{border:1px solid var(--line);border-radius:6px;padding:14px 16px;margin:0 0 12px}
.cam-head,.cam-meta,.cam-meaning{break-after:avoid;page-break-after:avoid}
.apps tr,ul.wide li,.later{break-inside:avoid;page-break-inside:avoid}
.apps thead{break-after:avoid;page-break-after:avoid}
h2{break-after:avoid;page-break-after:avoid}
.cam-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:4px}
.cam-head h3{font-size:11.5pt;margin:0}
.cam-meta{font:9pt/1.4 var(--mono);color:var(--muted);margin:0 0 8px}
.cam-meaning{margin:0 0 10px;font-size:10pt}
.clean{margin:0;color:var(--ok);font-size:10pt}
.err{color:var(--bad);font-family:var(--mono);font-size:8.5pt}

.apps{font-size:9.5pt}
.apps td.app{font-family:var(--mono);font-weight:600;width:26%}
.apps td.rules{font-family:var(--mono);color:var(--muted);width:9%;white-space:nowrap}
.apps tr.s-blocking td.app{color:var(--bad)}
.apps tr.s-unknown td.app{color:var(--unk)}

ul.wide{margin:0 0 10px;padding-left:0;list-style:none}
ul.wide li{font-size:9.5pt;padding:5px 0 5px 0;border-bottom:1px solid var(--line)}
ul.wide li:last-child{border-bottom:0}
.rid{font:600 8.5pt var(--mono);color:var(--bad);margin-right:6px}
.later{margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)}
.later-h{font:600 8.5pt/1.3 var(--mono);letter-spacing:.05em;text-transform:uppercase;
  color:var(--muted);margin:0 0 4px}
li.s-unknown .rid{color:var(--unk)}
li.s-advisory .rid{color:var(--ok)}

/* method + footer */
.method{background:var(--panel);border-radius:5px;padding:14px 16px;margin:24px 0 0;
  font-size:9.5pt;break-inside:avoid}
ul.scope-warn{margin:6px 0 0 18px;padding:0}
ul.scope-warn li{margin:2px 0}
.method h2{margin-top:0}
.method p{margin:0 0 8px;max-width:78ch}
.method p:last-child{margin:0}
footer{margin-top:20px;padding-top:10px;border-top:1px solid var(--line);
  font:8.5pt/1.5 var(--mono);color:var(--muted);display:flex;justify-content:space-between;gap:16px}
</style>
</head>
<body>
<div class="sheet">

<div class="top">
  <div class="brand">Pre<span>flight</span></div>
  <div class="meta">
    AXIS OS ${input.targetOsMajor} readiness<br>
    ${esc(date)} · ruleset ${esc(input.rulesetVersion)}
  </div>
</div>

<h1>Will these cameras survive the AXIS OS ${input.targetOsMajor} upgrade?</h1>
<p class="sub">${input.fleetName ? `${esc(input.fleetName)} — ` : ''}${cams.length} camera${cams.length === 1 ? '' : 's'} checked, read-only.
Nothing was installed or changed on any device.</p>

<div class="headline${rollback.length === 0 ? ' none' : ''}">
  <p>${rollback.length > 0
        ? `<strong>${rollback.length} of ${cams.length} camera${cams.length === 1 ? '' : 's'} will roll back.</strong>
       AXIS OS ${input.targetOsMajor} re-installs every application during the upgrade. If one fails, the
       device reverts to its current firmware — without reporting which application caused it.
       ${appsToFix.size} application${appsToFix.size === 1 ? '' : 's'} must be updated or removed first.`
        : `<strong>No camera in this fleet is expected to roll back.</strong>
       Every check that can be made read-only came back clean${withUnknowns.length
            ? `, though ${withUnknowns.length} camera${withUnknowns.length === 1 ? '' : 's'} could not be fully checked`
            : ''}.`}</p>
</div>

<div class="tiles">
  <div class="tile bad"><b>${rollback.length}</b><span>will roll back</span></div>
  ${stranded.length ? `<div class="tile nopath"><b>${stranded.length}</b><span>no AXIS OS 13</span></div>` : ''}
  <div class="tile unk"><b>${withUnknowns.length}</b><span>with unverified checks</span></div>
  <div class="tile ok"><b>${clean.length}</b><span>will upgrade</span></div>
  <div class="tile"><b>${appsToFix.size}</b><span>apps to fix</span></div>
</div>

${stranded.length
        ? `<div class="headline nopath">
  <p><strong>${stranded.length} of these ${cams.length} camera${cams.length === 1 ? '' : 's'} cannot run AXIS OS
  ${input.targetOsMajor} at all.</strong> They are 32-bit models that Axis does not list as receiving AXIS OS
  ${input.targetOsMajor}, and they are still on AXIS OS 10 — so they were never offered AXIS OS 11 either.
  Axis states that AXIS OS 13 will not support ARTPEC-6 products. No application work changes this: they keep
  running their current firmware until they are replaced. Everything else in this report concerns the cameras
  that can move.</p>
  <table class="replace">
    <thead><tr><th>Model</th><th class="n">Cameras</th></tr></thead>
    <tbody>${strandedByModel
            .map(([m, n]) => `<tr><td>${esc(m)}</td><td class="n">${n}</td></tr>`)
            .join('')}</tbody>
  </table>
  <p style="margin-top:8px">Confirm the upgrade path for these models with Axis before committing to
  replacement. Source for the list this is checked against:
  <span class="mono">https://help.axis.com/en-us/axis-os</span></p>
</div>`
        : ''}

<h2>Fleet</h2>
<table class="fleet">
  <thead><tr><th>Camera</th><th>Model</th><th>AXIS OS</th><th>Architecture</th><th>Verdict</th></tr></thead>
  <tbody>
  ${cams
        .map((c) => `<tr>
    <td class="cam">${esc(c.camera)}</td>
    <td>${esc(c.product ?? '—')}</td>
    <td>${esc(c.firmware ?? '—')}</td>
    <td>${esc(c.architecture ?? '—')}</td>
    <td><span class="verdict ${c.reachable && c.result ? VERDICT_COPY[c.result.verdict].cls : 'v-unk'}">${c.reachable && c.result ? esc(VERDICT_COPY[c.result.verdict].label) : 'Not reached'}</span></td>
  </tr>`)
        .join('\n')}
  </tbody>
</table>

<h2>What has to happen, camera by camera</h2>
${cams.map((c) => cameraSection(c, input)).join('\n')}

<div class="method">
  <h2>How this was checked</h2>
  <p>Every camera was read over VAPIX using an account you supplied: the list of installed applications
  and a small set of configuration parameters. Nothing was written, no software was installed, and no
  data left your network.</p>
${input.scopeLine
        ? `<p><strong>What was covered.</strong> ${esc(input.scopeLine)} A camera on a network that was not
  scanned does not appear anywhere in this report — not as a pass and not as a warning. If your site has
  cameras outside those ranges, this report does not describe them.</p>` +
            (input.scopeWarnings?.length
                ? `<ul class="scope-warn">${input.scopeWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
                : '')
        : ''}
  <p><strong>“Cannot be determined” is not a pass.</strong> AXIS OS versions older than 12 do not publish
  the per-application compatibility and signature information two of these checks rely on. Those cameras
  are reported as unverified rather than as safe, because a false all-clear is worse than no report.</p>
  <p>Checks that require inspecting an application's installation package, rather than the camera, are
  outside this report — they cannot be performed read-only from the network.</p>
  <p>Every rule cites public Axis documentation. The full ruleset, with sources, is published at
  ${esc(input.sourceUrl)}.</p>
</div>

<footer>
  <span>Preflight · ruleset ${esc(input.rulesetVersion)} · ${esc(date)}</span>
  <span>${esc(input.sourceUrl)}</span>
</footer>

</div>
</body>
</html>
`;
}
