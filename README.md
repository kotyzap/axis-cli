# axis-cli

A command-line tool for controlling Axis IP cameras: general VAPIX control (params, PTZ, ACAPs, reboot),
CamOverlay/CamStreamer/CamSwitcher management, and fleet-wide health checks — all from the terminal.

**Works across firmware generations.** One binary handles firmware 5.x through AXIS OS 12.x.
Rather than assuming a recent AXIS OS, each command asks the camera what it supports and
adapts — so an M1137 stuck at 10.12.338 and a Q6135 on 12.11 both work, and a command that
genuinely cannot run on a device says so and names the requirement. Start with
[`axis caps <name>`](#3-what-does-this-camera-support) on any camera you're unsure about.

Built on `camstreamerlib` v4, `commander`, and `cli-table3`.

## Install

Requires Node 18 or newer.

New to the command line? Start with **[axis-cli 101](https://kotyzap.github.io/axis-cli/axis-cli-101.html)** —
a step-by-step walkthrough covering installation, finding your camera on the network, adding it,
and where the username and password get asked for.

### Easiest: run the installer

Download `axis-cli-v1.3.0-installer.zip` from the
[latest release](https://github.com/kotyzap/axis-cli/releases/latest) and unzip it.
Both scripts check Node, install dependencies, build, install `axis` globally, and verify it.

- **macOS** — double-click `install.command` in Finder (or `./install.command` in a terminal).
  It's unsigned, so on first run macOS blocks a plain double-click; right-click → **Open**, or
  `chmod +x install.command` and run it from a terminal.
- **Windows** — extract the zip first (don't run from inside the zip preview), then
  double-click `install.bat`. If you hit `EPERM`/`EACCES`, right-click → **Run as administrator**.

### Or by hand

```bash
git clone https://github.com/kotyzap/axis-cli.git
cd axis-cli
npm ci
npm run build
npm install -g .
axis --version
```

**Prefer `npm install -g .` over `npm link`.** `npm link` only symlinks to the project
folder, so `axis` breaks if that folder moves, gets deleted, or lives on an external
drive that isn't mounted. `npm install -g .` copies the built files into Node's global
folder — self-contained and survives reboots.

To run without installing at all: `node dist/index.js <command>` from the project directory.

**A note on nvm:** a global install is scoped to the Node version active at install
time. Switch versions and `axis` vanishes — just re-run the installer. Homebrew Node
(`brew install node`) avoids this entirely.

Uninstall with `npm uninstall -g axis-cli`. Your camera profiles in
`~/.axis-cli/config.json` are left alone.

### Troubleshooting

**`zsh: permission denied: axis`** — the compiled entry point lost its executable bit.
`tsc` doesn't set one, so anything that regenerates `dist/` (including `rm -rf dist`)
leaves `dist/index.js` mode 644 while `npm link` still points at it. Re-run
`npm run build` (the `postbuild` step chmods it) or fix it directly:

```bash
chmod +x dist/index.js
```

**`sh: tsc: command not found` during `npm run build`** — you have `NODE_ENV=production`
set, so `npm install` skipped `devDependencies` and TypeScript was never installed.
Install them explicitly:

```bash
npm install --include=dev
```

**`npm error EINVALIDTAGNAME ... Invalid tag name "#"`** — you pasted a command with a
trailing `# comment` into an interactive zsh. Unlike bash, zsh does not treat `#` as a
comment on an interactive command line, so the comment is passed to `npm` as arguments.
Backticks inside such a comment are worse: zsh runs them as command substitution. Paste
the commands without trailing comments, or enable comments once per shell with
`setopt interactive_comments`.

See [CHANGELOG.md](CHANGELOG.md) for what changed. 1.3.0 adds `axis discovery` (and
`axis discovery --add`) — no more hunting for a new camera's IP by hand. 1.2.1 fixes a class of bug found by
running against real cameras — a device sending a richer response shape than the documented
example rendered as `[object Object]`, and an unexpected disk-listing shape was reported as
"no SD card". 1.2.0 makes the CLI firmware-universal
and adds `axis caps`, `axis apps install/uninstall` and `axis ptz commands`; it also fixes
several commands that could not work at all on AXIS OS 9/10 cameras or on any third-party
ACAP. 1.1.2 fixes `axis stream stop` timing out on actively-publishing streams; 1.1.1
repairs `axis events watch`. Note also that in 1.1.0 `--tls` began defaulting to port 443
and `axis reboot` without `--yes` began exiting 1 — both behaviour changes from 1.0.0.

## Find a camera on the network

New camera, unknown IP? SSDP/UPnP/mDNS discovery (what the old "Axis IP Utility"
relied on) is frequently disabled by default from AXIS OS 11/12.x onward, so
broadcast-based tools often find nothing. `axis discovery` instead sweeps the
local subnet on ports 443/80 and asks each host who it is via the VAPIX Basic
Device Info API, which most Axis firmware answers with no credentials at all.

```bash
axis discovery                              # auto-detects your machine's /24
axis discovery --subnet 192.168.1.0/24      # or scan a specific range
axis discovery --json
```

```
ℹ Scanning 192.168.1.0/24 (254 hosts) on ports 443/80 ...
┌────────────────┬──────────────────┬──────────────┬──────────┬───────────────────┐
│ IP             │ Model            │ Serial       │ Firmware │ MAC               │
├────────────────┼──────────────────┼──────────────┼──────────┼───────────────────┤
│ 192.168.1.156  │ AXIS Q1656       │ B8A44F1A2B3C │ 12.6.97  │ b8:a4:4f:1a:2b:3c │
└────────────────┴──────────────────┴──────────────┴──────────┴───────────────────┘
ℹ Add one with: axis camera add <name> --ip <ip> --user root
```

A host that answered on 80/443 but declined identification — Basic Device Info
turned off, or a custom account required — is listed separately as "possible"
when its MAC address matches a registered Axis Communications AB OUI, so it
still turns up as a lead instead of vanishing silently. `--user`/`--pass` let
you retry identification with credentials on such a device. If nothing on your
network answers, double-check you're on the same subnet/VLAN as the camera and
that it has finished booting.

### Scan and add in one step

```bash
axis discovery --add
```

After scanning, this asks about each confirmed camera that isn't already a
saved profile:

```
Add AXIS Q1656 at 192.168.1.156? (Y/n) y
  Profile name [q1656]:
  Username [root]:
  Password for root@192.168.1.156:
✓   Saved camera profile "q1656" (192.168.1.156) to /Users/you/.axis-cli/config.json
```

The suggested name comes from the model (falling back to the IP), and gets a
`-2`, `-3`, ... suffix if it collides with a profile you already have. `AXIS_PASS`
is honoured, same as `camera add`. Only *confirmed* cameras are offered — a
MAC-only "possible" match hasn't actually answered as an Axis device, so add
those with `axis camera add` by hand once you've verified the IP is right.
`--add` needs an interactive terminal and cannot be combined with `--json`.

## 1. Save your cameras

Camera credentials are stored per-profile in `~/.axis-cli/config.json` (mode 0600), so you only type them once.

```bash
# Local network camera — omit --pass and you'll be prompted without echo
axis camera add q1656 --ip 192.168.1.50 --user root

# HTTPS camera. Port defaults to 443 with --tls (80 without).
# Most Axis cameras ship a self-signed cert, so you usually want --tls-insecure.
axis camera add frontdoor --ip 192.168.1.60 --tls --tls-insecure

# Camera reached via CamStreamer Cloud (device-connect.net) instead of a local IP
axis camera add remote-cam --cloud-url https://xxxx.device-connect.net

axis camera test q1656          # verify reachability + credentials
axis camera list
axis camera update q1656 --pass # change the password (bare --pass prompts)
axis camera remove q1656
```

Every command below takes the profile `name` you chose here, not a raw IP.

### Passwords

Avoid putting secrets on the command line — they land in your shell history and are
visible in `ps`. In order of preference:

1. **Omit the flag** and let the CLI prompt you (input is not echoed).
2. **Environment variable**: `AXIS_PASS` or `AXIS_CLOUD_TOKEN` — useful in CI.
3. `--pass` / `--cloud-token` as a last resort.

### Machine-readable output

Add `--json` anywhere on the command line to get JSON instead of tables and
status glyphs. Secrets are never included.

```bash
axis camera list --json
axis fleet health --json | jq '.[] | select(.reachable == false)'
```

## 2. General VAPIX

```bash
axis info q1656                              # product, firmware generation, ACAP target, SD card, ACAPs
axis info q1656 --all-acaps                  # ...including third-party ACAPs
axis param get q1656 Brand.ProdFullName      # the root. prefix is optional
axis param get q1656 Properties.PTZ          # a whole group
axis param set q1656 Time.DST.Enabled=yes
axis reboot q1656 --yes                      # without --yes it refuses and exits 1
```

`axis reboot` uses the firmware management API on firmware 7.40 and later, falling back to
the legacy restart CGI on older devices.

## 3. What does this camera support?

`axis caps` is the command to reach for when something works on one camera and not another.
It reports what was probed and what follows from it, rather than leaving you to
cross-reference AXIS OS release notes.

```bash
axis caps m1137
axis caps m1137 --params Properties.PTZ      # also dump a raw parameter subtree
axis caps m1137 --json                       # the whole matrix, for scripting
```

On an M1137 at 10.12.338 that looks like:

```
Capabilities of "m1137"
  Product                 AXIS M1137 Network Camera
  Firmware                10.12.338 (AXIS OS 10 (LTS 2022 track))
  Architecture            armv7hf
  SoC                     Axis Artpec-7
...
ACAP
  EmbeddedDevelopment     2.16
  list.cgi                yes (needs 1.20+)
  config.cgi              no (AXIS OS 11.2+)
  SDKs the device accepts acap3, acap4-cv, acap4-native

PTZ
  Mechanical PTZ          no
  Digital PTZ             yes
...
Notes for this firmware
  • This camera has digital PTZ only. Position queries will report zoom but no pan or
    tilt, which is expected rather than an error.
```

The "SDKs the device accepts" line comes from the camera itself, not from a
firmware-to-SDK lookup table — it's the reliable answer to "will my `.eap` install here".

## 4. PTZ

```bash
axis ptz presets q1656 -c 1
axis ptz list q1656 -c 1                     # alias for presets
axis ptz goto q1656 "Home" -c 1
axis ptz position q1656 -c 1
axis ptz commands q1656                      # what this channel actually accepts
```

PTZ support isn't binary. A fixed camera with digital PTZ (an M1137, say) reports zoom but
no pan or tilt — `axis ptz position` shows what the camera does report and lists what it
doesn't, rather than treating a missing axis as an error. A camera with no PTZ at all is
refused with an explanation instead of a schema failure.

## 5. ACAP applications

```bash
axis apps list q1656
axis apps list q1656 --running
axis apps list q1656 --family                # CamStreamer family only

# Names match the Name column, case-insensitively; a unique substring also works
axis apps start q1656 CamOverlay
axis apps stop q1656 "AXIS Object Analytics"
axis apps restart q1656 camscripter

axis apps install q1656 ./myapp_1_0_0_armv7hf.eap
axis apps install q1656 ./myapp_1_0_0_armv7hf.eap --start
axis apps uninstall q1656 myapp --yes
```

`apps install` checks compatibility *before* uploading, since the camera's own verdict on
an incompatible package ("package not compatible") only arrives after the whole file has
crossed the network. It compares the architecture in the filename against what the camera
reports, notes the ACAP generation the firmware targets, and warns if the camera refuses
unsigned packages — the default from AXIS OS 12.0. `--force` uploads anyway.

Starting or stopping an ACAP that is already in that state is treated as success, so these
commands are safe to put in scripts.

## 6. CamOverlay

```bash
axis overlay list q1656
axis overlay enable q1656 2
axis overlay disable q1656 2
axis overlay text q1656 2 temperature=22.5C humidity=45%
```

## 7. CamStreamer

```bash
axis stream list q1656
axis stream show q1656 42448
axis stream start q1656 42448
axis stream stop q1656 42448
axis stream stop q1656 42448 --timeout 30000   # give it longer to tear down
```

`stream stop` waits up to 20 seconds by default (10 for `start`) — stopping a stream
that's actively publishing can take longer than starting one, since the camera has to
close its connection to the RTMP/HLS/SRT destination first. If you still see "The
operation was aborted due to timeout", raise `--timeout` further; the stream itself is
likely fine, the camera is just still tearing it down.

## 8. CamSwitcher

```bash
axis switcher list q1656
axis switcher switch q1656 MainView
axis switcher queue q1656 GateView
axis switcher queue-clear q1656
```

## 9. Fleet health

Runs across every saved camera profile and reports reachability, firmware, SD card status, and how many
CamStreamer-family ACAPs are running — handy as a cron job or CamStreamer Scheduler / Claude Scheduled Task.

Cameras are probed in parallel with a per-request timeout, so one dead camera doesn't stall the report.
Exits 1 if any camera is unreachable, so it works as a monitoring check.

```bash
axis fleet health
axis fleet health --timeout 3000 --concurrency 16
axis fleet health --json
```

Note: the "CamStreamer ACAPs" column counts only the CamStreamer family (CamStreamer, CamOverlay,
CamSwitcher, CamScripter, PlaneTracker, ...). Use `axis apps list <name>` for the complete ACAP
inventory on a single camera. That column distinguishes a real count from `no ACAP` (the device
cannot run ACAPs) and `no access` (listing them needs Administrator, while the rest of the row
needs only Viewer). The SD Card column likewise distinguishes `n/a` — no card slot — from
`disconnected`, meaning an empty or unmounted slot.

The Notes column flags firmware facts that change how other commands behave, and the report
tells you when your fleet spans multiple AXIS OS generations — usually the explanation for
"it works on that camera but not this one".

## 10. AXIS OS upgrade preflight

AXIS OS 13 does not warn you and continue. If any installed ACAP fails to
re-install during the upgrade, the device **rolls back** — and it does not tell
you which application caused it. On a fleet you discover that one camera at a
time, at night.

`axis preflight` answers it in advance, per camera, read-only. It lists
applications and reads parameters — the same calls `axis apps list` and
`axis param` already make. Nothing is written and nothing is installed.

```bash
axis preflight q1656                 # "check" is the default subcommand
axis preflight fleet                 # every saved profile
axis preflight fleet --failed-only   # just the ones that need work
axis preflight fleet --json          # for a script or a ticket
```

Verdicts, and the exit codes that go with them:

| Verdict | Exit | Meaning |
|---|---|---|
| `will upgrade` | 0 | Every check this scanner can make read-only came back clean |
| `unknown` | 1 | Something could not be checked. **Not a pass** |
| `WILL ROLL BACK` | 2 | At least one application fails re-installation |

A fleet run exits with the worst code across the fleet, so it drops into a
maintenance-window script directly.

### What it checks

Only rules verified against real hardware. `axis preflight rules --detectable`
lists exactly these; `axis preflight rules` lists all 66, including the ones no
scanner can answer from a camera.

| Rule | Check |
|---|---|
| A1 | Each application's `CompatibleOsVersions` declaration reaches the target OS |
| A4 | Each application's `SignatureStatus` — unsigned packages are refused from OS 13 |
| A5 | 32-bit architecture, from `Properties.System.Architecture` — the Y2038 ABI break |
| A8 | Declared DLPU use, which OS 13 makes mandatory |
| C1 | Whether HTTP is still accepted (`System.BoaGroupPolicy.*`) |
| C2 | Authentication policy — digest is already refused on current firmware |
| C3 | Signed Video, which OS 13 turns on by default and which raises bitrate |
| C4 | UPnP, removed entirely in OS 13 |

A5 reads the architecture rather than matching Axis's published 32-bit model
list, because the list is incomplete: an AXIS M1137 reports `armv7hf` and does
not appear on it. Reading the device cannot go stale.

### Unknown is not a pass

Older firmware does not publish the per-application fields A1 and A4 depend on —
an AXIS OS 10.12 camera returns neither `CompatibleOsVersions` nor
`SignatureStatus` for any application. Those cameras report **unknown**, never
`will upgrade`.

This is deliberate and enforced by a test. A tool that says "fine" about a camera
it could not actually inspect is worse than no tool, because you would act on it.
The same applies when the account cannot read the application list: listing ACAPs
needs Administrator while the rest of the scan does not, and a restricted account
gets `unknown` rather than a clean bill of health.

### Where the rules come from

Every rule cites public Axis documentation. The ruleset ships bundled as
`src/preflight/rules.json`, so scanning works offline and a given release always
produces the same verdict. `npm run sync:rules` re-copies it from the Preflight
repo; set `PREFLIGHT_RULES` if your checkout lives elsewhere.

Full rules with sources: <https://preflight.4xs.dev>

## 11. Live events

```bash
axis events topics q1656                 # what this camera publishes
axis events topics q1656 --filter vmd    # narrow the list

axis events watch q1656                  # all topics, until Ctrl+C
axis events watch q1656 --topic 'tns1:Device/tnsaxis:IO/VirtualPort'
axis events watch q1656 --topic 'tns1:Device//.' --topic 'tns1:VideoSource//.'
axis events watch q1656 --raw            # full JSON payload per event
```

Topic filters are ONVIF topic expressions, the same strings the camera declares
in `GetEventInstances`. `--topic` is repeatable; a trailing `//.` matches
everything below a branch. With no `--topic`, the CLI subscribes to `//.` — every
topic.

Axis advises subscribing only to what you need, since each subscription starts
internal services on the camera. Use `axis events topics` to find the exact
strings, then narrow with `--topic`.

If the camera answers **"Could not use supplied event filter"**, one of the
filters isn't a topic expression it accepts. Run `axis events topics <name>` and
copy a value from there. (In 1.1.0 this happened on *every* invocation — see the
changelog.)

**Firmware requirement.** `events watch` needs the WebSocket data stream, which arrived in
AXIS OS 10.11. On older cameras it refuses with an explanation rather than a bare socket
error, and points you at `events topics` — that uses a SOAP call available since firmware
5.50, so topic enumeration works on every device. `axis caps <name>` shows which event
transports a given camera has.

## 12. Raw VAPIX escape hatch

For anything not wrapped above:

```bash
axis vapix get q1656 /axis-cgi/param.cgi action=list group=Image
axis vapix post q1656 /axis-cgi/restart.cgi

# JSON-only APIs need a JSON body
axis vapix post q1656 /axis-cgi/apidiscovery.cgi --json-body '{"apiVersion":"1.0","method":"getApiList"}'
```

The response body is printed verbatim — that's the point of this command. But because most
VAPIX CGIs report failure as **HTTP 200 with the error in the body**, a warning is printed
when the body carries one of those in-band error forms, so it isn't missed when eyeballing
raw output.

## Notes

- `--cloud-url`/`--cloud-token` profiles authenticate via `DEVICE_ACCESS_TOKEN` instead of Basic/Digest auth,
  matching the CamStreamer Cloud (device-connect.net) proxy pattern. Live event watching (`axis events watch`)
  requires a local `--ip` profile since it opens a direct WebSocket to the camera.
- CamSwitcher control has no dedicated camstreamerlib wrapper in older library versions, but v4's
  `CamSwitcherAPI` exposes `playlistSwitch`/`playlistQueuePush`/etc. directly, which this CLI uses.
- Extend this by adding a new file under `src/commands/`, exporting a `register*Commands(program)` function,
  and wiring it into `src/index.ts`.

### How firmware compatibility works

Worth knowing if you're extending the CLI or wondering why an error reads the way it does.

- **VAPIX calls go through `src/vapix/`**, not through `camstreamerlib`'s `VapixAPI`. That
  wrapper targets current firmware: its ACAP listing schema requires fields that older
  devices omit, it lowercases the ACAP package name (which `control.cgi` matches exactly),
  and it silently discards `param.cgi` error lines. `camstreamerlib` is still used for the
  CamOverlay/CamStreamer/CamSwitcher ACAP APIs and the WebSocket event stream.
- **Capabilities are probed, not inferred from the version.** One
  `param.cgi?action=list&group=Brand,Properties` — the request that works on every device
  since firmware 5.00 — yields the `Properties.*` flags each VAPIX API's documentation names
  in its own "Identification" section, and the result is cached for the process. Firmware
  version is consulted only where no capability parameter exists (WebSocket events,
  `applications/config.cgi`), and a version that can't be parsed is treated optimistically:
  attempt the call and let the camera answer, rather than refusing on a guess.
- **Add capabilities in `src/capabilities.ts`**, and prefer a `Properties.*` probe over a
  version threshold whenever one exists. Same firmware can ship on devices with and without
  PTZ, with and without a card slot, on armv7hf and aarch64.
- **`npm test`** replays recorded AXIS OS 5.51, 9.80, 10.12 and 12.11 responses through the
  parsers via a mock transport (`test/mock-camera.ts`, `test/fixtures.ts`). Add a fixture
  when you touch a parser — these failure modes only appear on firmware you probably don't
  have on your desk.
- **`./live-test.sh <profile> ...`** runs the whole surface against real cameras, read-only
  by default; `--write` adds reversible state changes. It asserts on output *content*, not
  just exit codes, because the worst bugs here produce confidently wrong output with exit 0.
  An M1137 rendering its SDK list as `[object Object]` exited 0 and passed every
  fixture-based test — the documented response shape simply wasn't the one the camera sends.
- **Coerce every parsed value through `src/vapix/xml.ts`.** Anything reaching a template
  string or a table cell must go through `str()`, which returns null for an object rather
  than "[object Object]". This is the single most common way a real camera breaks a parser:
  it sends an element with attributes where the docs show plain text.
- Credentials are stored in plaintext in `~/.axis-cli/config.json` (mode 0600). Prefer the interactive
  prompt or `AXIS_PASS` over `--pass` so secrets stay out of your shell history and `ps` output.
- `smoke-test.sh` runs a regression pass against an isolated `$HOME`, so it never touches your real config.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE). Read it, run it, change it, share it — for any
noncommercial purpose. Selling it, or building it into something you charge for, needs a
separate licence: ask at <https://4xs.dev>.

Pavel Kotyza · [4XS.dev](https://4xs.dev)
