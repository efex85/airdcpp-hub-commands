import { addContextMenuItems } from 'airdcpp-apisocket';

import {
  commandMatchesHub, Context, getInputFields, hasInputVariable, renderText, getHubMenuItems, getUserMenuItems, HUB_MENU_TYPE, HUB_USER_MENU_TYPE,
  MAX_USERS_PER_CLICK, normalizeHubUrl,
} from '../commands';
import { HubCommand } from '../types';
import { migrateSettings } from '../settings';


const HUB_A = 'adcs://hub-a.example.com:1511';
const HUB_B = 'adc://hub-b.example.com:411';

const COMMANDS: HubCommand[] = [
  { hub_url: HUB_A, name: 'Calendar new', text: '+cal new' },
  { hub_url: HUB_B, name: 'Hub B only', text: '+other', third_person: true },
  { hub_url: '', name: 'Everywhere', text: '+help' },
  { hub_url: HUB_A, name: 'Greet user', text: 'Hello {nick}!' },
  { hub_url: HUB_A, name: '', text: 'ignored, no name' },
];

const createContext = (commands = COMMANDS) => {
  const sent: { sessionId: number, text: string, thirdPerson: boolean }[] = [];
  const events: string[] = [];
  const logged: string[] = [];
  const hubs: { [id: number]: string } = { 1: HUB_A, 2: HUB_B };
  const nicks: { [id: number]: string } = { 11: 'alice', 12: 'bob' };
  const messages: any[] = [];

  const context: Context = {
    api: {
      getHub: async (id: number) => ({ id, hub_url: hubs[id] }),
      getHubUser: async (_: number, id: number) => ({ id, nick: nicks[id] || `user${id}` }),
      getHubMessages: async () => messages,
      sendChatMessage: async (sessionId: number, text: string, thirdPerson: boolean) => {
        sent.push({ sessionId, text, thirdPerson });
      },
      postEvent: async (text: string) => {
        events.push(text);
      },
    } as any,
    logger: {
      error: (...args: any[]) => logged.push(args.join(' ')),
      warn: () => undefined,
      info: () => undefined,
      verbose: () => undefined,
    },
    getCommands: () => commands,
  };

  return { context, sent, events, logged, messages };
};

// Minimal socket that records hooks/listeners so that the real addContextMenuItems helper can be exercised
const createMockSocket = () => {
  const hooks: { [key: string]: Function } = {};
  const listeners: { [key: string]: Function } = {};
  const removed: string[] = [];

  const socket: any = {
    logger: { warn: () => undefined, error: () => undefined, info: () => undefined, verbose: () => undefined },
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

  const select = (menuType: string, data: object) => {
    return listeners[`menus/${menuType}_menuitem_selected`]({ permissions: [ 'hubs_send' ], supports: [], ...data });
  };

  return { socket, listItems, select, hooks, listeners, removed };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));


