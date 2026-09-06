#!/bin/bash
#
# Live test against real cameras.
#
# The unit suite (npm test) proves the parsers handle recorded firmware responses.
# This proves the whole thing works against actual hardware — which is the only
# way to catch the class of bug where a real camera answers in a shape the
# documentation does not show. (That is exactly how the "[object Object]" SDK bug
# surfaced: Axis documents <sdk>acap3</sdk>, real cameras send
# <sdk version="3.5">acap3</sdk>.)
#
# Usage:
#   ./live-test.sh <profile> [<profile> ...]
#   ./live-test.sh --write <profile>        # also run reversible state changes
#
# Requires real cameras. The event tests in particular exercise /vapix/services and
# the WebSocket data stream, which only exist on actual devices — a stub HTTP server
# cannot stand in for them.
#
# READ-ONLY BY DEFAULT. Without --write, nothing on the camera is modified.
# With --write it will set and restore one harmless parameter, and stop and
# restart one ACAP that is already running. It never reboots, never formats
# storage, and never installs or removes anything.
#
# Uses an isolated $HOME, so your real ~/.axis-cli/config.json is untouched —
# but it needs the profiles to exist there to copy them in.

set -u
cd "$(dirname "$0")" || exit 1

WRITE=0
if [ "${1:-}" = "--write" ]; then WRITE=1; shift; fi

if [ $# -eq 0 ]; then
    echo "Usage: $0 [--write] <profile> [<profile> ...]" >&2
    echo "Profiles must already exist in ~/.axis-cli/config.json." >&2
    exit 64
fi

REAL_CONFIG="$HOME/.axis-cli/config.json"
if [ ! -f "$REAL_CONFIG" ]; then
    echo "No config at $REAL_CONFIG — add your cameras first with 'axis camera add'." >&2
    exit 64
fi

# Copy the real config into a scratch HOME so the test cannot corrupt it, while
# still having the credentials it needs.
export HOME=/tmp/axis-live-test
rm -rf "$HOME"; mkdir -p "$HOME/.axis-cli"
cp "$REAL_CONFIG" "$HOME/.axis-cli/config.json"
chmod 600 "$HOME/.axis-cli/config.json"

A="node dist/index.js"
PASS=0; FAIL=0; SKIP=0
FAILURES=()
# Referenced by the restore trap; declared here for `set -u`.
RESTORE_CAM=""; RESTORE_NAME=""; RESTART_APP=""

# python3 parses the --json output. Checked up front: without it every capability
# flag silently reads as empty, which sends the script down the "unsupported"
# branch on a camera that supports everything — and one of those branches runs
# `events watch`, which never exits.
command -v python3 >/dev/null 2>&1 || { echo "python3 is required by this script." >&2; exit 69; }

# ---------------------------------------------------------------------------

hr() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }
sub() { printf '\n\033[36m--- %s\033[0m\n' "$*"; }

# run <description> <expected-exit> <command...>
run() {
    local desc="$1" want="$2"; shift 2
    printf '\n\033[36m--- %s\033[0m\n' "$desc"
    "$@" 2>&1 | sed 's/^/    /'
    local got=${PIPESTATUS[0]}
    if [ "$want" = "any" ] || [ "$got" = "$want" ]; then
        printf '    \033[32m✓ exit %s\033[0m\n' "$got"; PASS=$((PASS+1))
    else
        printf '    \033[31m✗ exit %s (expected %s)\033[0m\n' "$got" "$want"
        FAIL=$((FAIL+1)); FAILURES+=("$desc (exit $got, expected $want)")
    fi
}

# Assert a command's output matches a pattern. Catches wrong *content* that a
# zero exit code would happily hide — "[object Object]" exited 0.
expect() {
    local desc="$1" pattern="$2"; shift 2
    printf '\n\033[36m--- %s\033[0m\n' "$desc"
    local out; out=$("$@" 2>&1)
    echo "$out" | sed 's/^/    /'
    if echo "$out" | grep -qE "$pattern"; then
        printf '    \033[32m✓ matched /%s/\033[0m\n' "$pattern"; PASS=$((PASS+1))
    else
        printf '    \033[31m✗ did not match /%s/\033[0m\n' "$pattern"
        FAIL=$((FAIL+1)); FAILURES+=("$desc (no match for /$pattern/)")
    fi
}

