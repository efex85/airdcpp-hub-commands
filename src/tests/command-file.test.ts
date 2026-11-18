import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  createCommandFileIfMissing, DEFAULT_COMMAND_FILE, parseCommandFile, readCommandFile, watchCommandFile,
} from '../command-file';
import { commandMatchesHub, Context, getHubMenuItems, getUserMenuItems } from '../commands';
import { Logger } from '../types';


const createLogger = () => {
  const logged: string[] = [];
  const logger: Logger = {
    error: (...args: any[]) => logged.push(`error: ${args.join(' ')}`),
    warn: (...args: any[]) => logged.push(`warn: ${args.join(' ')}`),
    info: () => undefined,
    verbose: () => undefined,
  };

  return { logger, logged };
};

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hub-commands-test-'));

const waitFor = async (condition: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out');
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }
};


describe('parsing', () => {
  test('parses commands, ignoring comments and empty lines', () => {
    const { commands, errors } = parseCommandFile([
      '# A comment',
      '',
      'Slap | myhub.com | user | +slap {nick}',
      '   ',
      '  TV|any|both|+tv {input:Show name}  ',
      '# Another | comment | user | ignored',
    ].join('\n'));

    expect(errors).toEqual([]);
    expect(commands).toEqual([
      { name: 'Slap', placement: 'user', text: '+slap {nick}', hub_url: null, more_hubs: 'myhub.com', third_person: false, icon: null },
      { name: 'TV', placement: 'both', text: '+tv {input:Show name}', hub_url: null, more_hubs: null, third_person: false, icon: null },
    ]);
  });

  test('handles Windows line endings and a BOM', () => {
    const { commands, errors } = parseCommandFile('﻿A | any | hub | +a\r\nB | any | user | +b\r\n');
    expect(errors).toEqual([]);
    expect(commands.map(c => c.name)).toEqual([ 'A', 'B' ]);
    expect(commands[0].text).toBe('+a');
  });

  test('the hub column accepts any/all/*/empty for all hubs', () => {
    const { commands } = parseCommandFile([ 'A | any | user | +a', 'B | ALL | user | +b', 'C | * | user | +c', 'D |  | user | +d' ].join('\n'));
    expect(commands.map(c => c.more_hubs)).toEqual([ null, null, null, null ]);
  });

  test('several hubs can be listed', () => {
    const { commands } = parseCommandFile('A | hub-a.example.com, adcs://hub-b.example.com:1511 | user | +a');
    const command = commands[0];

    expect(commandMatchesHub(command, 'adcs://hub-a.example.com:411')).toBe(true);
    expect(commandMatchesHub(command, 'adcs://hub-b.example.com:1511')).toBe(true);
    expect(commandMatchesHub(command, 'adcs://hub-b.example.com:1512')).toBe(false);
    expect(commandMatchesHub(command, 'adcs://other.example.com')).toBe(false);
  });

  test('the message may contain | characters', () => {
    const { commands, errors } = parseCommandFile('A | any | user | +a one | two | three');
    expect(errors).toEqual([]);
    expect(commands[0].text).toBe('+a one | two | three');
  });

  test('/me at the start of the message sends it as a third person message', () => {
    const { commands } = parseCommandFile([ 'A | any | user | /me slaps {nick}', 'B | any | user | /mention {nick}', 'C | any | user | /ME  waves' ].join('\n'));
    expect(commands.map(c => [ c.text, c.third_person ])).toEqual([
      [ 'slaps {nick}', true ],
      [ '/mention {nick}', false ],
      [ 'waves', true ],
    ]);
  });

  test('placement is not case sensitive', () => {
    const { commands } = parseCommandFile('A | any | HUB | +a');
    expect(commands[0].placement).toBe('hub');
  });

  test('invalid lines are skipped and reported with their line numbers', () => {
    const { commands, errors } = parseCommandFile([
      'Good | any | user | +good',
      'Too few | columns',
      ' | any | user | +no name',
      'Bad placement | any | everywhere | +x',
      'No message | any | user |   ',
      'No message after me | any | user | /me ',
      'Also good | any | both | +also',
    ].join('\n'));

    expect(commands.map(c => c.name)).toEqual([ 'Good', 'Also good' ]);
    expect(errors).toHaveLength(5);
    expect(errors[0]).toContain('line 2');
    expect(errors[1]).toContain('line 3');
    expect(errors[2]).toContain('line 4');
    expect(errors[2]).toContain('everywhere');
    expect(errors[3]).toContain('line 5');
    expect(errors[4]).toContain('line 6');
  });

  test('the generated template contains no active commands', () => {
    const { commands, errors } = parseCommandFile(DEFAULT_COMMAND_FILE);
    expect(commands).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the examples of the template are valid when uncommented', () => {
    const uncommented = DEFAULT_COMMAND_FILE
      .split('\n')
      .filter(line => /^# \w.* \| .* \| (user|hub|both) \| /.test(line))
      .map(line => line.replace(/^# /, ''))
      .join('\n');

    const { commands, errors } = parseCommandFile(uncommented);
    expect(errors).toEqual([]);
    expect(commands.map(c => c.name)).toEqual([ 'Slap', 'TV' ]);
  });
});

describe('file handling', () => {
  test('a missing file contains no commands and no errors', () => {
    const dir = createTempDir();
    const { logger, logged } = createLogger();

    expect(readCommandFile(path.join(dir, 'commands.txt'), logger)).toEqual({ commands: [], errors: [] });
    expect(logged).toEqual([]);
  });

  test('the template is created once and never overwrites the file', () => {
    const dir = createTempDir();
    const file = path.join(dir, 'settings', 'commands.txt');
    const { logger } = createLogger();

    createCommandFileIfMissing(file, logger);
    expect(fs.readFileSync(file, 'utf8')).toBe(DEFAULT_COMMAND_FILE);

    fs.writeFileSync(file, 'My | any | user | +mine\n');
    createCommandFileIfMissing(file, logger);
    expect(fs.readFileSync(file, 'utf8')).toBe('My | any | user | +mine\n');

    expect(readCommandFile(file, logger).commands.map(c => c.name)).toEqual([ 'My' ]);
  });

  test('read problems are reported without throwing', () => {
    const dir = createTempDir();
    const { logger, logged } = createLogger();

    // A directory can't be read as a file
    const result = readCommandFile(dir, logger);
    expect(result.commands).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(logged[0]).toContain('error: Failed to read');
  });

  test('changes to the file are detected, also when the file is replaced', async () => {
    const dir = createTempDir();
    const file = path.join(dir, 'commands.txt');
    fs.writeFileSync(file, 'A | any | user | +a\n');

    let changes = 0;
    const stop = watchCommandFile(file, () => { changes++; }, 50);

    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(changes).toBe(0);

      fs.writeFileSync(file, 'A | any | user | +a\nB | any | user | +b\n');
      await waitFor(() => changes >= 1);

      // Editors may save by writing a new file and renaming it over the old one
      fs.writeFileSync(file + '.tmp', 'C | any | user | +c\n');
      fs.renameSync(file + '.tmp', file);
      await waitFor(() => changes >= 2);

      // Removing the file is a change as well
      fs.unlinkSync(file);
      await waitFor(() => changes >= 3);
    } finally {
      stop();
    }

    // Nothing is reported after stopping
    const before = changes;
    fs.writeFileSync(file, 'D | any | user | +d\n');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(changes).toBe(before);
  });
});

describe('file commands in the menus', () => {
  const HUB_A = 'adcs://hub-a.example.com:1511';

  const createContext = (content: string) => {
    const sent: { sessionId: number, text: string, thirdPerson: boolean }[] = [];
    const { logger } = createLogger();
    const { commands } = parseCommandFile(content);

    const context: Context = {
      api: {
        getHub: async (id: number) => ({ id, hub_url: id === 1 ? HUB_A : 'adc://other.example.com:411' }),
        getHubUser: async (_: number, id: number) => ({ id, nick: 'alice' }),
        getHubMessages: async () => [],
        sendChatMessage: async (sessionId: number, text: string, thirdPerson: boolean) => {
          sent.push({ sessionId, text, thirdPerson });
        },
        postEvent: async () => undefined,
      } as any,
      logger,
      getCommands: () => commands,
    };

    return { context, sent };
  };

  const CONTENT = [
    'Slap | hub-a.example.com | user | /me slaps {nick}',
    'Help | any | hub | +help',
    'Both | hub-a.example.com:1511, other.example.com | both | +both',
  ].join('\n');

  test('commands are shown in the right menus and hubs', async () => {
    const { context } = createContext(CONTENT);

    const userItems = getUserMenuItems(context);
    expect(userItems.map(i => i.title)).toEqual([ 'Slap', 'Both' ]);
    expect(await (userItems[0].filter as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: [] })).toBe(true);
    expect(await (userItems[0].filter as any)({ selectedIds: [ 11 ], entityId: 2, permissions: [], supports: [] })).toBe(false);

    const hubItems = getHubMenuItems(context);
    expect(hubItems.map(i => i.title)).toEqual([ 'Help', 'Both' ]);
  });

  test('third person commands are sent as third person messages', async () => {
    const { context, sent } = createContext(CONTENT);
    const slap = getUserMenuItems(context)[0];

    await (slap.onClick as any)({ selectedIds: [ 11 ], entityId: 1, permissions: [], supports: [], formValues: {} });
    expect(sent).toEqual([ { sessionId: 1, text: 'slaps alice', thirdPerson: true } ]);
  });
});
