"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSwitcherCommands = registerSwitcherCommands;
const camstreamerlib_1 = require("camstreamerlib");
const session_1 = require("../session");
const client_1 = require("../client");
const acap_guard_1 = require("../acap-guard");
const output_1 = require("../output");
function registerSwitcherCommands(program) {
    const sw = program.command('switcher').description('Control CamSwitcher playlists/views');
    /** As with overlay and stream, the API served here belongs to the ACAP, not the firmware. */
    const api = (name) => {
        const cam = (0, session_1.openCamera)(name);
        return { cam, cs: new camstreamerlib_1.CamSwitcherAPI((0, client_1.buildClient)(cam.profile)) };
    };
    sw.command('list <name>')
        .alias('ls')
        .description('List configured playlists')
        .action((0, output_1.action)(async (name) => {
        const { cam, cs } = api(name);
        const playlists = await (0, acap_guard_1.withAcap)(cam, 'CamSwitcher', () => cs.getPlaylistSaveList());
        // `playlists` is typed loosely by the library, so coerce each cell:
        // an object niceName would otherwise render as "[object Object]".
        const rows = Object.entries(playlists ?? {}).map(([id, p]) => {
            const nice = p?.niceName;
            return { id, name: typeof nice === 'string' && nice.trim() !== '' ? nice : id };
        });
        (0, output_1.printTable)(['ID', 'Name'], rows.map((r) => [r.id, r.name]), rows);
    }));
    sw.command('switch <name> <playlistName>')
        .description('Switch to a playlist immediately')
        .action((0, output_1.action)(async (name, playlistName) => {
        const { cam, cs } = api(name);
        await (0, acap_guard_1.withAcap)(cam, 'CamSwitcher', () => cs.playlistSwitch(playlistName));
        (0, output_1.ok)(`Switched "${name}" to playlist "${playlistName}"`);
    }));
    sw.command('queue <name> <playlistName>')
        .description('Queue a playlist to play after the current one finishes')
        .action((0, output_1.action)(async (name, playlistName) => {
        const { cam, cs } = api(name);
        await (0, acap_guard_1.withAcap)(cam, 'CamSwitcher', () => cs.playlistQueuePush(playlistName));
        (0, output_1.ok)(`Queued playlist "${playlistName}" on "${name}"`);
    }));
    sw.command('queue-clear <name>')
        .description('Clear the playlist queue')
        .action((0, output_1.action)(async (name) => {
        const { cam, cs } = api(name);
        await (0, acap_guard_1.withAcap)(cam, 'CamSwitcher', () => cs.playlistQueueClear());
        (0, output_1.ok)(`Cleared playlist queue on "${name}"`);
    }));
}
