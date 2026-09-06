# Changelog

All notable changes to axis-cli are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-09-06

Adds `axis preflight`: whether a camera survives an AXIS OS upgrade, answered
before the maintenance window instead of during it.

### Added

- **`axis preflight`** — `check <camera>` (default), `fleet`, and `rules`.
  Read-only: it uses the same `applications/list.cgi` and `param.cgi` calls the
  rest of the CLI already makes, and writes nothing to the camera.

  AXIS OS 13 rolls the whole upgrade back if any installed ACAP fails to
  re-install, and reports nothing about which one. The scan names them.

  Eight detections, each verified against hardware (AXIS Q1656/12.11.77 and
  AXIS M1137/10.12.300): A1 compatibility declaration, A4 signature status,
  A5 Y2038 32-bit ABI break, A8 DLPU declaration, and the C1–C4 parameter reads.
  Exit codes 0 / 1 / 2 for will-upgrade / unknown / will-roll-back, so a fleet
  scan can gate a maintenance script.

  **Unknown is never reported as a pass.** AXIS OS 10.x does not publish the
  per-application fields A1 and A4 read, so those cameras report `unknown`. The
  same applies when the account cannot list applications, which needs
  Administrator while the rest of the scan does not.

  A5 reads `Properties.System.Architecture` rather than matching Axis's
  published 32-bit model list — an AXIS M1137 reports `armv7hf` and is absent
  from that list, so the list alone would have cleared an exposed camera.

- `npm run sync:rules` — copies the bundled ruleset from the Preflight repo,
  validating its shape before overwriting. `PREFLIGHT_RULES` overrides the path.

### Changed

- `AcapApplication` gains `resources`, parsed from
  `<Resources><Resource name="DeepLearningProcessor" used=".."/></Resources>`.
  AXIS OS 13 makes that declaration mandatory and nothing read it before —
  `raw` only holds attributes of `<application>` itself.
- The type `Preflight` in `vapix/apps.ts` is renamed `UploadPrecheck`. It means
  ".eap upload pre-check", and `axis preflight` now means something else
  entirely; two meanings of one word in one codebase is how the wrong check gets
  called. The function `preflightUpload` is unchanged.
- `postbuild` copies `rules.json` into `dist/` — tsc does not copy JSON out of
  `src`, so without this a packaged install would fail at runtime.

## [1.3.0] — 2026-07-29

Adds `axis discovery`, for the case every camera setup starts with: a new
device is on the network and you don't know its IP.

### Added

- **`axis discovery`** (alias `axis discover`) — scans the local subnet and
  reports which hosts are Axis cameras, without a saved profile. The classic
  broadcast-based "Axis IP Utility" trick (SSDP/UPnP/mDNS) is unreliable on
  current firmware — AXIS OS 11/12.x commonly ships with multicast discovery
  disabled by default — so this instead checks each host on ports 443/80 and
  asks it who it is via the VAPIX Basic Device Info API, which most Axis
  firmware answers with no credentials at all. Reports model, serial number
  and firmware version for anything confirmed; hosts that answered on
  80/443 but declined identification are listed separately if their MAC
  matches a registered Axis Communications AB OUI, so a device with Basic
  Device Info disabled still turns up as a lead rather than disappearing.
  Auto-detects the local /24 or takes `--subnet <cidr>`; supports `--timeout`,
  `--concurrency`, `--user`/`--pass` (for a device that requires credentials
  even for identification), and `--json`.

  ```bash
  axis discovery
  axis discovery --subnet 192.168.1.0/24
  axis discovery --json
  ```

- **`axis discovery --add`** — scan and save in one step. After the scan,
  interactively offers each confirmed camera that isn't already a saved
  profile ("Add AXIS Q1656 at 192.168.1.156? (Y/n)"), then asks for a profile
  name (suggested from the model, de-duplicated against existing profiles),
  a username (default `root`), and a password (hidden input, or `AXIS_PASS`),
  and saves it exactly as `axis camera add` would. A camera already declined
  is skipped without stopping the batch; Ctrl+C stops the whole thing.
  Refuses to run without a TTY or together with `--json`, since both make the
  prompts meaningless.

  ```bash
  axis discovery --add
  ```