describe('hub URL matching', () => {
  test('normalizes case, trailing slashes and keyprint', () => {
    expect(normalizeHubUrl(' ADCS://Hub-A.Example.com:1511/?kp=SHA256/ABC ')).toBe(HUB_A);
    expect(normalizeHubUrl(undefined)).toBe('');
    expect(normalizeHubUrl(null)).toBe('');
  });

  test('empty address matches every hub', () => {
    expect(commandMatchesHub({ name: 'a', text: 'b', hub_url: '' }, HUB_A)).toBe(true);
    expect(commandMatchesHub({ name: 'a', text: 'b' }, HUB_B)).toBe(true);
  });

  test('port and protocol are optional in the configured address', () => {
    const match = (configured: string, hub: string) => commandMatchesHub({ name: 'a', text: 'b', hub_url: configured }, hub);

    // Host only: any protocol and port
    expect(match('hub-a.example.com', HUB_A)).toBe(true);
    expect(match('HUB-A.example.com', 'adcs://hub-a.example.com:19990/?kp=SHA256/ABC')).toBe(true);
    expect(match('hub-a.example.com', 'adc://hub-a.example.com:411')).toBe(true);
    expect(match('hub-a.example.com', 'hub-a.example.com')).toBe(true);
    expect(match('hub-a.example.com', HUB_B)).toBe(false);

    // A specified protocol or port must match
    expect(match('hub-a.example.com:1511', HUB_A)).toBe(true);
    expect(match('hub-a.example.com:1512', HUB_A)).toBe(false);
    expect(match('adc://hub-a.example.com', HUB_A)).toBe(false);
    expect(match('adcs://hub-a.example.com', HUB_A)).toBe(true);

    // Only whole host names are matched
    expect(match('example.com', HUB_A)).toBe(false);
    expect(match('hub-a.example', HUB_A)).toBe(false);

    // IP addresses
    expect(match('192.0.2.105', 'adcs://192.0.2.105:13330/?kp=SHA256/ABC')).toBe(true);
    expect(match('192.0.2.10', 'adcs://192.0.2.105:13330')).toBe(false);
    expect(match('[::1]', 'adcs://[::1]:5600')).toBe(true);
  });

  test('additional hubs are matched as well', () => {
    const command = { name: 'a', text: 'b', hub_url: HUB_A, more_hubs: `${HUB_B}, ADC://Third.example.com/` };
    expect(commandMatchesHub(command, HUB_A)).toBe(true);
    expect(commandMatchesHub(command, HUB_B)).toBe(true);
    expect(commandMatchesHub(command, 'adc://third.example.com')).toBe(true);
    expect(commandMatchesHub(command, 'adc://other.example.com')).toBe(false);
  });

  test('additional hubs work without a main hub', () => {
    const command = { name: 'a', text: 'b', hub_url: null, more_hubs: HUB_B };
    expect(commandMatchesHub(command, HUB_B)).toBe(true);
    expect(commandMatchesHub(command, HUB_A)).toBe(false);
  });

  test('address must match the hub', () => {
    expect(commandMatchesHub({ name: 'a', text: 'b', hub_url: HUB_A }, 'ADCS://HUB-A.example.com:1511/')).toBe(true);
    expect(commandMatchesHub({ name: 'a', text: 'b', hub_url: HUB_A }, HUB_B)).toBe(false);
    expect(commandMatchesHub({ name: 'a', text: 'b', hub_url: HUB_A }, 'adcs://hub-a.example.com:1512')).toBe(false);
  });
});

