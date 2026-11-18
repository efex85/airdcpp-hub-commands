import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import Extension from '../main';
import { COMMAND_FILE_NAME, DEFAULT_COMMAND_FILE } from '../command-file';
import { CONFIG_VERSION } from '../settings';


// Fake of the API socket that behaves like the extension manager for the calls used by the extension
const createFakeSocket = () => {
  const hooks: { [key: string]: Function } = {};
  const listeners: { [key: string]: Function } = {};
  const removed: string[] = [];
  const posted: { path: string, data: any }[] = [];
  const settings: { [key: string]: any } = {};

  const socket: any = {
    logger: { warn: () => undefined, error: console.error, info: () => undefined, verbose: () => undefined },
    post: async (url: string, data: any) => {
      posted.push({ path: url, data });
      if (url.endsWith('/settings/definitions')) {
        // Defaults are applied by the application
        const commands = data.find((def: any) => def.key === 'commands');
        settings.commands = settings.commands || commands.default_value;
      }
    },
    get: async (url: string) => {
      if (url.endsWith('/settings')) {
        return { ...settings };
      }

      throw new Error(`Unexpected GET ${url}`);
    },
    patch: async (_: string, values: any) => {
      Object.assign(settings, values);

      // The server sends the event to the (already registered) listener before the request is completed
      listeners['extensions/extension_settings_updated']?.(values);
    },
    addHook: async (module: string, event: string, cb: Function) => {
      hooks[`${module}/${event}`] = cb;
      return async () => { removed.push(`hook:${event}`); };
    },
    addListener: async (module: string, event: string, cb: Function) => {
      listeners[`${module}/${event}`] = cb;
      return async () => { removed.push(`listener:${event}`); };
    },
  };

  const listItems = (menuType: string, data: object) => new Promise<any>(resolve => {
    hooks[`menus/${menuType}_list_menuitems`](
      { permissions: [ 'hubs_send' ], supports: [], ...data },
      resolve,
      () => resolve(undefined)
    );
  });

  return { socket, hooks, listeners, removed, posted, listItems, settings };
};

const waitFor = async (condition: () => Promise<boolean> | boolean, timeoutMs = 8000) => {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out');
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }
};


const writeFile = (file: string, content: string) => fs.writeFileSync(file, content);

