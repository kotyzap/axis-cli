/**
 * Customer-facing upgrade report.
 *
 * An integrator runs the scan and hands this to the person who owns the cameras,
 * so it has to survive being read by someone who has never heard of an ACAP: the
 * verdict first, the work second, the evidence last.
 *
 * Emitted as a single self-contained HTML file rather than a PDF, for two
 * reasons. Print-to-PDF from any browser produces a better-typeset document than
 * a bundled PDF library would, and — more importantly — a PDF toolchain would add
 * a heavyweight dependency to a CLI whose whole appeal is that it installs
 * anywhere and touches nothing. The print stylesheet below is written for A4 and
 * tested against Chrome's "Save as PDF".
 *
 * No external fonts, scripts or images: a report that phones home is a report an
 * integrator cannot email to a security-conscious client.
 */

import { Finding, PreflightResult, Severity } from './engine';

export type ReportCamera = {
    camera: string;
    reachable: boolean;
    product: string | null;
    firmware: string | null;
    architecture: string | null;
    result: PreflightResult | null;
    error?: string;
};

export type ReportInput = {
    cameras: ReportCamera[];
    targetOsMajor: number;
    rulesetVersion: string;
    generated: Date;
    /** Shown in the header when the integrator names the site. */
    fleetName?: string;
    sourceUrl: string;
};

const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const VERDICT_COPY: Record<string, { label: string; cls: string; meaning: string }> = {
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
function byApplication(findings: Finding[]) {
    const perApp = new Map<string, Finding[]>();
    const cameraWide: Finding[] = [];
    for (const f of findings) {
        if (!f.application) {
            cameraWide.push(f);
            continue;
        }
        perApp.set(f.application, [...(perApp.get(f.application) ?? []), f]);
    }
    return { perApp, cameraWide };
}

const worstOf = (list: Finding[]): Severity =>
    list.some((f) => f.severity === 'blocking')
        ? 'blocking'
        : list.some((f) => f.severity === 'unknown')
          ? 'unknown'
          : list.some((f) => f.severity === 'degraded')
            ? 'degraded'
            : 'advisory';

function cameraSection(c: ReportCamera, input: ReportInput): string {
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
  ${
      urgentWide.length
          ? `<ul class="wide">${urgentWide
                .map((f) => `<li class="s-${esc(f.severity)}"><span class="rid">${esc(f.rule)}</span> ${esc(f.message)}</li>`)
                .join('')}</ul>`
          : ''
  }
  ${
      perApp.size
          ? `<table class="apps">
    <thead><tr><th>Application</th><th>Rule</th><th>What has to happen before the upgrade</th></tr></thead>
    <tbody>${appRows}</tbody>
  </table>`
          : ''
  }
  ${
      laterWide.length
          ? `<div class="later"><p class="later-h">Also worth knowing — these do not block the upgrade</p>
    <ul class="wide">${laterWide
        .map((f) => `<li class="s-${esc(f.severity)}"><span class="rid">${esc(f.rule)}</span> ${esc(f.message)}</li>`)
        .join('')}</ul></div>`
          : ''
  }
  ${
      c.result.findings.length === 0
          ? `<p class="clean">No findings. Nothing on this camera blocks the upgrade to AXIS OS ${input.targetOsMajor}.</p>`
          : ''
  }
</section>`;
}

export function renderReport(input: ReportInput): string {
    const cams = input.cameras;
    const rollback = cams.filter((c) => c.result?.verdict === 'will-roll-back');
    // Cameras carrying ANY unverifiable check, not just those whose overall verdict
    // is unknown — a camera can roll back for one reason and still have checks that
    // could not be made.
    const withUnknowns = cams.filter((c) => (c.result?.unknown ?? 0) > 0);
    const clean = cams.filter((c) => c.result?.verdict === 'will-upgrade');
    const unreachable = cams.filter((c) => !c.reachable);

    // The number the reader acts on: distinct applications to deal with, across
    // the fleet — not the number of rule hits, which double-counts an app that
    // trips two rules.
    const appsToFix = new Set<string>();
    for (const c of cams) {
        for (const f of c.result?.findings ?? []) {
            if (f.application && f.severity === 'blocking') appsToFix.add(f.application);
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
  <p>${
      rollback.length > 0
          ? `<strong>${rollback.length} of ${cams.length} camera${cams.length === 1 ? '' : 's'} will roll back.</strong>
       AXIS OS ${input.targetOsMajor} re-installs every application during the upgrade. If one fails, the
       device reverts to its current firmware — without reporting which application caused it.
       ${appsToFix.size} application${appsToFix.size === 1 ? '' : 's'} must be updated or removed first.`
          : `<strong>No camera in this fleet is expected to roll back.</strong>
       Every check that can be made read-only came back clean${
           withUnknowns.length
               ? `, though ${withUnknowns.length} camera${withUnknowns.length === 1 ? '' : 's'} could not be fully checked`
               : ''
       }.`
  }</p>
</div>

<div class="tiles">
  <div class="tile bad"><b>${rollback.length}</b><span>will roll back</span></div>
  <div class="tile unk"><b>${withUnknowns.length}</b><span>with unverified checks</span></div>
  <div class="tile ok"><b>${clean.length}</b><span>will upgrade</span></div>
  <div class="tile"><b>${appsToFix.size}</b><span>apps to fix</span></div>
</div>

<h2>Fleet</h2>
<table class="fleet">
  <thead><tr><th>Camera</th><th>Model</th><th>AXIS OS</th><th>Architecture</th><th>Verdict</th></tr></thead>
  <tbody>
  ${cams
      .map(
          (c) => `<tr>
    <td class="cam">${esc(c.camera)}</td>
    <td>${esc(c.product ?? '—')}</td>
    <td>${esc(c.firmware ?? '—')}</td>
    <td>${esc(c.architecture ?? '—')}</td>
    <td><span class="verdict ${c.reachable && c.result ? VERDICT_COPY[c.result.verdict].cls : 'v-unk'}">${
        c.reachable && c.result ? esc(VERDICT_COPY[c.result.verdict].label) : 'Not reached'
    }</span></td>
  </tr>`
      )
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
