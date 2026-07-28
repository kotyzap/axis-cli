"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSwitcherCommands = registerSwitcherCommands;
const camstreamerlib_1 = require("camstreamerlib");
const config_1 = require("../config");
const client_1 = require("../client");
const output_1 = require("../output");
function registerSwitcherCommands(program) {
    const sw = program.command('switcher').description('Control CamSwitcher playlists/views');
    sw.command('list <name>')
        .description('List configured playlists')
        .action((0, output_1.action)(async (name) => {
        const cam = (0, config_1.getCamera)(name);
        const cs = new camstreamerlib_1.CamSwitcherAPI((0, client_1.buildClient)(cam));
        const playlists = await cs.getPlaylistSaveList();
        (0, output_1.printJson)(Object.entries(playlists).map(([id, p]) => ({ id, name: p.niceName ?? id })));
    }));
    sw.command('switch <name> <playlistName>')
        .description('Switch to a playlist immediately')
        .action((0, output_1.action)(async (name, playlistName) => {
        const cam = (0, config_1.getCamera)(name);
        const cs = new camstreamerlib_1.CamSwitcherAPI((0, client_1.buildClient)(cam));
        await cs.playlistSwitch(playlistName);
        (0, output_1.ok)(`Switched "${name}" to playlist "${playlistName}"`);
    }));
    sw.command('queue <name> <playlistName>')
        .description('Queue a playlist to play after the current one finishes')
        .action((0, output_1.action)(async (name, playlistName) => {
        const cam = (0, config_1.getCamera)(name);
        const cs = new camstreamerlib_1.CamSwitcherAPI((0, client_1.buildClient)(cam));
        await cs.playlistQueuePush(playlistName);
        (0, output_1.ok)(`Queued playlist "${playlistName}" on "${name}"`);
    }));
    sw.command('queue-clear <name>')
        .description('Clear the playlist queue')
        .action((0, output_1.action)(async (name) => {
        const cam = (0, config_1.getCamera)(name);
        const cs = new camstreamerlib_1.CamSwitcherAPI((0, client_1.buildClient)(cam));
        await cs.playlistQueueClear();
        (0, output_1.ok)(`Cleared playlist queue on "${name}"`);
    }));
}
