#!/bin/bash
#
# axis-cli installer for macOS
# Double-click this file in Finder, or run: ./install.command
#
# Installs the `axis` command globally so it is available in any terminal,
# permanently, across reboots. Camera profiles live in ~/.axis-cli/config.json
# and are never touched by this script.
#

set -u

# Always work from the directory this script lives in (Finder starts in $HOME).
cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$(pwd)"

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'

info()  { printf '%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok()    { printf '%s  ok%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '%swarn%s %s\n' "$YELLOW" "$OFF" "$1"; }
fail()  { printf '%sfail%s %s\n' "$RED" "$OFF" "$1"; }

# Keep the Terminal window open so double-click users can read the output.
finish() {
    code=$1
    echo
    if [ "$code" -eq 0 ]; then
        printf '%sInstall complete.%s\n' "$GREEN$BOLD" "$OFF"
    else
        printf '%sInstall failed.%s\n' "$RED$BOLD" "$OFF"
    fi
    printf '%sPress Return to close this window.%s\n' "$DIM" "$OFF"
    read -r _
    exit "$code"
}

printf '%s\n' "----------------------------------------------"
printf '%s  axis-cli installer (macOS)%s\n' "$BOLD" "$OFF"
printf '%s\n' "----------------------------------------------"
echo
printf '%sProject:%s %s\n' "$DIM" "$OFF" "$PROJECT_DIR"
echo

# --- 1. Sanity check: are we in the right folder? ---------------------------
if [ ! -f package.json ]; then
    fail "package.json not found here."
    echo "     Keep install.command inside the axis-cli project folder."
    finish 1
fi

# --- 2. Check Node.js -------------------------------------------------------
info "Checking Node.js"

# Finder-launched scripts get a minimal PATH. Add the usual Node locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Pick up nvm's default version if Node isn't on PATH yet.
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi

if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is not installed (or not on PATH)."
    echo
    echo "  Install it with Homebrew:"
    echo "      brew install node"
    echo
    echo "  Or download the LTS installer from https://nodejs.org"
    finish 1
fi

NODE_BIN="$(command -v node)"
NODE_VER="$(node -v)"          # e.g. v20.11.0
NODE_MAJOR="${NODE_VER#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [ "$NODE_MAJOR" -lt 18 ]; then
    fail "Node $NODE_VER found, but axis-cli requires Node 18 or newer."
    echo "     Upgrade with: brew upgrade node"
    finish 1
fi
ok "Node $NODE_VER  ($NODE_BIN)"

if ! command -v npm >/dev/null 2>&1; then
    fail "npm not found alongside Node. Reinstall Node.js."
    finish 1
fi
ok "npm $(npm -v)"

# Warn about nvm: a global install is scoped to one Node version.
case "$NODE_BIN" in
    *"/.nvm/"*)
        warn "Node is managed by nvm."
        echo "     A global install only exists for Node $NODE_VER. If you switch"
        echo "     Node versions, re-run this installer. Homebrew Node avoids this."
        ;;
esac

# Warn if the project sits on an external/removable volume.
case "$PROJECT_DIR" in
    /Volumes/*)
        echo
        warn "Project is on an external volume."
        echo "     That's fine: 'npm install -g .' copies the built files into"
        echo "     Node's global folder, so 'axis' keeps working when the drive"
        echo "     is unplugged. (This is why we don't use 'npm link'.)"
        ;;
esac

# --- 3. Install dependencies -----------------------------------------------
echo
info "Installing dependencies"
if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund || {
        warn "npm ci failed; falling back to npm install"
        npm install --no-audit --no-fund || { fail "Could not install dependencies."; finish 1; }
    }
else
    npm install --no-audit --no-fund || { fail "Could not install dependencies."; finish 1; }
fi
ok "Dependencies ready"

# --- 4. Build ---------------------------------------------------------------
echo
info "Building TypeScript"
npm run build || { fail "Build failed. Scroll up for the TypeScript errors."; finish 1; }
[ -f dist/index.js ] || { fail "Build produced no dist/index.js."; finish 1; }
chmod +x dist/index.js
ok "Built dist/index.js"

# --- 5. Global install ------------------------------------------------------
echo
info "Installing 'axis' globally"

NPM_PREFIX="$(npm prefix -g 2>/dev/null || echo /usr/local)"

# Try without sudo first — Homebrew and nvm prefixes are user-writable.
if npm install -g . ; then
    ok "Installed into $NPM_PREFIX"
else
    echo
    warn "Plain install failed (likely permissions on $NPM_PREFIX)."
    echo "     Retrying with sudo — you may be asked for your Mac password."
    echo
    if ! sudo npm install -g . ; then
        fail "Global install failed."
        echo
        echo "     Options:"
        echo "       - Install Node via Homebrew (user-writable prefix):"
        echo "             brew install node"
        echo "       - Or point npm at a folder you own:"
        echo "             npm config set prefix ~/.npm-global"
        echo "             echo 'export PATH=\"\$HOME/.npm-global/bin:\$PATH\"' >> ~/.zshrc"
        finish 1
    fi
fi

# --- 6. Verify --------------------------------------------------------------
echo
info "Verifying"
hash -r 2>/dev/null || true

if command -v axis >/dev/null 2>&1; then
    AXIS_PATH="$(command -v axis)"
    AXIS_VER="$(axis --version 2>/dev/null || echo '?')"
    ok "axis $AXIS_VER  ($AXIS_PATH)"
elif [ -x "$NPM_PREFIX/bin/axis" ]; then
    AXIS_VER="$("$NPM_PREFIX/bin/axis" --version 2>/dev/null || echo '?')"
    ok "axis $AXIS_VER installed at $NPM_PREFIX/bin/axis"
    echo
    warn "That folder is not on your PATH, so typing 'axis' won't work yet."
    echo "     Fix it once with:"
    echo
    echo "         echo 'export PATH=\"$NPM_PREFIX/bin:\$PATH\"' >> ~/.zshrc"
    echo "         source ~/.zshrc"
    echo
    echo "     Then 'axis' works in every new terminal, permanently."
else
    fail "Could not find the installed 'axis' binary."
    echo "     Expected it at $NPM_PREFIX/bin/axis"
    finish 1
fi

# --- 7. Next steps ----------------------------------------------------------
echo
printf '%sNext steps%s\n' "$BOLD" "$OFF"
echo
if [ -f "$HOME/.axis-cli/config.json" ]; then
    ok "Existing camera profiles found at ~/.axis-cli/config.json"
    echo
    echo "    axis camera list        # your saved cameras"
    echo "    axis fleet health       # check them all"
else
    echo "  1. Don't know your camera's IP? Scan for it:"
    echo
    echo "         axis discovery"
    echo "         axis discovery --add     # scan and save interactively in one step"
    echo
    echo "  2. Or save it directly (omit --pass and it prompts, without echo):"
    echo
    echo "         axis camera add q1656 --ip 192.168.1.50 --user root"
    echo
    echo "  3. Check it answers:"
    echo
    echo "         axis camera test q1656"
    echo "         axis info q1656"
fi
echo
echo "    axis --help             # all commands"
echo
printf '%sProfiles are stored in ~/.axis-cli/config.json and survive reboots.%s\n' "$DIM" "$OFF"
printf '%sTo uninstall:  npm uninstall -g axis-cli%s\n' "$DIM" "$OFF"

finish 0
