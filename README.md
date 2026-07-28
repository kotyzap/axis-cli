# axis-cli

A command-line tool for controlling Axis IP cameras: general VAPIX control (params, PTZ, ACAPs, reboot),
CamOverlay/CamStreamer/CamSwitcher management, and fleet-wide health checks — all from the terminal.

Built on `camstreamerlib` v4, `commander`, and `cli-table3`.

## Install

```bash
npm install
npm run build
npm link          # makes the `axis` command available globally
```

Or run it directly without linking: `node dist/index.js <command>`.

## 1. Save your cameras

Camera credentials are stored per-profile in `~/.axis-cli/config.json` (mode 0600), so you only type them once.

```bash
# Local network camera
axis camera add q1656 --ip 192.168.1.50 --user root --pass mypassword

# HTTPS camera
axis camera add frontdoor --ip 192.168.1.60 --pass mypassword --tls

# Camera reached via CamStreamer Cloud (device-connect.net) instead of a local IP
axis camera add remote-cam --cloud-url https://xxxx.device-connect.net --cloud-token YOUR_DEVICE_ACCESS_TOKEN

axis camera list
axis camera remove q1656
```

Every command below takes the profile `name` you chose here, not a raw IP.

## 2. General VAPIX

```bash
axis info q1656                              # brand, firmware, serial, installed ACAPs
axis param get q1656 root.Brand.ProdFullName root.Network.eth0.IPAddress
axis param set q1656 root.Time.DST=yes
axis reboot q1656 --yes
```

## 3. PTZ

```bash
axis ptz presets q1656 -c 1
axis ptz goto q1656 "Home" -c 1
axis ptz position q1656 -c 1
```

## 4. ACAP applications

```bash
axis apps list q1656
axis apps start q1656 CamOverlay
axis apps stop q1656 CamOverlay
axis apps restart q1656 CamScripter
```

## 5. CamOverlay

```bash
axis overlay list q1656
axis overlay enable q1656 2
axis overlay disable q1656 2
axis overlay text q1656 2 temperature=22.5C humidity=45%
```

## 6. CamStreamer

```bash
axis stream show q1656 42448
axis stream start q1656 42448
axis stream stop q1656 42448
```

## 7. CamSwitcher

```bash
axis switcher list q1656
axis switcher switch q1656 MainView
axis switcher queue q1656 GateView
axis switcher queue-clear q1656
```

## 8. Fleet health

Runs across every saved camera profile and reports reachability, firmware, SD card status, and how many
ACAPs are running — handy as a cron job or CamStreamer Scheduler / Claude Scheduled Task.

```bash
axis fleet health
```

## 9. Live events

```bash
axis events watch q1656     # prints VAPIX events (motion, I/O, ACAP events...) until Ctrl+C
```

## 10. Raw VAPIX escape hatch

For anything not wrapped above:

```bash
axis vapix get q1656 /axis-cgi/param.cgi action=list group=Image
axis vapix post q1656 /axis-cgi/restart.cgi
```

## Notes

- `--cloud-url`/`--cloud-token` profiles authenticate via `DEVICE_ACCESS_TOKEN` instead of Basic/Digest auth,
  matching the CamStreamer Cloud (device-connect.net) proxy pattern. Live event watching (`axis events watch`)
  requires a local `--ip` profile since it opens a direct WebSocket to the camera.
- CamSwitcher control has no dedicated camstreamerlib wrapper in older library versions, but v4's
  `CamSwitcherAPI` exposes `playlistSwitch`/`playlistQueuePush`/etc. directly, which this CLI uses.
- Extend this by adding a new file under `src/commands/`, exporting a `register*Commands(program)` function,
  and wiring it into `src/index.ts`.
