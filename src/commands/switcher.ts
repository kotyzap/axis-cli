import { Command } from 'commander';
import { CamSwitcherAPI } from 'camstreamerlib';
import { openCamera } from '../session';
import { buildClient } from '../client';
import { withAcap } from '../acap-guard';
import { action, ok, printTable } from '../output';

export function registerSwitcherCommands(program: Command) {
    const sw = program.command('switcher').description('Control CamSwitcher playlists/views');

    /** As with overlay and stream, the API served here belongs to the ACAP, not the firmware. */
    const api = (name: string) => {
        const cam = openCamera(name);
        return { cam, cs: new CamSwitcherAPI(buildClient(cam.profile) as any) };
    };

    sw.command('list <name>')
        .alias('ls')
        .description('List configured playlists')
        .action(
            action(async (name: string) => {
                const { cam, cs } = api(name);
                const playlists = await withAcap(cam, 'CamSwitcher', () => cs.getPlaylistSaveList());
                // `playlists` is typed loosely by the library, so coerce each cell:
                // an object niceName would otherwise render as "[object Object]".
                const rows = Object.entries(playlists ?? {}).map(([id, p]) => {
                    const nice = (p as { niceName?: unknown } | null)?.niceName;
                    return { id, name: typeof nice === 'string' && nice.trim() !== '' ? nice : id };
                });
                printTable(['ID', 'Name'], rows.map((r) => [r.id, r.name]), rows);
            })
        );

    sw.command('switch <name> <playlistName>')
        .description('Switch to a playlist immediately')
        .action(
            action(async (name: string, playlistName: string) => {
                const { cam, cs } = api(name);
                await withAcap(cam, 'CamSwitcher', () => cs.playlistSwitch(playlistName));
                ok(`Switched "${name}" to playlist "${playlistName}"`);
            })
        );

    sw.command('queue <name> <playlistName>')
        .description('Queue a playlist to play after the current one finishes')
        .action(
            action(async (name: string, playlistName: string) => {
                const { cam, cs } = api(name);
                await withAcap(cam, 'CamSwitcher', () => cs.playlistQueuePush(playlistName));
                ok(`Queued playlist "${playlistName}" on "${name}"`);
            })
        );

    sw.command('queue-clear <name>')
        .description('Clear the playlist queue')
        .action(
            action(async (name: string) => {
                const { cam, cs } = api(name);
                await withAcap(cam, 'CamSwitcher', () => cs.playlistQueueClear());
                ok(`Cleared playlist queue on "${name}"`);
            })
        );
}