describe('extension', () => {
  jest.setTimeout(30000);

  const HUB_A = 'adcs://hub-a.example.com:1511';

  const createDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hub-commands-main-')) + path.sep;

  const start = async (dir: string, featureLevel = 9) => {
    const fake = createFakeSocket();
    const extension: any = { name: 'airdcpp-hub-commands', configPath: dir };
    Extension(fake.socket, extension);

    await extension.onStart({ system_info: { api_feature_level: featureLevel } });

    // (the hub address is matched by the hub URL lookup)
    fake.socket.get = (async (url: string) => {
      if (url === 'hubs/1') {
        return { id: 1, hub_url: HUB_A };
      }

      if (url.endsWith('/settings')) {
        return { ...fake.settings };
      }

      throw new Error(`Unexpected GET ${url}`);
    }) as any;

    const titles = async () => (await fake.listItems('hub_user', { selected_ids: [ 11 ], entity_id: 1 })).menuitems.map((i: any) => i.title);
    const names = () => (fake.settings.commands as any[]).map(c => c.name);
    return { fake, extension, titles, names };
  };

  test('commands are synchronized between the settings and the file', async () => {
    const dir = createDir();
    const file = path.join(dir, COMMAND_FILE_NAME);

    // Settings saved by an earlier version, and a file with another command
    writeFile(path.join(dir, 'config.json'), JSON.stringify({
      version: 1,
      settings: { commands: [ { hub_url: 'hub-a.example.com', name: 'Old command', text: '+old' } ] },
    }));
    writeFile(file, '# my notes\nFrom file | hub-a.example.com | user | +file\n');

    const { fake, extension, titles, names } = await start(dir);
    expect(CONFIG_VERSION).toBe(4);

    // Both commands are in both places, the migrated command is shown in both menus
    expect(names()).toEqual([ 'Old command', 'From file' ]);
    expect(fake.settings.commands[0]).toEqual({ hub_url: 'hub-a.example.com', name: 'Old command', text: '+old', more_hubs: null, placement: 'both' });
    expect(fs.readFileSync(file, 'utf8')).toBe('# my notes\nFrom file | hub-a.example.com | user | +file\nOld command | hub-a.example.com | both | +old\n');

    // Menus for the hub user list and the hub are both registered
    expect(Object.keys(fake.hooks).sort()).toEqual([ 'menus/hub_list_menuitems', 'menus/hub_user_list_menuitems' ]);
    expect(await titles()).toEqual([ 'Old command', 'From file' ]);

    // Delete a command in the settings dialog
    await fake.socket.patch('extensions/airdcpp-hub-commands/settings', { commands: [ fake.settings.commands[1] ] });
    await waitFor(() => !fs.readFileSync(file, 'utf8').includes('Old command'));
    expect(fs.readFileSync(file, 'utf8')).toBe('# my notes\nFrom file | hub-a.example.com | user | +file\n');
    expect(await titles()).toEqual([ 'From file' ]);

    // Add a command in the settings dialog
    await fake.socket.patch('extensions/airdcpp-hub-commands/settings', {
      commands: [ ...fake.settings.commands, { name: 'From dialog', text: '+dialog', placement: 'hub', hub_url: null, more_hubs: null, third_person: false, icon: null } ],
    });
    await waitFor(() => fs.readFileSync(file, 'utf8').includes('From dialog'));
    expect(fs.readFileSync(file, 'utf8')).toContain('From dialog | any | hub | +dialog');

    // Edit the file: remove one command and add another
    writeFile(file, '# my notes\nFrom dialog | any | hub | +dialog\nAdded in file | hub-a.example.com | both | /me waves\n');
    await waitFor(() => names().includes('Added in file'));
    expect(names()).toEqual([ 'From dialog', 'Added in file' ]);
    expect(fake.settings.commands[1]).toMatchObject({ text: 'waves', third_person: true, placement: 'both' });
    await waitFor(async () => (await titles()).includes('Added in file'));

    // The file is left as it was written by the user (nothing to write back)
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(fs.readFileSync(file, 'utf8')).toBe('# my notes\nFrom dialog | any | hub | +dialog\nAdded in file | hub-a.example.com | both | /me waves\n');

    // A file with a broken line changes nothing and the file is not overwritten
    const broken = '# my notes\nOnly | any | user | +only\nBroken line\n';
    writeFile(file, broken);
    await waitFor(() => fake.posted.some(p => p.path === 'events' && p.data.text.includes('line 3')));
    expect(names()).toEqual([ 'From dialog', 'Added in file' ]);

    await fake.socket.patch('extensions/airdcpp-hub-commands/settings', { commands: [ fake.settings.commands[0] ] });
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.readFileSync(file, 'utf8')).toBe(broken);

    // Stopping removes the menu items
    fake.removed.length = 0;
    await extension.onStop();
    expect(fake.removed.sort()).toEqual([
      'hook:hub_list_menuitems', 'hook:hub_user_list_menuitems',
      'listener:hub_menuitem_selected', 'listener:hub_user_menuitem_selected',
    ]);
  });

  test('the file wins on startup when it was edited after the settings were saved', async () => {
    const dir = createDir();
    const file = path.join(dir, COMMAND_FILE_NAME);

    writeFile(path.join(dir, 'config.json'), JSON.stringify({
      version: CONFIG_VERSION,
      settings: { commands: [ { name: 'In settings', text: '+s', placement: 'user', hub_url: null, more_hubs: null, third_person: false, icon: null } ] },
    }));
    writeFile(file, 'In file | any | user | +f\n');

    const past = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, 'config.json'), past, past);

    const { extension, names } = await start(dir);
    expect(names()).toEqual([ 'In file' ]);
    await extension.onStop();
  });

  test('the settings win on startup when they were saved after the file was edited', async () => {
    const dir = createDir();
    const file = path.join(dir, COMMAND_FILE_NAME);

    writeFile(file, '# notes\nIn file | any | user | +f\n');
    writeFile(path.join(dir, 'config.json'), JSON.stringify({
      version: CONFIG_VERSION,
      settings: { commands: [ { name: 'In settings', text: '+s', placement: 'user', hub_url: null, more_hubs: null, third_person: false, icon: null } ] },
    }));

    const past = new Date(Date.now() - 60000);
    fs.utimesSync(file, past, past);

    const { extension, names } = await start(dir);
    expect(names()).toEqual([ 'In settings' ]);
    expect(fs.readFileSync(file, 'utf8')).toBe('# notes\nIn settings | any | user | +s\n');
    await extension.onStop();
  });

  test('a new installation creates the instructions file', async () => {
    const dir = createDir();
    const { extension, names } = await start(dir);

    expect(fs.readFileSync(path.join(dir, COMMAND_FILE_NAME), 'utf8')).toBe(DEFAULT_COMMAND_FILE);
    expect(names()).toEqual([]);
    await extension.onStop();
  });

  test('works without the hub menu on older API versions', async () => {
    const dir = createDir();
    const { fake, extension } = await start(dir, 5);
    expect(Object.keys(fake.hooks)).toEqual([ 'menus/hub_user_list_menuitems' ]);

    await extension.onStop();
  });
});
