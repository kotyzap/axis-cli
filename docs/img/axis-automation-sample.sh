#!/usr/bin/env bash
# ==============================================================================
# Name: axis-automation-sample.sh
# Description: Automated fleet monitoring, dynamic overlay updating, and
#              failover stream management using axis-cli.
#
# Requirements:
#   - axis-cli installed globally (binary: axis), Node.js >= 18
#   - jq (for parsing --json output)
#   - Camera profiles already saved in ~/.axis-cli/config.json, e.g.:
#       axis camera add lobby-camera   --ip 192.168.1.50
#       axis camera add parking-camera --ip 192.168.1.51
#
# Cron example (every 10 minutes, log to syslog):
#   */10 * * * * /usr/local/bin/axis-automation-sample.sh 2>&1 | logger -t axis-cli
# ==============================================================================

set -euo pipefail

# --- CONFIGURATION -----------------------------------------------------------
MAIN_CAM="lobby-camera"
BACKUP_CAM="parking-camera"

# CamOverlay Custom Graphics service ID on the main camera, and the field to update.
# Find the service ID with: axis overlay list "$MAIN_CAM"
OVERLAY_SERVICE_ID="3"
TEMP_FIELD="Lobby-Temp"

# PTZ preset to fall back to on the backup camera.
BACKUP_PRESET="LobbyView"

# CamStreamer stream ID to start on failover.
# Find it with: axis stream list "$BACKUP_CAM"
BACKUP_STREAM_ID=""

# --- LOGGING -----------------------------------------------------------------
log_info() { printf '\033[34m[INFO]\033[0m %s - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }
log_warn() { printf '\033[33m[WARN]\033[0m %s - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }
log_err()  { printf '\033[31m[ERROR]\033[0m %s - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >&2; }

# --- PHASE 1: FLEET HEALTH INSPECTION ----------------------------------------
# `axis fleet health` exits non-zero if any saved camera is unreachable, so it
# can be used directly as a monitoring check. `--json` makes it parseable.
log_info "Starting fleet-wide health check..."

FLEET_JSON=""
if FLEET_JSON=$(axis fleet health --json --timeout 5000); then
    log_info "All cameras in the fleet are reachable."
else
    log_warn "One or more cameras reported a problem:"
    printf '%s\n' "$FLEET_JSON" \
        | jq -r '.[] | select(.reachable == false) | "  - \(.camera): \(.error // "unreachable")"' \
        || log_warn "  (could not parse fleet output)"
fi

# --- PHASE 2: PRIMARY CAMERA CHECK -------------------------------------------
# `axis camera test` verifies both reachability and credentials in one call.
log_info "Verifying primary camera: ${MAIN_CAM}..."

if ! axis camera test "$MAIN_CAM" >/dev/null 2>&1; then
    log_err "Primary camera '${MAIN_CAM}' is unreachable or unauthorized. Starting failover..."

    log_info "Moving ${BACKUP_CAM} to preset '${BACKUP_PRESET}'..."
    axis ptz goto "$BACKUP_CAM" "$BACKUP_PRESET" -c 1 || \
        log_warn "Could not move ${BACKUP_CAM} to '${BACKUP_PRESET}' (camera may be fixed, not PTZ)."

    if [[ -n "$BACKUP_STREAM_ID" ]]; then
        log_info "Starting backup stream ${BACKUP_STREAM_ID} on ${BACKUP_CAM}..."
        axis stream start "$BACKUP_CAM" "$BACKUP_STREAM_ID"
    else
        log_warn "BACKUP_STREAM_ID is not set — skipping stream failover."
        log_warn "Find the ID with: axis stream list ${BACKUP_CAM}"
    fi

    exit 1
fi

log_info "Primary camera OK."

# Report which CamStreamer ACAPs are running on the main camera.
log_info "Checking ACAP status on ${MAIN_CAM}..."
axis apps list "$MAIN_CAM" --json \
    | jq -r '.[] | select(.appId != null) | "  - \(.Name) \(.Version): \(.Status)"'

# --- PHASE 3: DYNAMIC CAMOVERLAY TEXT INJECTION ------------------------------
# Replace this with a real sensor read (MQTT, Modbus, a REST API, ...).
MOCK_TEMP="$((20 + RANDOM % 10))°C"
log_info "Pushing temperature overlay to ${MAIN_CAM}: ${MOCK_TEMP}"

if axis overlay text "$MAIN_CAM" "$OVERLAY_SERVICE_ID" "${TEMP_FIELD}=Lobby Temp: ${MOCK_TEMP}"; then
    log_info "Overlay updated."
else
    log_warn "Overlay update failed — restarting CamOverlay on ${MAIN_CAM}..."
    axis apps restart "$MAIN_CAM" CamOverlay
fi

# --- PHASE 4: RAW VAPIX ESCAPE HATCH -----------------------------------------
# For endpoints axis-cli doesn't wrap. Note the argument shape:
#   axis vapix get <profile> <path> [key=value ...]
# Query parameters are passed as separate key=value arguments, not in the path.
log_info "Reading firmware details via the raw VAPIX escape hatch..."
axis vapix get "$MAIN_CAM" /axis-cgi/param.cgi \
    action=list \
    group=root.Properties.Firmware

log_info "Automation workflow completed successfully."