## [1.2.1] — 2026-07-29

Fixes a class of bug found by running 1.2.0 against real hardware: a camera
sends a *richer* response shape than the documented example, and the CLI renders
it as `[object Object]`. That failure mode produces confidently wrong output with
exit code 0, so neither the exit status nor the test fixtures caught it.

The instance that surfaced it: an AXIS M1137 at 10.12.300 answers
`applications/info.cgi` with `<sdk version="3.5">acap3</sdk>`, where Axis
documents a bare `<sdk>acap3</sdk>`. With attribute parsing on, an element
carrying both text and attributes becomes an object rather than a string.

### Added

- **`src/vapix/xml.ts`** — one place that coerces parsed XML values, used by every
  parser. Returns null rather than a stringified object, because callers already
  render null honestly as `-` or "not reported".
- **`live-test.sh`** — a live test against real cameras, read-only by default.
  Asserts on output *content*, not just exit codes, since that is the only thing
  that catches this bug class. `--write` adds reversible state changes, with a
  restore-on-interrupt trap.
- 34 more unit tests (135 total), covering every shape below.

### Fixed

- **`[object Object]` in the Version, Nice-name, Status, Vendor and SD-card
  fields.** The shared `str()` helper stringified objects, and it feeds every
  application and disk field — so this reached the `apps list` table, the ACAP
  list in `info`, the SD-card column of `fleet health`, and the "Started X"
  confirmations. Two of those were more than cosmetic: `apps list --running`
  filters on `status.toLowerCase() === 'running'`, so an affected app vanished
  from the list, and the `fleet health` ACAP count read `0/N`.
- **A disk listing in an unexpected shape reported "no SD card".** The parser
  hardcoded the path `root.disks.disk`, so a namespaced root, a missing `<disks>`
  wrapper, two `<disks>` blocks, or any non-XML body (an HTML error page, a 403)
  all yielded an empty list — which was then reported as an empty card slot.
  Elements are now found by local name at any depth, and a body that cannot be
  parsed reports "unreadable" instead. Sizes with a unit suffix are also rejected
  rather than read as a wrong number (`parseInt('1.9 GB')` is 1).
- **`pan=` with an empty value read as a measured pan of zero.** `Number('')` is
  0, so a camera reporting a key with no value — the natural way a fixed device
  says "no such axis" — showed pan and tilt as `0` rather than "not reported by
  this camera". This defeated the very logic added in 1.2.0 for these cameras.
- **A refused application listing looked like zero installed ACAPs.** The error
  check read `<error>` attributes only, so a text-only
  `<error>Access denied</error>` — or a text-only `<reply>` — parsed as a
  successful empty listing, exit 0.
- **`ptz presets` showed invented preset numbers.** It renumbered by row, but
  preset numbers are not contiguous, so anyone reading `#2` and using
  `gotoserverpresetno=2` would move to the wrong preset. The camera's own number
  is now shown, and an unnamed preset is listed rather than dropped (which had
  shifted every later preset by one).
- **`events watch` invented timestamps.** Any `timestamp` that was not a number —
  an ISO string, or a seconds-based value — fell back to `new Date()`, stamping
  the line with the current wall clock and giving no hint it was made up. In a log
  of when things happened, a plausible wrong time is worse than "(no timestamp)".
  Nested event data is now JSON-encoded rather than printed as `[object Object]`,
  and a scalar where an object was expected no longer prints `0=h 1=e 2=l`.
- **`events topics` could suggest a topic that does not exist.** Metadata elements
  were skipped via a fixed namespace-prefix allow-list, so a camera using an
  unlisted prefix had `MessageInstance`/`DataInstance` counted as topic path
  segments. The command then printed one of the fabricated topics as a
  ready-to-paste example, which the camera rejected with "Could not use supplied
  event filter" — the exact confusion the command exists to prevent.
- **A Viewer-level account silently disabled the upload pre-flight.**
  `getAllUnrestrictedProperties` omits `Architecture`, so `apps install` took the
  "cannot check" branch and downgraded its only *blocking* check to a note.
  Missing fields are now filled from `param.cgi`, which already had the value.
  Property names are also read case-insensitively.