describe('user menu (hub_user)', () => {
  test('shows only the commands of the hub where the menu was opened', async () => {
    const { context } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const hubA = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 1 });
    expect(hubA.menuitems.map((item: any) => item.title)).toEqual([ 'Calendar new', 'Everywhere', 'Greet user' ]);

    const hubB = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 2 });
    expect(hubB.menuitems.map((item: any) => item.title)).toEqual([ 'Hub B only', 'Everywhere' ]);
  });

  test('hides items from users without the hubs_send permission', async () => {
    const { context } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const result = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 1, permissions: [ 'hubs_view' ] });
    expect(result.menuitems).toEqual([]);
  });

  test('selecting an item sends the message to the hub session', async () => {
    const { context, sent } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    // Item IDs come from the list response
    const list = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 2 });
    const item = list.menuitems.find((i: any) => i.title === 'Hub B only');

    await mock.select(HUB_USER_MENU_TYPE, { hook_id: 'airdcpp-hub-commands', menuitem_id: item.id, selected_ids: [ 11 ], entity_id: 2 });
    await flush();

    expect(sent).toEqual([ { sessionId: 2, text: '+other', thirdPerson: true } ]);
  });

  test('{nick} is replaced for every selected user', async () => {
    const { context, sent } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11, 12 ], entity_id: 1 });
    const item = list.menuitems.find((i: any) => i.title === 'Greet user');

    await mock.select(HUB_USER_MENU_TYPE, { hook_id: 'airdcpp-hub-commands', menuitem_id: item.id, selected_ids: [ 11, 12 ], entity_id: 1 });
    await flush();

    expect(sent.map(m => m.text)).toEqual([ 'Hello alice!', 'Hello bob!' ]);
    expect(sent.every(m => m.sessionId === 1 && !m.thirdPerson)).toBe(true);
  });

  test('a plain command is sent once even with several users selected', async () => {
    const { context, sent } = createContext();
    const items = getUserMenuItems(context);
    const item = items.find(i => i.title === 'Calendar new')!;

    await (item.onClick as any)({ selectedIds: [ 11, 12 ], entityId: 1, permissions: [], supports: [], formValues: {} });
    expect(sent).toEqual([ { sessionId: 1, text: '+cal new', thirdPerson: false } ]);
  });

  test('limits the number of messages sent for {nick} commands', async () => {
    const { context, sent, events } = createContext();
    const items = getUserMenuItems(context);
    const item = items.find(i => i.title === 'Greet user')!;

    const ids = Array.from({ length: MAX_USERS_PER_CLICK + 5 }, (_, i) => 100 + i);
    await (item.onClick as any)({ selectedIds: ids, entityId: 1, permissions: [], supports: [], formValues: {} });

    expect(sent).toHaveLength(MAX_USERS_PER_CLICK);
    expect(events).toHaveLength(1);
  });

  test('uses the chat history for users who are no longer in the user list', async () => {
    const { context, sent, messages } = createContext();
    context.api.getHubUser = async (_: number, id: number) => { throw new Error(`User ${id} was not found`); };
    messages.push(
      { status_message: { text: 'something' } },
      { chat_message: { from: { id: 1096173912, nick: 'gone-user' } } },
    );

    const item = getUserMenuItems(context).find(i => i.title === 'Greet user')!;
    await (item.onClick as any)({ selectedIds: [ 1096173912 ], entityId: 1, permissions: [], supports: [], formValues: {} });
    expect(sent.map(m => m.text)).toEqual([ 'Hello gone-user!' ]);
  });

  test('reports a clear error when the nick can not be found anywhere', async () => {
    const { context, sent, events } = createContext();
    context.api.getHubUser = async (_: number, id: number) => { throw new Error(`User ${id} was not found`); };

    const item = getUserMenuItems(context).find(i => i.title === 'Greet user')!;
    await (item.onClick as any)({ selectedIds: [ 1096173912 ], entityId: 1, permissions: [], supports: [], formValues: {} });
    expect(sent).toEqual([]);
    expect(events[0]).toContain('could not be found');
  });

  test('reports failures instead of throwing', async () => {
    const { context, events, logged } = createContext();
    context.api.sendChatMessage = async () => { throw new Error('Hub is not connected'); };

    const item = getUserMenuItems(context).find(i => i.title === 'Everywhere')!;
    await (item.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: [], formValues: {} });

    expect(logged[0]).toContain('Hub is not connected');
    expect(events[0]).toContain('Hub is not connected');
  });

  test('hides hub specific items when the hub can not be resolved', async () => {
    const { context, logged } = createContext();
    context.api.getHub = async () => { throw new Error('Not found'); };

    const item = getUserMenuItems(context).find(i => i.title === 'Calendar new')!;
    expect(await (item.filter as any)({ selectedIds: [ 11 ], entityId: 99, permissions: [], supports: [] })).toBe(false);
    expect(logged).toHaveLength(1);
  });
});

