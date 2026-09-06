import { Command } from 'commander';
import chalk from 'chalk';
import { openCamera } from '../session';
import { action, isJsonMode, printJson, warn } from '../output';
import { compatibilityNotes } from '../capabilities';
import { describeSdCard, listDisks } from '../vapix/storage';

/**
 * "What does this camera actually support?"
 *
 * The single most useful command when a script behaves differently on two
 * cameras. Rather than making people cross-reference AXIS OS release notes, this
 * reports what was probed, from where, and what follows from it.
 */
export function registerCapsCommand(program: Command) {
    program
        .command('caps <name>')
        .alias('capabilities')
        .description('Show what this camera and firmware support — APIs, ACAP generation, PTZ, storage, events')
        .option('--params <group>', 'Also dump a raw parameter group, e.g. --params Properties.PTZ')
        .action(
            action(async (name: string, opts) => {
                const cam = openCamera(name);
                const caps = await cam.caps();
                const storage = await listDisks(cam.core, caps.params);
                const notes = compatibilityNotes(caps);

                const apiList = caps.apis
                    ? [...caps.apis.values()]
                          .sort((a, b) => a.id.localeCompare(b.id))
                          .map((a) => ({ id: a.id, version: a.version, status: a.status }))
                    : null;

                if (isJsonMode()) {
                    printJson({
                        camera: name,
                        access: caps.device.source,
                        device: caps.device,
                        firmware: {
                            raw: caps.firmware.raw,
                            parts: caps.firmware.parts,
                            osTrack: caps.osTrack,
                        },
                        acap: {
                            ...caps.acap,
                            targetGeneration: caps.acapGeneration?.label ?? null,
                            docs: caps.acapGeneration?.docs ?? null,
                        },
                        ptz: caps.ptz,
                        storage: {
                            ...caps.storage,
                            sdCard: describeSdCard(storage),
                            // The read outcome is reported, not flattened: "no card slot",
                            // "empty slot" and "couldn't ask" are different answers.
                            readStatus: storage.status,
                            readError: storage.status === 'error' ? storage.error : undefined,
                            disks: storage.status === 'ok' ? storage.disks : null,
                        },
                        events: caps.events,
                        apis: {
                            apiDiscovery: caps.apiDiscovery,
                            basicDeviceInfo: caps.basicDeviceInfo,
                            firmwareManagement: caps.firmwareManagement,
                            discovered: apiList,
                        },
                        notes,
                        params: opts.params ? caps.params.under(opts.params) : undefined,
                    });
                    return;
                }

                const yn = (v: boolean) => (v ? chalk.green('yes') : chalk.yellow('no'));
                const section = (title: string) => console.log(`\n${chalk.bold(title)}`);
                const row = (label: string, value: string) => console.log(`  ${label.padEnd(24)}${value}`);

                console.log(chalk.bold(`Capabilities of "${name}"`));
                row('Product', caps.device.productFullName ?? caps.device.productShortName ?? '-');
                row('Firmware', `${caps.firmware.raw || 'unknown'}${caps.osTrack ? ` (${caps.osTrack})` : ''}`);
                row('Architecture', caps.device.architecture ?? 'not reported');
                row('SoC', caps.device.soc ?? 'not reported');
                row('Identity read from', caps.device.source);

                section('VAPIX APIs');
                row('param.cgi', chalk.green('yes') + chalk.dim(' (always — firmware 5.00+)'));
                row('apidiscovery.cgi', yn(caps.apiDiscovery) + chalk.dim(' (AXIS OS 8.50+)'));
                row('basicdeviceinfo.cgi', yn(caps.basicDeviceInfo) + chalk.dim(' (AXIS OS 8.40+)'));
                row('firmwaremanagement.cgi', yn(caps.firmwareManagement) + chalk.dim(' (firmware 7.40+)'));

                section('ACAP');
                if (caps.acap.embeddedDevelopmentVersion === null) {
                    row('Supported', chalk.yellow('no') + chalk.dim(' — this device cannot run ACAPs'));
                } else {
                    row('EmbeddedDevelopment', caps.acap.embeddedDevelopmentVersion);
                    row('list.cgi', yn(caps.acap.canList) + chalk.dim(' (needs 1.20+)'));
                    row('config.cgi', yn(caps.acap.canConfig) + chalk.dim(' (AXIS OS 11.2+)'));
                    row(
                        'SDKs the device accepts',
                        caps.acap.supportedSdks?.join(', ') ??
                            chalk.dim(`not reported; firmware targets ${caps.acapGeneration?.label ?? 'unknown'}`)
                    );
                    if (caps.acapGeneration) row('ACAP docs', chalk.dim(caps.acapGeneration.docs));
                }

                section('PTZ');
                row('Mechanical PTZ', yn(caps.ptz.mechanical));
                row('Digital PTZ', yn(caps.ptz.digital));

                section('Storage');
                row('Edge storage', yn(caps.storage.supported));
                row('SD card', describeSdCard(storage));
                if (storage.status === 'error') {
                    row('  read error', chalk.yellow(storage.error.split('\n')[0]));
                }
                if (storage.status === 'ok' && storage.disks.length > 0) {
                    for (const d of storage.disks) {
                        row(`  ${d.id}`, `${d.status ?? '?'}${d.filesystem ? ` — ${d.filesystem}` : ''}`);
                    }
                }

                section('Event subscription');
                row('WebSocket (live watch)', yn(caps.events.websocket) + chalk.dim(' (AXIS OS 10.11+)'));
                row('SOAP topic listing', yn(caps.events.soap) + chalk.dim(' (firmware 5.50+)'));
                row('RTSP metadata', yn(caps.events.transports.includes('rtsp-metadata')));

                if (apiList && apiList.length > 0) {
                    section(`APIs advertised by the device (${apiList.length})`);
                    // Two columns: the full list is long on modern firmware and a
                    // one-per-line dump buries the interesting entries.
                    const width = Math.max(...apiList.map((a) => a.id.length)) + 2;
                    // Padding is computed on the visible text and the dim styling is
                    // applied afterwards. Padding a string that already contains ANSI
                    // escapes counts those invisible bytes toward the width, which
                    // misaligned the second column whenever colour was enabled.
                    const cell = (n: number) => {
                        const a = apiList[n];
                        if (!a) return { plain: '', styled: '' };
                        const plain = `${a.id.padEnd(width)}${a.version}`;
                        return { plain, styled: `${a.id.padEnd(width)}${chalk.dim(a.version)}` };
                    };
                    const columnWidth = width + 10;
                    for (let i = 0; i < apiList.length; i += 2) {
                        const left = cell(i);
                        const right = cell(i + 1);
                        const gap = ' '.repeat(Math.max(1, columnWidth - left.plain.length));
                        console.log(`  ${left.styled}${right.styled ? gap + right.styled : ''}`);
                    }
                }

                if (opts.params) {
                    const dump = caps.params.under(opts.params);
                    section(`Parameters under ${opts.params} (${Object.keys(dump).length})`);
                    if (Object.keys(dump).length === 0) {
                        warn('No parameters matched. Note that only Brand.* and Properties.* are probed by default;');
                        warn(`use "axis param get ${name} ${opts.params}" to read any other group.`);
                    }
                    for (const [k, v] of Object.entries(dump).sort()) row(k, v);
                }

                if (notes.length > 0) {
                    section('Notes for this firmware');
                    for (const n of notes) console.log(`  ${chalk.yellow('•')} ${n}`);
                }
                console.log('');
            })
        );
}