- **A zsh trailing comment is now diagnosed.** `axis caps cam1 # note` gave
  "Expected 1 argument but got 9", which says nothing about the cause. Matched
  narrowly — a token that is exactly `#` or begins `# ` — so a `#` in a password,
  a preset name, or an overlay value is still accepted.
- **A stale `info [conflicted].ts` sync-conflict file was being compiled and
  shipped** into `dist/`. Removed, and `tsconfig.json` now excludes that pattern.
- Smaller: `switcher list` and `stream list` could print `[object Object]` or
  `undefined` in a cell; the two-column API list in `caps` was misaligned because
  ANSI escapes counted toward the pad width; `getAppConfig` matched the parameter
  name case-sensitively; a text-only `<VersionRange>` produced a bogus
  `{min:null,max:null}` entry; PTZ command names containing `_` or `-` were
  hidden; `acap-guard` printed a double space when no version was known.

## [1.2.0] — 2026-07-29

Makes axis-cli firmware-universal. Every command now probes what the camera in
front of it actually supports instead of assuming a recent AXIS OS, so the same
binary works on firmware 5.x through AXIS OS 12.x — including an M1137 topped out
at 10.12.338, which several commands could not talk to at all.

### The problem

Up to 1.1.2 every VAPIX call went through `camstreamerlib`'s `VapixAPI`, which
targets current firmware. Three of its assumptions break on older devices:

- Its `applications/list.cgi` schema makes `NiceName`, `Vendor`, `Version`,
  `License` and `Status` **required**. Axis' own XSD marks most of those
  optional, and bundled ACAPs on AXIS OS 9/10 omit several — so one sparse entry
  (a bundled `vmd` with no vendor) made the whole listing throw, taking
  `axis apps list`, `axis info` and the `fleet health` ACAP column with it.
- `startApplication()` lowercases the package name before calling `control.cgi`.
  `package=` is matched **exactly**, so this worked only for ACAPs that happen to
  be all-lowercase on the device. Every third-party ACAP —
  `AXIS_Object_Analytics`, `AXIS_Video_Motion_Detection` — failed with an opaque
  "Error: 4".
- Its parameter parser silently discards `# Error:` lines, so a rejected
  `param.cgi` request returned `{}` — indistinguishable from "that parameter
  doesn't exist here".

On top of that, almost every VAPIX CGI reports failure as **HTTP 200 with the
error in the body**, so code that checks the status line sees success.

### Added

- **`axis caps <name>`** — the capability matrix for a device: firmware and AXIS
  OS track, which VAPIX APIs are present, the ACAP SDK generations the camera
  itself says it accepts, architecture and SoC, mechanical vs digital PTZ, edge
  storage and disks, and which event transports are available. Ends with notes
  explaining the firmware-specific behaviour that affects other commands.
  `--params <group>` also dumps a raw parameter subtree.
- **`axis apps install <name> <file.eap>`** — uploads and installs a package via
  `applications/upload.cgi`, with pre-flight checks *before* the file crosses the
  network: architecture from the filename against the device's own
  `Architecture`, the ACAP generation the firmware targets, and whether the
  camera refuses unsigned packages (the default from AXIS OS 12.0). `--start`
  starts it afterwards; `--force` uploads anyway. All 11 documented upload error
  codes are translated into sentences.
- **`axis apps uninstall <name> <app>`** — removal, refusing bundled
  applications and requiring `--yes`.
- **`axis ptz commands <name>`** — the PTZ commands a channel actually
  advertises. PTZ support is not all-or-nothing; a camera may accept `zoom` and
  reject `move`.
- **`axis vapix post --json-body <json>`** — reaches the JSON-only APIs
  (`basicdeviceinfo.cgi`, `apidiscovery.cgi`, `firmwaremanagement.cgi`), which
  the escape hatch previously could not touch at all.
- **A test suite** (`npm test`): 97 cases replaying recorded AXIS OS 5.51, 9.80,
  10.12 and 12.11 responses through the parsers, plus a `MockCamera` transport
  that emulates a chosen firmware generation. These failures only appear on
  firmware you don't have to hand, which is exactly why they went unnoticed.

### Changed