describe('hub session menu (hub)', () => {
  test('lists the commands of the selected hub and skips {nick} commands', async () => {
    const { context } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const hubA = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 1 ] });
    expect(hubA.menuitems.map((item: any) => item.title)).toEqual([ 'Calendar new', 'Everywhere' ]);

    const hubB = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 2 ] });
    expect(hubB.menuitems.map((item: any) => item.title)).toEqual([ 'Hub B only', 'Everywhere' ]);
  });

  test('selecting an item sends the message to the selected hub', async () => {
    const { context, sent } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 1 ] });
    const item = list.menuitems.find((i: any) => i.title === 'Calendar new');

    await mock.select(HUB_MENU_TYPE, { hook_id: 'airdcpp-hub-commands', menuitem_id: item.id, selected_ids: [ 1 ] });
    await flush();

    expect(sent).toEqual([ { sessionId: 1, text: '+cal new', thirdPerson: false } ]);
  });

  test('item IDs stay in sync with the list so the right command is sent', async () => {
    const { context, sent } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 1 ] });
    const item = list.menuitems.find((i: any) => i.title === 'Everywhere');
    await mock.select(HUB_MENU_TYPE, { hook_id: 'airdcpp-hub-commands', menuitem_id: item.id, selected_ids: [ 1 ] });
    await flush();

    expect(sent).toEqual([ { sessionId: 1, text: '+help', thirdPerson: false } ]);
  });

  test('ignores selections meant for other extensions', async () => {
    const { context, sent } = createContext();
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    await mock.select(HUB_MENU_TYPE, { hook_id: 'some-other-extension', menuitem_id: 'hub_command_0', selected_ids: [ 1 ] });
    await flush();
    expect(sent).toEqual([]);
  });

  test('removal functions unregister the hook and the listener', async () => {
    const { context } = createContext();
    const mock = createMockSocket();
    const remove = await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    await remove();
    expect(mock.removed.sort()).toEqual([ 'hook:hub_list_menuitems', 'listener:hub_menuitem_selected' ]);
  });
});

