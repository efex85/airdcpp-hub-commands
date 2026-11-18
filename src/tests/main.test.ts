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

  return { socket, hooks, listeners, removed, posted, listItems };
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


describe('extension', () => {
  jest.setTimeout(20000);

  test('starts with the saved settings, loads the command file, applies its changes and stops cleanly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-commands-main-')) + path.sep;

    // Settings saved by an earlier version
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      version: 1,
      settings: { commands: [ { hub_url: 'hub-a.example.com', name: 'Old command', text: '+old' } ] },
    }));

    const fake = createFakeSocket();
    const extension: any = { name: 'airdcpp-hub-commands', configPath: dir };
    Extension(fake.socket, extension);

    await extension.onStart({ system_info: { api_feature_level: 9 } });

    // The instructions file has been created
    expect(fs.readFileSync(path.join(dir, COMMAND_FILE_NAME), 'utf8')).toBe(DEFAULT_COMMAND_FILE);

    // The old command has been migrated and it is shown in both menus
    const migrated = await fake.socket.get('extensions/airdcpp-hub-commands/settings');
    expect(migrated.commands).toEqual([ { hub_url: 'hub-a.example.com', name: 'Old command', text: '+old', more_hubs: null, placement: 'both' } ]);
    expect(CONFIG_VERSION).toBe(3);

    // Menus for the hub user list and the hub are both registered
    expect(Object.keys(fake.hooks).sort()).toEqual([ 'menus/hub_list_menuitems', 'menus/hub_user_list_menuitems' ]);

    // (the hub address is matched by the hub URL lookup)
    fake.socket.get = (async (url: string) => {
      if (url === 'hubs/1') {
        return { id: 1, hub_url: 'adcs://hub-a.example.com:1511' };
      }

      throw new Error(`Unexpected GET ${url}`);
    }) as any;

    const titles = async () => (await fake.listItems('hub_user', { selected_ids: [ 11 ], entity_id: 1 })).menuitems.map((i: any) => i.title);
    expect(await titles()).toEqual([ 'Old command' ]);

    // Add a command to the file, it should be picked up automatically
    fs.writeFileSync(path.join(dir, COMMAND_FILE_NAME), 'From file | hub-a.example.com | user | +file\nBroken line\n');
    await waitFor(async () => (await titles()).includes('From file'));
    expect(await titles()).toEqual([ 'Old command', 'From file' ]);

    // The previous menu items were removed (user menu + hub menu) before adding the new ones
    expect(fake.removed.filter(r => r === 'hook:hub_user_list_menuitems').length).toBeGreaterThanOrEqual(1);

    // The broken line is reported
    const event = fake.posted.find(p => p.path === 'events');
    expect(event?.data.text).toContain('line 2');

    // Edit the file again: remove the command
    fs.writeFileSync(path.join(dir, COMMAND_FILE_NAME), '# nothing here\n');
    await waitFor(async () => !(await titles()).includes('From file'));
    expect(await titles()).toEqual([ 'Old command' ]);

    // Stopping removes the menu items
    fake.removed.length = 0;
    await extension.onStop();
    expect(fake.removed.sort()).toEqual([
      'hook:hub_list_menuitems', 'hook:hub_user_list_menuitems',
      'listener:hub_menuitem_selected', 'listener:hub_user_menuitem_selected',
    ]);
  });

  test('works without the hub menu on older API versions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-commands-main-')) + path.sep;
    const fake = createFakeSocket();
    const extension: any = { name: 'airdcpp-hub-commands', configPath: dir };
    Extension(fake.socket, extension);

    await extension.onStart({ system_info: { api_feature_level: 5 } });
    expect(Object.keys(fake.hooks)).toEqual([ 'menus/hub_user_list_menuitems' ]);

    await extension.onStop();
  });
});