- **All VAPIX access moved to a hardened layer** (`src/vapix/`) that calls the
  CGIs directly and tolerates every documented response shape. `camstreamerlib`
  is still used for what it is good at: the CamOverlay, CamStreamer and
  CamSwitcher ACAP APIs, and the WebSocket event stream.
- **Capabilities are probed once per camera** from a single
  `param.cgi?action=list&group=Brand,Properties` — the one request that works on
  every device since firmware 5.00 — and cached for the rest of the process.
  Version numbers are consulted only where no capability parameter exists.
- **`axis info`** now also reports the AXIS OS track, the ACAP generation, the
  SDKs the device accepts, architecture, SoC, and SD card status.
- **`axis camera test`** reports the firmware generation and any compatibility
  notes, so surprises surface when the profile is created rather than on first
  use.
- **`axis fleet health`** gained a Notes column and points out when a fleet spans
  multiple AXIS OS generations. It distinguishes "no ACAP support" from "no
  access" from a real count, and "no card slot" from "empty slot".
- **`axis reboot`** prefers `firmwaremanagement.cgi` (firmware 7.40+) and falls
  back to `restart.cgi`, which is still documented and still present in 12.x.
- **`axis apps start|stop|restart`** accept a name, a nice name, or a unique
  substring, and resolve it to the exact `Name` the camera expects. An unknown
  name now lists what *is* installed.
- **`axis param get`** returns keys exactly as the camera reports them (with the
  `root.` prefix), and requests are sent without the prefix, as the docs require.
  Writes go in a POST body rather than the query string, keeping values out of
  the camera's access log.
- **`overlay`, `stream` and `switcher` failures now name their cause.** These
  talk to ACAP APIs, not camera firmware, so a missing or stopped ACAP used to
  fail identically to an unreachable host.
- **Cloud (`--cloud-url`) profiles honour `--timeout`.** The cloud client ignored
  it, so `fleet health --timeout` had no effect on those profiles despite cloud
  requests being the ones most likely to hang.

### Fixed

- **`axis apps list` and `axis info` failed outright on cameras with sparse ACAP
  entries** — the required-field schema described above. Every attribute except
  `Name` is now optional, and unknown attributes are preserved.
- **`axis apps start/stop/restart` could not control any non-CamStreamer ACAP**
  because of the lowercased package name.
- **`axis ptz position` reported "pan: expected number, received nan"** on a
  fixed camera. An M1137 answers `pan=nan tilt=nan zoom=1`, which is correct
  behaviour — the response depends on what the product supports. Each axis is now
  optional and the command reports what the camera does report, saying explicitly
  which axes it does not.
- **PTZ commands ran against cameras with no PTZ**, producing a schema error.
  Support is now read from `Properties.PTZ.*` first, and digital PTZ is
  distinguished from mechanical — a digital-PTZ box camera is no longer refused.
- **`axis info` could fail entirely because of one absent parameter.** It
  requested a fixed list including `root.Network.eth0.IPAddress`; `param.cgi`
  fails the *whole* request if any group is unknown, and not every product has an
  `eth0`. Network parameters are now fetched separately and tolerated.
- **`axis events watch` failed with a bare socket error on pre-10.11 firmware.**
  The WebSocket data stream only arrived in AXIS OS 10.11, so on a 9.80 camera the
  handshake failed with nothing to indicate that firmware — not the network or the
  credentials — was the cause. It now checks first and points at
  `axis events topics`, which works back to firmware 5.50.
- **`# Error:` responses from `param.cgi` are no longer swallowed.** A rejected
  request now fails instead of returning an empty result that looks like an
  absent parameter.
- **A value containing `Error:` is no longer mistaken for a failure.**
  `camstreamerlib` matches `/Error:([^<]*)/` anywhere in the body, so a parameter
  value or log line containing the word made a successful call throw. Matching is
  now anchored to the start of a line.
- **Values containing `=` are no longer truncated** when parsing parameters.
- **A 403 from `basicdeviceinfo.cgi` falls back to `param.cgi`** instead of
  failing. `getAllProperties` needs Operator; a Viewer account can still identify
  the device through parameters.
- **HTTP 204 counts as success.** `com/ptz.cgi` answers 204 for control commands,
  so a successful move could be reported as a failure.
- **Idempotent ACAP control.** "Already running" on `start` and "not running" on
  `stop` are treated as success, since these commands end up in scripts.
