import {
  haveSameCommands, mergeFileCommands, serializeCommand, serializeCommands, unionCommands, updateFileContent,
} from '../command-sync';
import { parseCommandFile } from '../command-file';
import { HubCommand } from '../types';


describe('serializing', () => {
  test('commands become lines that parse back to the same command', () => {
    const commands: HubCommand[] = [
      { name: 'Slap', text: '+slap {nick}', placement: 'user', hub_url: 'adcs://a.example.com:1511', more_hubs: 'b.example.com' },
      { name: 'Me', text: 'waves', placement: 'both', third_person: true },
      { name: 'TV', text: '+tv {input:Show} | now', placement: 'hub', hub_url: null, more_hubs: null },
    ];

    const lines = serializeCommands(commands);
    expect(lines).toEqual([
      'Slap | adcs://a.example.com:1511, b.example.com | user | +slap {nick}',
      'Me | any | both | /me waves',
      'TV | any | hub | +tv {input:Show} | now',
    ]);

    const parsed = parseCommandFile(lines.join('\n'));
    expect(parsed.errors).toEqual([]);
    expect(serializeCommands(parsed.commands)).toEqual(lines);
    expect(parsed.commands[1].third_person).toBe(true);
  });

  test('commands that are not usable get no line, odd names are cleaned', () => {
    expect(serializeCommand({ name: '', text: '+a' })).toBeUndefined();
    expect(serializeCommand({ name: 'A', text: '  ' })).toBeUndefined();
    expect(serializeCommand({ name: 'A | B', text: '+a', placement: 'user' })).toBe('A/B | any | user | +a');
    expect(serializeCommand({ name: 'A', text: '+a' })).toBe('A | any | both | +a');
  });

  test('lists are compared without the order', () => {
    expect(haveSameCommands([ 'a', 'b' ], [ 'b', 'a' ])).toBe(true);
    expect(haveSameCommands([ 'a', 'a' ], [ 'a', 'b' ])).toBe(false);
    expect(haveSameCommands([ 'a' ], [ 'a', 'a' ])).toBe(false);
  });
});

describe('merging', () => {
  const existing: HubCommand[] = [
    { name: 'Slap', text: '+slap {nick}', placement: 'user', hub_url: 'a.example.com', more_hubs: null, icon: 'bomb' },
    { name: 'Help', text: '+help', placement: 'both', hub_url: null, more_hubs: null, icon: null },
  ];

  test('unchanged commands keep their original fields, edited ones keep the icon', () => {
    const { commands } = parseCommandFile([
      'Slap | a.example.com | user | +slap {nick}',
      'Help | any | both | +help me',
      'New | any | user | +new',
    ].join('\n'));

    const merged = mergeFileCommands(commands, existing);
    expect(merged[0]).toBe(existing[0]);
    expect(merged[1]).toMatchObject({ name: 'Help', text: '+help me', icon: null });
    expect(merged[2]).toMatchObject({ name: 'New', text: '+new' });

    const edited = mergeFileCommands(parseCommandFile('Slap | any | user | +slap hard {nick}').commands, existing);
    expect(edited[0]).toMatchObject({ text: '+slap hard {nick}', icon: 'bomb', hub_url: null });
  });

  test('union keeps all existing commands and adds the missing ones', () => {
    const { commands } = parseCommandFile([ 'Help | any | both | +help', 'Other | any | user | +other' ].join('\n'));
    const union = unionCommands(existing, commands);
    expect(union.map(c => c.name)).toEqual([ 'Slap', 'Help', 'Other' ]);
    expect(union[0]).toBe(existing[0]);
  });
});

describe('updating the file', () => {
  const CONTENT = [
    '# header',
    '',
    '# about slap',
    'Slap|a.example.com|user|+slap {nick}',
    'Old | any | user | +old',
    '# trailing comment',
    '',
  ].join('\n');

  test('removed commands lose their line, new ones are added, everything else stays', () => {
    const result = updateFileContent(CONTENT, [
      'Slap | a.example.com | user | +slap {nick}',
      'New | any | hub | +new',
    ]);

    expect(result).toBe([
      '# header',
      '',
      '# about slap',
      'Slap|a.example.com|user|+slap {nick}',
      '# trailing comment',
      'New | any | hub | +new',
    ].join('\n') + '\n');
  });

  test('works with empty content and keeps repeated commands', () => {
    expect(updateFileContent('', [ 'A | any | user | +a', 'A | any | user | +a' ])).toBe('A | any | user | +a\nA | any | user | +a\n');
    expect(updateFileContent('A | any | user | +a\r\nA | any | user | +a\r\n', [ 'A | any | user | +a' ])).toBe('A | any | user | +a\n');
  });
});