describe('input variable', () => {
  const INPUT_COMMANDS: HubCommand[] = [
    { name: 'TV', text: '+tv {input:Show name}', placement: 'both' },
    { name: 'Plain input', text: '+find {input}', placement: 'both' },
    { name: 'Slap with reason', text: '+slap {nick} {input:Reason}', placement: 'user' },
    { name: 'Static', text: '+help', placement: 'both' },
  ];

  const FORM = [ 'form' ];

  test('variable parsing', () => {
    expect(hasInputVariable({ name: 'a', text: '+tv {input}' })).toBe(true);
    expect(hasInputVariable({ name: 'a', text: '+tv {nick}' })).toBe(false);
    expect(getInputFields({ name: 'a', text: '+tv {input:Show name }' })).toEqual([ { key: 'input_1', label: 'Show name' } ]);
    expect(getInputFields({ name: 'a', text: '+tv {input}' })).toEqual([ { key: 'input_1', label: 'Input' } ]);
    expect(getInputFields({ name: 'a', text: '+tv {input:}' })).toEqual([ { key: 'input_1', label: 'Input' } ]);
    expect(getInputFields({ name: 'a', text: '+reg {nick} {input:username} {input:profile} {INPUT:Username}' })).toEqual([
      { key: 'input_1', label: 'username' },
      { key: 'input_2', label: 'profile' },
    ]);
  });

  test('variables are replaced in a single pass', () => {
    expect(renderText('+tv {input:Show} / {input}', { inputs: { show: 'The Wire' } })).toBe('+tv The Wire / {input}');
    expect(renderText('{nick} {input:X}', { nick: 'alice', inputs: { x: 'hi {nick}' } })).toBe('alice hi {nick}');
    expect(renderText('{nick}', { nick: '$& $1' })).toBe('$& $1');
    expect(renderText('{nick} {input}', {})).toBe('{nick} {input}');
  });

  test('the menu item asks for the input with the given label', async () => {
    const { context } = createContext(INPUT_COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 1, supports: FORM });
    const tv = list.menuitems.find((i: any) => i.title === 'TV');
    expect(tv.form_definitions).toEqual([ { key: 'input_1', title: 'Show name', type: 'string', default_value: '' } ]);

    const plain = list.menuitems.find((i: any) => i.title === 'Plain input');
    expect(plain.form_definitions[0].title).toBe('Input');

    // Static commands have no form
    expect(list.menuitems.find((i: any) => i.title === 'Static').form_definitions).toBeUndefined();
  });

  test('commands asking for input are hidden when the client does not support forms', async () => {
    const { context } = createContext(INPUT_COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 1, supports: [] });
    expect(list.menuitems.map((i: any) => i.title)).toEqual([ 'Static' ]);
  });

  test('the entered text is sent from the user menu', async () => {
    const { context, sent } = createContext(INPUT_COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 1, supports: FORM });
    const tv = list.menuitems.find((i: any) => i.title === 'TV');

    await mock.select(HUB_USER_MENU_TYPE, {
      hook_id: 'airdcpp-hub-commands', menuitem_id: tv.id, selected_ids: [ 11 ], entity_id: 1, supports: FORM,
      form_values: { input_1: '  The Wire  ' },
    });
    await flush();

    expect(sent).toEqual([ { sessionId: 1, text: '+tv The Wire', thirdPerson: false } ]);
  });

  test('{nick} and {input} can be used together', async () => {
    const { context, sent } = createContext(INPUT_COMMANDS);
    const item = getUserMenuItems(context).find(i => i.title === 'Slap with reason')!;

    await (item.onClick as any)({ selectedIds: [ 11, 12 ], entityId: 1, permissions: [], supports: FORM, formValues: { input_1: 'too loud' } });
    expect(sent.map(m => m.text)).toEqual([ '+slap alice too loud', '+slap bob too loud' ]);
  });

  test('nothing is sent when the input is empty or missing', async () => {
    const { context, sent, events } = createContext(INPUT_COMMANDS);
    const item = getUserMenuItems(context).find(i => i.title === 'TV')!;

    await (item.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: FORM, formValues: { input_1: '   ' } });
    await (item.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: FORM, formValues: {} });
    await (item.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: FORM, formValues: undefined });

    expect(sent).toEqual([]);
    expect(events).toHaveLength(3);
    expect(events[0]).toContain('nothing was entered');
  });

  test('input commands work in the hub menu and {nick} ones are left out', async () => {
    const { context, sent } = createContext(INPUT_COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 1 ], supports: FORM });
    expect(list.menuitems.map((i: any) => i.title)).toEqual([ 'TV', 'Plain input', 'Static' ]);

    const tv = list.menuitems.find((i: any) => i.title === 'TV');
    await mock.select(HUB_MENU_TYPE, {
      hook_id: 'airdcpp-hub-commands', menuitem_id: tv.id, selected_ids: [ 1 ], supports: FORM,
      form_values: { input_1: 'Severance' },
    });
    await flush();

    expect(sent).toEqual([ { sessionId: 1, text: '+tv Severance', thirdPerson: false } ]);
  });
});

describe('several input fields', () => {
  const COMMANDS: HubCommand[] = [
    { name: 'Register', text: '+reg {nick} {input:username} {input:profile} ({input:Username})', placement: 'user' },
  ];

  const FORM = [ 'form' ];

  test('every different label gets its own box', async () => {
    const { context } = createContext(COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_USER_MENU_TYPE, { selected_ids: [ 11 ], entity_id: 1, supports: FORM });
    expect(list.menuitems[0].form_definitions).toEqual([
      { key: 'input_1', title: 'username', type: 'string', default_value: '' },
      { key: 'input_2', title: 'profile', type: 'string', default_value: '' },
    ]);
  });

  test('the values are inserted to their places and a repeated label shares the value', async () => {
    const { context, sent } = createContext(COMMANDS);
    const item = getUserMenuItems(context)[0];

    await (item.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: FORM, formValues: { input_1: ' bob ', input_2: 'vip' } });
    expect(sent.map(m => m.text)).toEqual([ '+reg alice bob vip (bob)' ]);
  });

  test('nothing is sent when any of the boxes is empty', async () => {
    const { context, sent, events } = createContext(COMMANDS);
    const item = getUserMenuItems(context)[0];

    await (item.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: FORM, formValues: { input_1: 'bob', input_2: '  ' } });
    await (item.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: FORM, formValues: { input_2: 'vip' } });

    expect(sent).toEqual([]);
    expect(events).toHaveLength(2);
    expect(events[0]).toContain('profile');
    expect(events[1]).toContain('username');
  });
});