- **Clearer 401/403/404 messages** that name the likely cause, including the fact
  that AXIS OS 11.6 and later ship without a default `root` account.
- **`fleet health` sets a non-zero exit code in `--json` mode too.** It was set
  only in human mode, so the monitoring check always reported success to the
  scripts most likely to be reading it.
- **Firmware comparison edge cases.** A version reported as a bare major (`12`)
  now counts as `12.0` rather than as pre-12.0, which had suppressed exactly the
  advice that applied to it. A malformed internal threshold now throws instead of
  silently answering "supported". ACAP versions are compared as versions, not as
  floats — as a float `1.3` beat `1.20`, though as versions `1.3` is older.
- **A failing optional JSON API no longer takes down the whole CLI.** Capability
  detection calls `basicdeviceinfo.cgi`, and an in-band JSON error there (code
  8000, 4002, …) propagated — so one grumpy optional API failed every command on a
  camera whose `param.cgi` worked perfectly. Probes now fall back on any failure.
- **`apps install` no longer refuses every upload to a stock AXIS OS 12 camera.**
  Blocking findings were identified by substring-matching the message text, and
  `AllowUnsigned=false` — the *default* from 12.0, which says nothing about the
  file being uploaded — matched. Only a definite architecture mismatch blocks now.
- **Storage tells three outcomes apart:** no card slot, empty slot, and "could not
  read" (usually a privilege problem). All three previously rendered as `n/a`.
  Sizes are also shown for a `connected` disk, not only an `OK` one.
- **`axis ptz presets` prints a table** in human mode instead of raw JSON.
- **`axis vapix post` uses `--json-body`,** not `--json`: the latter collides with
  the global output-mode flag, which is stripped from argv before commander sees
  it, so its value was silently reinterpreted as a positional argument.
- **`axis apps uninstall` checks `--yes` before touching the network**, so
  declining does not require a reachable camera.
- **XML attribute lookups are case-insensitive** in the application and disk
  parsers, since Axis' own docs warn that these responses mix conventions.
- **The SDK list no longer renders as `[object Object]`.** Found on a real M1137
  at 10.12.300: `applications/info.cgi` sends `<sdk version="3.5">acap3</sdk>`,
  not the bare `<sdk>acap3</sdk>` of the documented example. With attribute
  parsing enabled an element carrying both text and attributes becomes an object,
  and stringifying it produced `[object Object], [object Object]` in the ACAP line
  of both `axis caps` and `axis info`. The text node is now read, with the
  attribute used as a fallback when there is no text at all.

## [1.1.2] — 2026-07-29

Fixes `axis stream stop` timing out on actively-publishing streams.

### Fixed

- **`axis stream stop` could time out with "The operation was aborted due to
  timeout".** `camstreamerlib` hardcodes a 10-second abort timeout on any request
  that doesn't specify one, and neither `stream start` nor `stream stop` passed
  one through. Starting a stream just flips a flag and returns immediately, but
  stopping one that's actively publishing can legitimately take longer: the
  camera has to gracefully close its encoder connection to the RTMP/HLS/SRT
  destination before `set_stream_enabled.cgi` answers. That teardown regularly
  exceeded 10 seconds, and there was no flag to raise it.

  Both commands now accept `-t, --timeout <ms>`. `stream start` defaults to
  10000 (unchanged); `stream stop` defaults to **20000**, since evidence from a
  real camera showed the old default wasn't enough. Verified against a mock
  camera whose `set_stream_enabled` response is deliberately delayed 15
  seconds: the old 10s window fails, the new 20s default succeeds, and an
  explicit `--timeout 10000` reproduces the original failure on demand.
- **A bare timeout error gave no indication of what to do.** `AbortSignal.timeout()`
  rejects with a `TimeoutError` that has no `.cause`, so `describeError()` fell
  straight through to the raw browser-style message. It now explains that the
  camera didn't respond in time, suggests raising `--timeout` where available,
  and notes why stopping a live stream can take longer than starting one.

## [1.1.1] — 2026-07-29

Fixes `axis events watch`, which could not work at all in 1.1.0.

### Fixed

