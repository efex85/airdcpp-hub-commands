import { parseCommandFile } from './command-file';
import { HubCommand } from './types';


// The commands of the settings dialog and the command file are kept in sync, these helpers
// convert the commands to the lines of the file and compare the two lists.

// Converts the command to a line of the command file. Commands without a name or message can't be used and
// get no line.
export const serializeCommand = (command: HubCommand): string | undefined => {
  // The separator and line breaks can't be used in the name
  const name = (command.name || '').replace(/\s*\|\s*/g, '/').replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const message = (command.text || '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!name || !message) {
    return undefined;
  }

  const hubs = [ command.hub_url || '', ...(command.more_hubs || '').split(/[,\s]+/) ]
    .map(hub => hub.trim())
    .filter(hub => !!hub);

  const text = command.third_person ? `/me ${message}` : message;
  return `${name} | ${hubs.length ? hubs.join(', ') : 'any'} | ${command.placement || 'both'} | ${text}`;
};

export const serializeCommands = (commands: HubCommand[]) => {
  return commands.map(serializeCommand).filter((line): line is string => line !== undefined);
};

// The order of the commands doesn't matter when checking whether the lists have the same commands
export const haveSameCommands = (a: string[], b: string[]) => {
  return a.length === b.length && JSON.stringify([ ...a ].sort()) === JSON.stringify([ ...b ].sort());
};

// Commands for the settings from the file contents. The existing command objects are used for the commands that
// were not changed (so that the fields that can't be saved in the file are kept), the icon is also kept when
// only the other fields of the command were changed.
export const mergeFileCommands = (fileCommands: HubCommand[], existing: HubCommand[]): HubCommand[] => {
  const available = existing.map(command => ({ command, line: serializeCommand(command), used: false }));

  const result: (HubCommand | undefined)[] = fileCommands.map(command => {
    const line = serializeCommand(command);
    const match = available.find(item => !item.used && item.line === line);
    if (match) {
      match.used = true;
      return match.command;
    }

    return undefined;
  });

  return fileCommands.map((command, index) => {
    const unchanged = result[index];
    if (unchanged) {
      return unchanged;
    }

    const sameName = available.find(item => !item.used && item.command.name === command.name && item.command.icon);
    if (sameName) {
      sameName.used = true;
      return { ...command, icon: sameName.command.icon };
    }

    return command;
  });
};

// Commands of the settings followed by the commands of the file that are not in the settings yet
export const unionCommands = (existing: HubCommand[], fileCommands: HubCommand[]): HubCommand[] => {
  const remaining = serializeCommands(existing);
  const added = fileCommands.filter(command => {
    const line = serializeCommand(command);
    const index = line === undefined ? -1 : remaining.indexOf(line);
    if (index !== -1) {
      remaining.splice(index, 1);
      return false;
    }

    return true;
  });

  return [ ...existing, ...added ];
};

// Same command written in a different way in the file (spacing...) has the same canonical line
const getCanonicalLine = (rawLine: string) => {
  const { commands } = parseCommandFile(rawLine);
  return commands.length === 1 ? serializeCommand(commands[0]) : undefined;
};

// Updates the contents of the file to contain exactly the given commands. Comments, empty lines and the
// lines of the commands that are kept are left as they are, removed commands lose their line and new commands
// are added to the end.
export const updateFileContent = (content: string, wantedLines: string[]) => {
  const remaining = [ ...wantedLines ];
  const kept: string[] = [];

  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      kept.push(line);
      continue;
    }

    const canonical = getCanonicalLine(line);
    const index = canonical === undefined ? -1 : remaining.indexOf(canonical);
    if (index !== -1) {
      remaining.splice(index, 1);
      kept.push(line);
    }
  }

  return [ ...kept, ...remaining ].join('\n') + '\n';
};