describe('input fields with preset values', () => {
  const COMMANDS: HubCommand[] = [
    { name: 'Register', text: '+reg {input:Username} {input:Profile=20, 30,20} / {input:profile}', placement: 'hub' },
  ];

  const FORM = [ 'form' ];

  test('variable parsing', () => {
    expect(getInputFields(COMMANDS[0])).toEqual([
      { key: 'input_1', label: 'Username' },
      { key: 'input_2', label: 'Profile', options: [ '20', '30' ] },
    ]);

    // Options given later are used when the first one has none
    expect(getInputFields({ name: 'a', text: '{input:A} {input:a=x,y}' })).toEqual([ { key: 'input_1', label: 'A', options: [ 'x', 'y' ] } ]);
    expect(getInputFields({ name: 'a', text: '{input:=x,y} {input:Z=}' })).toEqual([
      { key: 'input_1', label: 'Input', options: [ 'x', 'y' ] },
      { key: 'input_2', label: 'Z' },
    ]);
  });

  test('the menu item has a selection box with the first value preselected', async () => {
    const { context } = createContext(COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 1 ], supports: FORM });
    expect(list.menuitems[0].form_definitions).toEqual([
      { key: 'input_1', title: 'Username', type: 'string', default_value: '' },
      {
        key: 'input_2', title: 'Profile', type: 'string', default_value: '20',
        options: [ { id: '20', name: '20' }, { id: '30', name: '30' } ],
      },
    ]);
  });

  test('the selected value is inserted, other values are rejected', async () => {
    const { context, sent, events } = createContext(COMMANDS);
    const item = getHubMenuItems(context)[0];

    await (item.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: 'bob', input_2: '30' } });
    expect(sent.map(m => m.text)).toEqual([ '+reg bob 30 / 30' ]);

    await (item.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: 'bob', input_2: '40' } });
    expect(sent).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"40" is not one of the values');
  });
});

describe('optional input fields', () => {
  const COMMANDS: HubCommand[] = [
    { name: 'Register', text: '+reg {input:Username} {input:Profile=20,30} {input:Comment?}', placement: 'hub' },
    { name: 'Middle', text: '+a {input:Mid?} end', placement: 'hub' },
  ];

  const FORM = [ 'form' ];

  test('variable parsing', () => {
    expect(getInputFields(COMMANDS[0])).toEqual([
      { key: 'input_1', label: 'Username' },
      { key: 'input_2', label: 'Profile', options: [ '20', '30' ] },
      { key: 'input_3', label: 'Comment', optional: true },
    ]);

    // Any variable of the label can mark it as optional, boxes with options are never optional
    expect(getInputFields({ name: 'a', text: '{input:A} {input:a ?}' })).toEqual([ { key: 'input_1', label: 'A', optional: true } ]);
    expect(getInputFields({ name: 'a', text: '{input:A?=x,y}' })).toEqual([ { key: 'input_1', label: 'A', options: [ 'x', 'y' ] } ]);
    expect(getInputFields({ name: 'a', text: '{input:?}' })).toEqual([ { key: 'input_1', label: 'Input', optional: true } ]);
  });

  test('the form field is optional and has no default value', async () => {
    const { context } = createContext(COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 1 ], supports: FORM });
    expect(list.menuitems[0].form_definitions[2]).toEqual({ key: 'input_3', title: 'Comment', type: 'string', optional: true });
  });

  test('an empty value removes the variable and the space before it', async () => {
    const { context, sent, events } = createContext(COMMANDS);
    const [ register, middle ] = getHubMenuItems(context);

    await (register.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: 'bob', input_2: '30', input_3: '  ' } });
    await (register.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: 'bob', input_2: '20' } });
    await (register.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: 'bob', input_2: '20', input_3: null } });
    await (register.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: 'bob', input_2: '20', input_3: 'nice one' } });
    await (middle.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: '' } });
    await (middle.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: 'x' } });

    expect(sent.map(m => m.text)).toEqual([
      '+reg bob 30', '+reg bob 20', '+reg bob 20', '+reg bob 20 nice one', '+a end', '+a x end',
    ]);
    expect(events).toEqual([]);
  });

  test('required boxes are still required', async () => {
    const { context, sent, events } = createContext(COMMANDS);
    const [ register ] = getHubMenuItems(context);

    await (register.onClick as any)({ selectedIds: [ 1 ], permissions: [], supports: FORM, formValues: { input_1: '', input_2: '20' } });
    expect(sent).toEqual([]);
    expect(events[0]).toContain('"Username"');
  });
});