- **`axis events watch` always failed with "Could not use supplied event filter".**
  `camstreamerlib`'s `VapixEvents` builds the camera-side `eventFilterList` from
  its own registered listener *names* — each name is sent verbatim as a
  `topicFilter`. The command registered `stream.on('event', ...)`, so it asked the
  camera to subscribe to a topic literally called `event`, which the camera
  rejected. Every invocation failed, on every camera.

  Listeners are now registered under real ONVIF topic expressions (default `//.`,
  every topic), and events are received through `onAny()`, since the camera emits
  under the concrete topic rather than the wildcard. Verified by asserting the
  exact JSON sent over the WebSocket: `[{"topicFilter":"event"}]` before,
  `[{"topicFilter":"//."}]` after.
- **`--tls-insecure` was ignored by `events watch`.** `connectionOptions()` didn't
  pass `tlsInsecure` through, so `WsClient` kept `rejectUnauthorized: true` and any
  `--tls` profile using the camera's stock self-signed certificate failed to
  connect — even though the profile explicitly said `--tls-insecure`.
- **A spurious event line was printed on connect.** `VapixEvents` emits its own
  `open`/`close`/`error` lifecycle signals through the same emitter that carries
  events, so `onAny()` saw them and printed `(unknown) (no data)`. Lifecycle names
  are now filtered out.

### Added

- **`axis events topics <name>`** (alias `axis events list`) — lists the topic
  expressions the camera actually publishes, by flattening its
  `GetEventInstances` topic tree. This is how you find valid `--topic` values
  instead of guessing. Supports `--filter <substring>` and `--json`.

  The tree flattener handles unprefixed path segments, which real cameras emit for
  ACAP events (`tnsaxis:CameraApplicationPlatform/VMD/Camera1ProfileANY`), and
  skips the `aev:*` message-shape subtrees that would otherwise pollute the path.
- **`axis events watch --topic <filter>`** — repeatable, to subscribe to specific
  topics rather than everything. Axis recommends this: each subscription starts
  internal services on the camera.
- **`axis events watch --raw`** — full JSON payload per event. The default is now a
  one-line `timestamp  topic  key=value ...` summary instead of raw JSON.
- When the camera rejects a filter, the error now explains what a topic filter is
  and points at `axis events topics`.

### Changed

- Default `events watch` output is a readable one-line summary per event. Use
  `--raw` or `--json` for the previous full-payload behaviour.

## [1.1.0] — 2026-07-29

Bug-fix and usability release. All fixes verified against a live AXIS Q1656 on
firmware 12.10.73.

### ⚠️ Behaviour changes

Two changes could affect existing scripts:

- **`--tls` now defaults the port to 443** (was 80). If you previously worked around
  this by passing `--port 443` explicitly, that still works. Profiles saved with the
  old default are wrong on disk — fix them with
  `axis camera update <name> --tls` (which now moves the port with the flag).
- **`axis reboot` without `--yes` now exits 1** (was 0). It previously printed a warning
  and exited successfully, so scripts could not tell that nothing had happened.

### Fixed

- **Device info was always blank.** `camstreamerlib`'s `getParameter()` returns keys
  with the leading `root.` stripped, so `axis info`, `axis fleet health`, and
  `axis camera test` looked up `root.Brand.ProdFullName` against a response containing
  `Brand.ProdFullName`. Brand, product, firmware, serial and IP silently rendered as
  `-` on every camera. Lookups are now prefix-normalised.
- **`--tls` was unusable.** It left the port at 80, so every TLS profile attempted
  HTTPS against an HTTP port.
- **Third-party ACAPs were hidden.** `axis info` filtered on `appId`, which
  `camstreamerlib` only populates for the CamStreamer family, so Axis-native and
  third-party ACAPs never appeared. Use `--all-acaps` for the full inventory; the
  filtered label now reads "CamStreamer ACAPs" so the scope is explicit.
- **`axis events watch` printed a raw stack trace and exited 0** on any failure — it was
  the only command not routed through the shared error handler. It now also registers a
  mandatory `error` listener, so a mid-stream connection drop can't crash the process.
- **Invalid numbers were accepted silently.** `--port abc` was stored as
  `"port": null`. Ports, channels, service IDs, timeouts and concurrency are now
  validated with range checks.
