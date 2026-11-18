import * as fs from 'fs';
import * as path from 'path';

import { HubCommand, Logger } from './types';


// Plain text file for adding commands without the settings dialog
export const COMMAND_FILE_NAME = 'commands.txt';

// How often the file is checked for changes
export const COMMAND_FILE_WATCH_INTERVAL_MS = 2000;

const PLACEMENTS = [ 'user', 'hub', 'both' ];
const ANY_HUB_VALUES = [ '', 'any', 'all', '*' ];
const THIRD_PERSON_PREFIX = /^\/me(?:\s+|$)/i;

export const DEFAULT_COMMAND_FILE = `# Hub commands
#
# Add one command per line in this format:
#
#   name | hub | show in | message
#
#   name      Text shown in the menu
#   hub       Address of the hub where the command is shown: myhub.com or adcs://myhub.com:1511
#             (the protocol and port are optional). Several hubs can be separated with commas.
#             Use "any" to show the command in all hubs.
#   show in   user = user list, user dropdown and nicks in chat
#             hub  = the menu at the top of the hub (Reconnect, Close...)
#             both = both of the above
#   message   Sent to the hub chat as it is. Variables:
#               {nick}             nick of the selected user (user menus only)
#               {input}            asks for text when the command is selected
#               {input:Show name}  same as above but the input box gets the given label
#                                  Several different labels give several boxes, e.g.
#                                  +reg {nick} {input:Username} {input:Profile}
#             Start the message with /me to send it as a third person message.
#
# Empty lines and lines starting with # are ignored.
# Changes are applied automatically a couple of seconds after the file has been saved.
# These commands are shown in addition to the commands added in the extension settings.
#
# Examples (remove the # to use them):
#
# Slap | myhub.com | user | +slap {nick}
# TV   | any       | both | +tv {input:Show name}
`;

export interface ParsedCommandFile {
  commands: HubCommand[];
  // Problems found from the file, the lines with errors are skipped
  errors: string[];
}

// Parses the contents of the command file. The message is the last column so it may contain | characters
export const parseCommandFile = (content: string): ParsedCommandFile => {
  const commands: HubCommand[] = [];
  const errors: string[] = [];

  // Remove the possible BOM added by some editors
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }

    const lineError = (message: string) => errors.push(`${COMMAND_FILE_NAME} line ${index + 1}: ${message}`);

    const columns = line.split('|');
    if (columns.length < 4) {
      lineError('expected the format "name | hub | show in | message"');
      return;
    }

    const name = columns[0].trim();
    const hubs = columns[1].trim();
    const placement = columns[2].trim().toLowerCase();
    let text = columns.slice(3).join('|').trim();

    if (!name) {
      lineError('the name is empty');
      return;
    }

    if (!PLACEMENTS.includes(placement)) {
      lineError(`"show in" must be user, hub or both (found "${columns[2].trim()}")`);
      return;
    }

    let thirdPerson = false;
    if (THIRD_PERSON_PREFIX.test(text)) {
      thirdPerson = true;
      text = text.replace(THIRD_PERSON_PREFIX, '').trim();
    }

    if (!text) {
      lineError('the message is empty');
      return;
    }

    commands.push({
      name,
      placement: placement as HubCommand['placement'],
      text,
      hub_url: null,
      more_hubs: ANY_HUB_VALUES.includes(hubs.toLowerCase()) ? null : hubs,
      third_person: thirdPerson,
      icon: null,
    });
  });

  return { commands, errors };
};

// Reads the commands from the file (a missing file contains no commands)
export const readCommandFile = (filePath: string, logger: Logger): ParsedCommandFile => {
  try {
    return parseCommandFile(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      logger.error(`Failed to read ${filePath}: ${e.message}`);
      return { commands: [], errors: [ `${COMMAND_FILE_NAME} couldn't be read: ${e.message}` ] };
    }

    return { commands: [], errors: [] };
  }
};

// Creates the file with instructions if it doesn't exist yet
export const createCommandFileIfMissing = (filePath: string, logger: Logger) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // 'wx' fails if the file exists already
    fs.writeFileSync(filePath, DEFAULT_COMMAND_FILE, { flag: 'wx' });
    logger.verbose(`Created ${filePath}`);
  } catch (e) {
    if (e.code !== 'EEXIST') {
      logger.warn(`Failed to create ${filePath}: ${e.message}`);
    }
  }
};

// Calls the handler when the file is created, changed or removed. Returns a function that stops watching.
// Polling is used because it works with editors that replace the file when saving
export const watchCommandFile = (filePath: string, onChanged: () => void, intervalMs = COMMAND_FILE_WATCH_INTERVAL_MS) => {
  // The baseline is read right away: the first poll of watchFile runs asynchronously and a change made before it
  // would otherwise be taken as the starting state
  let lastMtimeMs = -1;
  let lastSize = -1;
  try {
    const stats = fs.statSync(filePath);
    lastMtimeMs = stats.mtimeMs;
    lastSize = stats.size;
  } catch (_) {
    // Missing file
  }

  const listener = (current: fs.Stats) => {
    const mtimeMs = current.mtimeMs;
    const size = current.size;
    if (mtimeMs !== lastMtimeMs || size !== lastSize) {
      lastMtimeMs = mtimeMs;
      lastSize = size;
      onChanged();
    }
  };

  fs.watchFile(filePath, { interval: intervalMs, persistent: false }, listener);
  return () => fs.unwatchFile(filePath, listener);
};
