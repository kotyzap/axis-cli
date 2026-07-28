#!/usr/bin/env bash
# ==============================================================================
# Name: axis-automation-sample.sh
# Description: Automated fleet monitoring, dynamic overlay updating, and 
#              failsafe stream management using axis-cli.
# Requirements: axis-cli installed globally (binary: axis) and Node.js >= 18.
#               Camera profiles should be pre-configured in ~/.axis-cli/config.json
# ==============================================================================

# Exit immediately if a command exits with a non-zero status
set -euo pipefail

# --- CONFIGURATION ---
# Define the profiles to monitor/control (must correspond to saved profiles in axis-cli)
MAIN_CAM="lobby-camera"
BACKUP_CAM="parking-camera"
TEMP_SENSOR_NAME="Lobby-Temp"

# --- HELPER: COLOR STYLING FOR LOGS ---
log_info() { echo -e "\e[34m[INFO]\e[0m $(date '+%Y-%m-%d %H:%M:%S') - $1"; }
log_warn() { echo -e "\e[33m[WARN]\e[0m $(date '+%Y-%m-%d %H:%M:%S') - $1"; }
log_err()  { echo -e "\e[31m[ERROR]\e[0m $(date '+%Y-%m-%d %H:%M:%S') - $1"; }

# --- PHASE 1: FLEET HEALTH INSPECTION ---
log_info "Starting fleet-wide health check..."

# Run the native fleet health command (inspects reachability, firmware, SD cards, etc.)
# If the fleet health command fails (e.g. timeout or reachability errors), we trap it
if ! axis fleet; then
    log_warn "One or more cameras in the fleet reported a health warning or are unreachable."
else
    log_info "Fleet health check completed successfully."
fi

# --- PHASE 2: CAMERA REACHABILITY & ACTIVE ACAP APP MONITORING ---
log_info "Checking detailed status for primary camera: ${MAIN_CAM}..."

# Verify if the primary camera is reachable and check its ACAP applications
if ! axis acap list --profile "$MAIN_CAM" &>/dev/null; then
    log_err "Primary camera '${MAIN_CAM}' is unreachable or unauthorized! Attempting fallback protocol..."
    
    # Failback protocol: Go to preset on backup camera and start stream
    log_info "Switching ${BACKUP_CAM} PTZ to preset 'LobbyView'..."
    axis ptz go "LobbyView" --profile "$BACKUP_CAM"
    
    log_info "Starting backup RTMP stream on ${BACKUP_CAM}..."
    axis camstreamer start --profile "$BACKUP_CAM"
    exit 1
fi

# --- PHASE 3: DYNAMIC CAMOVERLAY TEXT INJECTION ---
# Simulate pulling live sensor data (e.g., room temperature) and pushing it to the overlay
MOCK_TEMP="$((20 + RANDOM % 10))°C" # Dynamic value
log_info "Updating live temperature overlay on ${MAIN_CAM} with: ${MOCK_TEMP}..."

# We use the CamOverlay integration to push dynamic text fields directly to the screen
# This updates a text widget on the camera in real time
if axis camoverlay push --profile "$MAIN_CAM" --field "$TEMP_SENSOR_NAME" --text "Lobby Temp: ${MOCK_TEMP}"; then
    log_info "Overlay successfully updated."
else
    log_warn "Failed to push text to CamOverlay. Verifying if CamOverlay application is running..."
    # If the overlay app isn't active, restart it
    axis acap restart "camoverlay" --profile "$MAIN_CAM"
fi

# --- PHASE 4: RECOVERY ESCAPE HATCH (RAW VAPIX API CALL) ---
# If you need to check or modify a lower-level parameter not wrapped by axis-cli,
# use the raw VAPIX escape hatch. Let's inspect the system uptime or LED status.
log_info "Executing raw VAPIX call (checking camera firmware details) via escape hatch..."
axis vapix get "/axis-cgi/param.cgi?action=list&group=Properties.System.Firmware" --profile "$MAIN_CAM"

log_info "Automation workflow completed successfully."