describe('placement', () => {
  const PLACEMENT_COMMANDS: HubCommand[] = [
    { name: 'User only', text: '+user', placement: 'user' },
    { name: 'Hub only', text: '+hub', placement: 'hub' },
    { name: 'Both', text: '+both', placement: 'both' },
    { name: 'Missing', text: '+missing' },
    { name: 'Hub with nick', text: '+nick {nick}', placement: 'both' },
  ];

  test('user menus show commands placed in user menus or both', () => {
    const { context } = createContext(PLACEMENT_COMMANDS);
    expect(getUserMenuItems(context).map(item => item.title)).toEqual([ 'User only', 'Both', 'Missing', 'Hub with nick' ]);
  });

  test('hub menu shows commands placed in the hub menu or both, without {nick} commands', () => {
    const { context } = createContext(PLACEMENT_COMMANDS);
    expect(getHubMenuItems(context).map(item => item.title)).toEqual([ 'Hub only', 'Both', 'Missing' ]);
  });

  test('the right command is sent when the menu contains filtered commands', async () => {
    const { context, sent } = createContext(PLACEMENT_COMMANDS);
    const mock = createMockSocket();
    await addContextMenuItems(mock.socket, getHubMenuItems(context), HUB_MENU_TYPE, { id: 'airdcpp-hub-commands', name: 'Hub commands' });

    const list = await mock.listItems(HUB_MENU_TYPE, { selected_ids: [ 1 ] });
    const item = list.menuitems.find((i: any) => i.title === 'Both');
    await mock.select(HUB_MENU_TYPE, { hook_id: 'airdcpp-hub-commands', menuitem_id: item.id, selected_ids: [ 1 ] });
    await flush();

    expect(sent).toEqual([ { sessionId: 1, text: '+both', thirdPerson: false } ]);
  });
});

describe('settings migration', () => {
  test('adds the missing fields to commands saved by older versions', () => {
    const migrated = migrateSettings(1, { commands: [ { hub_url: HUB_A, name: 'a', text: 'b' } ] });
    expect(migrated.commands).toEqual([ { hub_url: HUB_A, name: 'a', text: 'b', more_hubs: null, placement: 'both' } ]);
  });

  test('keeps existing values when upgrading from version 2', () => {
    const migrated = migrateSettings(2, { commands: [ { name: 'a', text: 'b', more_hubs: HUB_B } ] });
    expect(migrated.commands).toEqual([ { name: 'a', text: 'b', more_hubs: HUB_B, placement: 'both' } ]);
  });

  test('leaves current settings as they are', () => {
    const data = { commands: [ { name: 'a', text: 'b', more_hubs: HUB_B, placement: 'user' } ] };
    expect(migrateSettings(3, data)).toBe(data);
  });
});