- **Unhandled rejections.** `parseAsync()` had no `.catch()`, so any error escaping a
  command handler produced a Node stack dump.
- **Config permissions weren't re-asserted.** `mode: 0600` only applies when a file is
  created, so an existing config with looser permissions stayed that way.
- **`axis` failed with `permission denied` after a rebuild.** The package's `bin` points at
  `dist/index.js`, but `tsc` does not set an executable bit — so anything that regenerated
  `dist/` left the linked command unusable until `npm link` was run again. A `postbuild`
  step now chmods the entry point to 755 on every build.
- Overlay `enable`/`disable` were described as "Show"/"Hide" in `--help`.
- `axis overlay list` guessed at the service shape (`s.id ?? s.serviceId ?? …`) instead
  of using the documented one.
- The version in `--version` was hardcoded rather than read from `package.json`.

### Added

- **`axis camera update <name>`** — change any field without remove-and-re-add.
  Bare `--pass` / `--cloud-token` prompt for the new value.
- **`axis camera test <name>`** — verify reachability and credentials in one call.
- **`--tls-insecure`** — accept the self-signed certificate most Axis cameras ship with.
  Without it, `--tls` failed against a stock camera.
- **`--json`** on every command, accepted anywhere on the command line. Secrets are
  never included in JSON output.
- **Interactive password prompts.** Omit `--pass` and you're prompted without echo.
  `AXIS_PASS` and `AXIS_CLOUD_TOKEN` are honoured for CI. Passing secrets as flags no
  longer the only option — they leak into shell history and `ps`.
- **`axis stream list`** — wraps `CamStreamerAPI.getStreamList()`.
- **`axis apps list --running`** and **`axis info --all-acaps`**.
- **`axis fleet health --timeout` / `--concurrency`** — cameras are probed in parallel,
  so one dead camera no longer stalls the report. Exits 1 if any camera is unreachable,
  making it usable directly as a cron monitoring check.
- **`ls` aliases** on `apps`, `stream` and `switcher`, matching `camera ls`.
- **`axis ptz list`** as an alias for `axis ptz presets`, for consistency with every
  other command group.
- `smoke-test.sh` — regression script that runs against an isolated `$HOME`, so your
  real `~/.axis-cli/config.json` is never touched.

### Changed

- **Errors explain the cause and the fix.** Transport failures no longer surface as a
  bare `fetch failed`; `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`,
  self-signed and expired certificates each get a specific message. Schema validation
  failures are condensed instead of dumping a wall of JSON — `axis ptz position` on a
  fixed camera now explains that the axis isn't reported rather than printing a Zod blob.
- **Mistyped commands get suggestions.** `axis cmaera list` answers
  `(Did you mean camera?)`, and errors print usage.
- **`axis camera add` reports every problem at once**, with a worked example, instead of
  one error per invocation.
- `axis reboot` resolves the profile *before* the confirmation gate, so an unknown name
  fails immediately rather than after a `--yes` round-trip.
- `reboot` moved out of `commands/raw.ts` into `commands/system.ts`.
- Shared helpers extracted to `src/util.ts` (`parseIntOrThrow`, `parseKeyValue`,
  `pickParam`, `promptSecret`, `resolveSecret`).

### Documentation

- `docs/index.html` rebuilt: theme switcher (light default), corrected command
  examples, a Reliability section, copy-to-clipboard code blocks, and GitHub links.
- `docs/img/axis-automation-sample.sh` **rewritten** — the previous version was
  non-functional. It called `axis fleet` (no `health`), `axis acap list --profile`,
  `axis ptz go`, `axis camstreamer start`, `axis camoverlay push`, and passed VAPIX
  query strings inline. None of those commands have ever existed.
- README examples no longer put passwords on the command line.

### Known limitations

- Credentials are stored in plaintext in `~/.axis-cli/config.json` (mode 0600).
  macOS Keychain storage is the intended next step.
- The CamStreamer Cloud (`device-connect.net`) path is implemented but has not been
  exercised end-to-end against a live cloud profile.
- No automated test suite beyond `smoke-test.sh`, whose network-dependent half needs a
  reachable camera.

## [1.0.0] — 2026-07-28

Initial release.
