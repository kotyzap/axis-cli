#!/bin/bash
# Regression smoke test for the fixes in REVIEW.md.
# Runs against an isolated $HOME so your real ~/.axis-cli/config.json is untouched.
cd "$(dirname "$0")" || exit 1
export HOME=/tmp/axis-cli-smoke
rm -rf "$HOME"; mkdir -p "$HOME"
A="node dist/index.js"

echo "### B1 — --tls should default to port 443"
AXIS_PASS=secret $A camera add Q1656 --ip 192.168.1.156 --tls
grep -E '"port"|"tls"' "$HOME/.axis-cli/config.json"

echo; echo "### B3 — --port abc should be rejected"
AXIS_PASS=x $A camera add Bad --ip 1.2.3.4 --port abc; echo "exit=$?"

echo; echo "### B5 — 'ptz list' alias resolves"
$A ptz list Q1656 2>&1 | head -3

echo; echo "### B5 — typo suggests the right command"
$A cmaera list 2>&1 | head -5

echo; echo "### B2 — events watch: clean error, no stack trace"
$A events watch nosuch 2>&1 | head -4; echo "exit=${PIPESTATUS[0]}"

echo; echo "### S1 — no password anywhere, non-TTY"
$A camera add NoPass --ip 1.2.3.4 2>&1 | head -3; echo "exit=${PIPESTATUS[0]}"

echo; echo "### camera add — all problems reported at once"
AXIS_PASS=x $A camera add Both 2>&1 | head -6

echo; echo "### C3 — reboot without --yes must not exit 0"
$A reboot Q1656 2>&1 | head -3; echo "exit=${PIPESTATUS[0]}"

echo; echo "### --json — machine-readable, no secrets"
$A camera list --json

echo; echo "### camera update — change a field"
AXIS_PASS=newsecret $A camera update Q1656 --pass 2>&1 | head -2
$A camera list

echo; echo "### config permissions"
stat -f "%Sp %N" "$HOME/.axis-cli/config.json"

# ---------------------------------------------------------------------------
# Firmware compatibility (1.2.0)
#
# The unit suite (npm test) covers the parsers against recorded AXIS OS 5.51,
# 9.80, 10.12 and 12.11 responses. What's checked here is the CLI surface: that
# the new commands exist, are wired up, and fail cleanly without a camera.
# ---------------------------------------------------------------------------

echo; echo "### caps — command is registered"
$A caps --help 2>&1 | head -3

echo; echo "### caps — unknown profile fails cleanly, exits 1"
$A caps nosuch 2>&1 | head -2; echo "exit=${PIPESTATUS[0]}"

echo; echo "### apps install/uninstall — registered"
$A apps --help 2>&1 | grep -E "install|uninstall"

echo; echo "### apps install — a missing .eap is rejected before any network call"
$A apps install Q1656 /tmp/definitely-not-here.eap 2>&1 | head -2; echo "exit=${PIPESTATUS[0]}"

echo; echo "### apps install — a non-.eap file is rejected"
: > /tmp/not-an-acap.txt
$A apps install Q1656 /tmp/not-an-acap.txt 2>&1 | head -2; echo "exit=${PIPESTATUS[0]}"

echo; echo "### apps uninstall — refuses without --yes, exits non-zero"
$A apps uninstall Q1656 whatever 2>&1 | head -2; echo "exit=${PIPESTATUS[0]}"

echo; echo "### ptz commands — registered"
$A ptz --help 2>&1 | grep commands

echo; echo "### vapix post --json — flag exists and malformed JSON is caught early"
$A vapix post Q1656 /axis-cgi/apidiscovery.cgi --json-body '{not json' 2>&1 | head -2; echo "exit=${PIPESTATUS[0]}"

echo; echo "### unit tests (parsers vs recorded firmware responses)"
npm test --silent 2>&1 | grep -E "^# (tests|pass|fail)"
