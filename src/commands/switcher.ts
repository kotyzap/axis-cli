import { Command } from 'commander';
import { CamSwitcherAPI } from 'camstreamerlib';
import { getCamera } from '../config';
import { buildClient } from '../client';
import { action, ok, printJson } from '../output';

export function registerSwitcherCommands(program: Command) {
    const sw = program.command('switcher').description('Control CamSwitcher playlists/views');

    sw.command('list <name>')
        .description('List configured playlists')
        .action(
            action(async (name: string) => {
                const cam = getCamera(name);
                const cs = new CamSwitcherAPI(buildClient(cam) as any);
                const playlists = await cs.getPlaylistSaveList();
                printJson(Object.entries(playlists).map(([id, p]: any) => ({ id, name: p.niceName ?? id })));
            })
        );

    sw.command('switch <name> <playlistName>')
        .description('Switch to a playlist immediately')
        .action(
            action(async (name: string, playlistName: string) => {
                const cam = getCamera(name);
                const cs = new CamSwitcherAPI(buildClient(cam) as any);
                await cs.playlistSwitch(playlistName);
                ok(`Switched "${name}" to playlist "${playlistName}"`);
            })
        );

    sw.command('queue <name> <playlistName>')
        .description('Queue a playlist to play after the current one finishes')
        .action(
            action(async (name: string, playlistName: string) => {
                const cam = getCamera(name);
                const cs = new CamSwitcherAPI(buildClient(cam) as any);
                await cs.playlistQueuePush(playlistName);
                ok(`Queued playlist "${playlistName}" on "${name}"`);
            })
        );

    sw.command('queue-clear <name>')
        .description('Clear the playlist queue')
        .action(
            action(async (name: string) => {
                const cam = getCamera(name);
                const cs = new CamSwitcherAPI(buildClient(cam) as any);
                await cs.playlistQueueClear();
                ok(`Cleared playlist queue on "${name}"`);
            })
        );
}