# Assert output does NOT match — for bugs that show up as bad output.
reject() {
    local desc="$1" pattern="$2"; shift 2
    printf '\n\033[36m--- %s\033[0m\n' "$desc"
    local out; out=$("$@" 2>&1)
    if echo "$out" | grep -qE "$pattern"; then
        echo "$out" | sed 's/^/    /'
        printf '    \033[31m✗ output contains /%s/\033[0m\n' "$pattern"
        FAIL=$((FAIL+1)); FAILURES+=("$desc (output contained /$pattern/)")
    else
        printf '    \033[32m✓ no /%s/ in output\033[0m\n' "$pattern"; PASS=$((PASS+1))
    fi
}

# Reads a value out of a --json payload by dotted path, e.g. "ptz.mechanical" or
# "0.name". Prints nothing when the path is absent or null, so a missing value and
# a literal "None" are distinguishable.
#
# The path is passed as an *argument*, not interpolated into the Python source.
# Interpolating it produced `eval('d' + '['ptz']['mechanical']')` — nested quotes,
# a syntax error, and therefore an empty result for every lookup. Because the
# empty value then failed every "is this supported" test, the script reported the
# capability branches as unsupported on cameras that support them.
json_field() {
    python3 -c '
import sys, json
try:
    value = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for key in sys.argv[1].split("."):
    if isinstance(value, list):
        try:
            value = value[int(key)]
        except (ValueError, IndexError):
            sys.exit(0)
    elif isinstance(value, dict):
        if key not in value:
            sys.exit(0)
        value = value[key]
    else:
        sys.exit(0)
if value is None:
    sys.exit(0)
print(json.dumps(value) if isinstance(value, (list, dict)) else value)
' "$1" 2>/dev/null
}

# ---------------------------------------------------------------------------

hr "Build and unit tests"
npm run build >/dev/null 2>&1 || { echo "BUILD FAILED"; exit 1; }
# The status is captured, not discarded. Piping straight into grep made grep's
# status the pipeline's, so a red suite printed "# fail 3" and the script still
# summarised "failed: 0".
UNIT_OUT=$(npm test --silent 2>&1); UNIT_RC=$?
echo "$UNIT_OUT" | grep -E "^# (tests|pass|fail)" | sed 's/^/    /'
if [ $UNIT_RC -ne 0 ]; then
    printf '    \033[31m✗ unit tests failed\033[0m\n'
    FAIL=$((FAIL+1)); FAILURES+=("unit tests failed (npm test exit $UNIT_RC)")
else
    printf '    \033[32m✓ unit tests passed\033[0m\n'; PASS=$((PASS+1))
fi

for CAM in "$@"; do
    hr "Camera: $CAM"

    run "camera test" 0 $A camera test "$CAM"
    run "caps" 0 $A caps "$CAM"
    run "info" 0 $A info "$CAM"
    run "info --all-acaps" 0 $A info "$CAM" --all-acaps

    sub "Capability summary (from --json)"
    CAPS=$($A caps "$CAM" --json 2>/dev/null)
    if [ -z "$CAPS" ]; then
        echo "    (caps --json produced nothing — skipping the capability-driven checks)"
        SKIP=$((SKIP+1)); continue
    fi
    FW=$(echo "$CAPS"      | json_field "firmware.raw")
    PTZ_MECH=$(echo "$CAPS"| json_field "ptz.mechanical")
    PTZ_DIG=$(echo "$CAPS" | json_field "ptz.digital")
    CAN_LIST=$(echo "$CAPS"| json_field "acap.canList")
    WS=$(echo "$CAPS"      | json_field "events.websocket")
    STORE=$(echo "$CAPS"   | json_field "storage.supported")
    ARCH=$(echo "$CAPS"    | json_field "device.architecture")
    SDKS=$(echo "$CAPS"    | json_field "acap.supportedSdks")
    printf '    firmware=%s arch=%s\n    ptz: mech=%s digital=%s\n    acap: canList=%s sdks=%s\n    storage=%s  ws-events=%s\n' \
        "$FW" "$ARCH" "$PTZ_MECH" "$PTZ_DIG" "$CAN_LIST" "$SDKS" "$STORE" "$WS"

    # If the flags did not parse, every capability branch below would take the
    # "unsupported" path and report false failures. Bail out for this camera
    # instead of producing a misleading transcript.
    if [ -z "$FW" ] || { [ "$PTZ_MECH" != "True" ] && [ "$PTZ_MECH" != "False" ]; }; then
        printf '    \033[31m✗ could not read the capability flags from caps --json\033[0m\n'
        FAIL=$((FAIL+1)); FAILURES+=("$CAM: caps --json could not be parsed")
        continue
    fi

    # --- Output-correctness checks. These catch bugs an exit code cannot. ---
    reject "no unrendered objects anywhere in caps" '\[object Object\]' $A caps "$CAM"
    reject "no unrendered objects anywhere in info" '\[object Object\]' $A info "$CAM"
    reject "no 'undefined' leaking into caps output" '(^|[^_a-zA-Z])undefined([^_a-zA-Z]|$)' $A caps "$CAM"
    expect "caps names the AXIS OS track" 'AXIS OS [0-9]+|legacy firmware' $A caps "$CAM"
    expect "info reports a serial number" 'Serial: +[A-Z0-9]{8,}' $A info "$CAM"
    expect "caps is valid JSON with --json" '"firmware"' $A caps "$CAM" --json

    # --- Parameters ---
    expect "param get returns root.-prefixed keys" '"root\.Brand\.' $A param get "$CAM" Brand
    expect "param get accepts a root. prefix on input too" '"root\.Brand\.' $A param get "$CAM" root.Brand
    expect "param get on a whole group" '"root\.Properties\.' $A param get "$CAM" Properties.Firmware
    run "param get on a bogus group must fail, not return {}" 1 \
        $A param get "$CAM" NoSuchGroup.NoSuchThing

    # --- ACAPs ---
    if [ "$CAN_LIST" = "True" ]; then
        run "apps list" 0 $A apps list "$CAM"
        run "apps list --running" 0 $A apps list "$CAM" --running
        run "apps list --family" 0 $A apps list "$CAM" --family
        expect "apps list --json exposes exact Name" '"name"' $A apps list "$CAM" --json
        run "apps start with an unknown name fails and lists what exists" 1 \
            $A apps start "$CAM" DefinitelyNotInstalled

        # Name resolution — the fix for the lowercasing bug — is checked without
        # touching the camera: `uninstall` resolves the name and *then* hits the
        # confirmation gate, so a lowercased name that resolves produces the
        # "bundled" or "without confirmation" refusal rather than a "not installed"
        # error. Starting an ACAP to test this would violate the read-only promise.
        FIRST=$($A apps list "$CAM" --json 2>/dev/null | json_field "0.name")
        if [ -n "${FIRST:-}" ]; then
            LOWER=$(printf '%s' "$FIRST" | tr '[:upper:]' '[:lower:]')
            reject "resolving \"$LOWER\" finds the exact Name \"$FIRST\"" \
                "No application named" \
                $A apps uninstall "$CAM" "$LOWER"
        fi
    else
        echo "    (skipping ACAP tests — canList=$CAN_LIST)"; SKIP=$((SKIP+1))
    fi

    # --- PTZ ---
    if [ "$PTZ_MECH" = "True" ] || [ "$PTZ_DIG" = "True" ]; then
        run "ptz position" 0 $A ptz position "$CAM"
        run "ptz presets" 0 $A ptz presets "$CAM"
        run "ptz commands" 0 $A ptz commands "$CAM"
        expect "ptz position reports at least one axis" 'zoom|pan|tilt' $A ptz position "$CAM"
        # Not asserted to fail: some cameras answer for any channel number, others
        # return an error. Either is fine — what must not happen is a crash or
        # unrendered output.
        run "ptz position on an out-of-range channel behaves" any $A ptz position "$CAM" -c 99
        reject "...and prints no unrendered objects" '\[object Object\]' $A ptz position "$CAM" -c 99
    else
        run "ptz position is refused with an explanation" 1 $A ptz position "$CAM"
        expect "the refusal names the PTZ parameters" 'Properties.PTZ' $A ptz position "$CAM"
    fi

    # --- Events ---
    if [ "$WS" = "True" ]; then
        sub "events watch (3s sample, ended with SIGINT)"
        EVLOG=$(mktemp)
        # Backgrounded and signalled by hand rather than via `timeout`: `timeout` is
        # absent on stock macOS, and the previous version recorded a PASS
        # unconditionally, so a "command not found" counted as success. SIGINT (not
        # the SIGTERM `timeout` sends) is also what exercises the CLI's own
        # disconnect-and-exit-0 handler.
        $A events watch "$CAM" >"$EVLOG" 2>&1 &
        EVPID=$!
        sleep 3
        if kill -0 "$EVPID" 2>/dev/null; then
            kill -INT "$EVPID" 2>/dev/null
            wait "$EVPID" 2>/dev/null; EVRC=$?
            head -12 "$EVLOG" | sed 's/^/    /'
            if [ "$EVRC" -eq 0 ]; then
                printf '    \033[32m✓ subscribed, then exited cleanly on SIGINT\033[0m\n'; PASS=$((PASS+1))
            else
                printf '    \033[31m✗ exited %s on SIGINT (expected 0)\033[0m\n' "$EVRC"
                FAIL=$((FAIL+1)); FAILURES+=("$CAM: events watch exited $EVRC on SIGINT")
            fi
        else
            # It exited on its own inside 3s, which means it failed to subscribe.
            wait "$EVPID" 2>/dev/null; EVRC=$?
            head -12 "$EVLOG" | sed 's/^/    /'
            printf '    \033[31m✗ exited on its own after %ss (exit %s)\033[0m\n' 3 "$EVRC"
            FAIL=$((FAIL+1)); FAILURES+=("$CAM: events watch did not stay connected")
        fi
        rm -f "$EVLOG"
    else
        run "events watch is refused with an explanation" 1 $A events watch "$CAM"
    fi
    run "events topics" 0 $A events topics "$CAM"
    expect "events topics yields ONVIF topic expressions" 'tns1:|tnsaxis:' $A events topics "$CAM"

    # --- CamStreamer family. Each may be absent; the point is the error quality. ---
    for pair in "overlay:CamOverlay" "stream:CamStreamer" "switcher:CamSwitcher"; do
        cmd=${pair%%:*}; acap=${pair##*:}
        sub "$cmd list (or a clear reason why not)"

        # Whether the ACAP is present and running decides what a *correct* failure
        # looks like. If it is missing or stopped, the CLI must say so. If it is
        # healthy, a failure is a genuine API problem and surfacing the underlying
        # error verbatim is the right behaviour — demanding a diagnosis there would
        # be asking the CLI to invent one.
        ACAP_STATE=$($A apps list "$CAM" --json 2>/dev/null | python3 -c '
import sys, json
want = sys.argv[1].lower()
try:
    apps = json.load(sys.stdin)
except Exception:
    print("unknown"); raise SystemExit
for a in apps:
    if str(a.get("name", "")).lower() == want:
        print("running" if str(a.get("status", "")).lower() == "running" else "stopped")
        raise SystemExit
print("absent")
' "$acap" 2>/dev/null)
        [ -n "$ACAP_STATE" ] || ACAP_STATE=unknown
        echo "    ($acap is $ACAP_STATE on this camera)"

        out=$($A "$cmd" list "$CAM" 2>&1); rc=$?
        printf '%s\n' "$out" | head -14 | sed 's/^/    /'

        if [ $rc -eq 0 ]; then
            printf '    \033[32m✓ %s answered\033[0m\n' "$acap"; PASS=$((PASS+1))
        elif [ "$ACAP_STATE" = "running" ]; then
            printf '    \033[33m~ %s is running but its API did not answer; the raw error is correct here\033[0m\n' "$acap"
            SKIP=$((SKIP+1))
        elif printf '%s' "$out" | grep -qE "not installed|not running|did not respond|cannot run ACAPs|cannot be installed"; then
            printf '    \033[32m✓ failed with a diagnosis, not a bare transport error\033[0m\n'; PASS=$((PASS+1))
        else
            printf '    \033[31m✗ %s is %s, but the error did not say so\033[0m\n' "$acap" "$ACAP_STATE"
            FAIL=$((FAIL+1)); FAILURES+=("$cmd list on $CAM failed without naming the cause ($acap is $ACAP_STATE)")
        fi
    done

    # --- Raw escape hatch ---
    expect "vapix get" 'root\.Brand' $A vapix get "$CAM" /axis-cgi/param.cgi action=list group=Brand
    expect "vapix post --json-body reaches a JSON-only API" 'apiList|apiVersion|error' \
        $A vapix post "$CAM" /axis-cgi/apidiscovery.cgi --json-body '{"apiVersion":"1.0","method":"getApiList"}'
    # Matched on the warning only: the body itself contains "# Error:", so
    # including "Error" in the pattern would pass whether or not warn() fired.
    expect "vapix warns when a 200 body carries an error" 'body reports an error' \
        $A vapix get "$CAM" /axis-cgi/param.cgi action=list group=Bogus.Nope

    # --- Guard rails ---
    run "reboot without --yes refuses and exits non-zero" 1 $A reboot "$CAM"
    run "apps uninstall without --yes refuses" 1 $A apps uninstall "$CAM" whatever
    run "a bad --timeout is rejected" 1 $A vapix get "$CAM" /axis-cgi/param.cgi --timeout abc
    run "zsh-comment arguments are diagnosed" 1 $A caps "$CAM" '#' some trailing comment

    # --- Optional writes ---
    if [ $WRITE -eq 1 ]; then
        hr "Write tests on $CAM (reversible)"

        sub "param set round-trip on Network.Bonjour.FriendlyName (restored afterwards)"
        BEFORE=$($A param get "$CAM" Network.Bonjour.FriendlyName --json 2>/dev/null \
            | python3 -c "import sys,json;d=json.load(sys.stdin);print(list(d.values())[0] if d else '')" 2>/dev/null)
        if [ -n "${BEFORE:-}" ]; then
            echo "    before: $BEFORE"
            # Registered before the change, so Ctrl+C mid-test still puts it back.
            # Without this, interrupting between the set and the restore left the
            # camera renamed.
            RESTORE_CAM="$CAM"; RESTORE_NAME="$BEFORE"
            trap 'if [ -n "${RESTORE_NAME:-}" ]; then echo; echo "restoring FriendlyName on $RESTORE_CAM..."; $A param set "$RESTORE_CAM" "Network.Bonjour.FriendlyName=$RESTORE_NAME" >/dev/null 2>&1; fi; if [ -n "${RESTART_APP:-}" ]; then echo "restarting $RESTART_APP on $RESTORE_CAM..."; $A apps start "$RESTORE_CAM" "$RESTART_APP" >/dev/null 2>&1; fi; exit 130' INT TERM
            run "set FriendlyName" 0 $A param set "$CAM" "Network.Bonjour.FriendlyName=$BEFORE (axis-cli test)"
            $A param get "$CAM" Network.Bonjour.FriendlyName 2>&1 | sed 's/^/    /'
            run "restore FriendlyName" 0 $A param set "$CAM" "Network.Bonjour.FriendlyName=$BEFORE"
            $A param get "$CAM" Network.Bonjour.FriendlyName 2>&1 | sed 's/^/    /'
            RESTORE_NAME=""
        else
            echo "    (could not read a FriendlyName to round-trip — skipped)"; SKIP=$((SKIP+1))
        fi

        RUNNING=$($A apps list "$CAM" --running --json 2>/dev/null | json_field "0.name")
        if [ -n "${RUNNING:-}" ]; then
            sub "stop then start \"$RUNNING\" (idempotence check included)"
            # So an interrupt between the stop and the start cannot leave it stopped.
            RESTART_APP="$RUNNING"
            run "stop $RUNNING" 0 $A apps stop "$CAM" "$RUNNING"
            run "stop again — must be treated as success" 0 $A apps stop "$CAM" "$RUNNING"
            run "start $RUNNING" 0 $A apps start "$CAM" "$RUNNING"
            run "start again — must be treated as success" 0 $A apps start "$CAM" "$RUNNING"
            RESTART_APP=""
            $A apps list "$CAM" --json 2>/dev/null \
                | python3 -c "
import sys, json
name = '$RUNNING'
for a in json.load(sys.stdin):
    if a.get('name') == name:
        print('    final status:', a.get('status'))
" 2>/dev/null
        else
            echo "    (no running ACAP to cycle — skipped)"; SKIP=$((SKIP+1))
        fi
    fi
done

hr "Fleet"
run "fleet health" any $A fleet health
run "fleet health --json" any $A fleet health --json
expect "fleet health --json is an array of rows" '"reachable"' $A fleet health --json

hr "Summary"
printf 'passed:  %s\nfailed:  %s\nskipped: %s\n' "$PASS" "$FAIL" "$SKIP"
if [ ${#FAILURES[@]} -gt 0 ]; then
    printf '\n\033[31mFailures:\033[0m\n'
    for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
fi
echo
echo "Scratch config used: $HOME/.axis-cli/config.json (your real one was not touched)"
[ "$FAIL" -eq 0 ]
