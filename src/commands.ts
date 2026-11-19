import { ContextMenuItem } from 'airdcpp-apisocket';

import { APIType } from './api';
import { HubCommand, Logger, SeverityEnum } from './types';


// Menu type used by the user list and the user dropdowns inside a hub session
// (entity ID = hub session ID, selected IDs = hub user IDs)
export const HUB_USER_MENU_TYPE = 'hub_user';

// Menu type of the hub session header (selected IDs = hub sessions, no entity ID)
export const HUB_MENU_TYPE = 'hub';
export const HUB_MENU_MIN_FEATURE_LEVEL = 9;

// Avoid flooding the hub when many users are selected
export const MAX_USERS_PER_CLICK = 10;

const NICK_VARIABLE = '{nick}';

// Variables available in the command texts:
//   {nick}              nick of the selected user (user menus only)
//   {input}             text that is asked from the user when the command is selected
//   {input:Show name}   same as above but the input box is labeled with the given text
//   {input:Profile=20,30}  a selection box with the given values instead of a text box (the first one is preselected)
// Every different label gets its own input box (the same label used again reuses the same box)
const VARIABLE_REGEX = /\{nick\}|\{input(?::[^}]*)?\}/g;
const INPUT_VARIABLE_REGEX = /\{input(?::([^}]*))?\}/g;

export const DEFAULT_INPUT_LABEL = 'Input';
export const INPUT_FORM_KEY_PREFIX = 'input_';

// The menu forms are not supported by all clients
const FORM_SUPPORT = 'form';

export interface InputField {
  key: string;
  label: string;
  // Values to select from (a free text box is shown when missing)
  options?: string[];
}

// Splits the contents of the variable ("Profile=20,30") to the label and the possible options
const parseVariable = (variable: string) => {
  const match = /^\{input(?::([^}]*))?\}$/.exec(variable);
  const content = (match && match[1]) || '';
  const separator = content.indexOf('=');

  const label = (separator === -1 ? content : content.slice(0, separator)).trim() || DEFAULT_INPUT_LABEL;
  const options = separator === -1 ? [] : content
    .slice(separator + 1)
    .split(',')
    .map(option => option.trim())
    .filter((option, index, all) => !!option && all.indexOf(option) === index);

  return { label, options };
};

const getVariableLabel = (variable: string) => parseVariable(variable).label;

// Distinct input labels in the order they first appear in the text (labels are not case sensitive).
// The options are taken from the first variable of the label that has them.
export const getInputFields = (command: HubCommand): InputField[] => {
  const fields: InputField[] = [];

  for (const match of command.text.matchAll(INPUT_VARIABLE_REGEX)) {
    const { label, options } = parseVariable(match[0]);
    const existing = fields.find(field => field.label.toLowerCase() === label.toLowerCase());
    if (!existing) {
      fields.push({ key: `${INPUT_FORM_KEY_PREFIX}${fields.length + 1}`, label, ...(options.length ? { options } : {}) });
    } else if (!existing.options && options.length) {
      existing.options = options;
    }
  }

  return fields;
};

export const hasInputVariable = (command: HubCommand) => getInputFields(command).length > 0;

// Variables are replaced in a single pass so that the replacement values can't be treated as variables
// The inputs are given by the lower case label
export const renderText = (text: string, values: { nick?: string, inputs?: { [label: string]: string } }) => {
  return text.replace(VARIABLE_REGEX, match => {
    const value = match === NICK_VARIABLE
      ? values.nick
      : values.inputs?.[getVariableLabel(match).toLowerCase()];

    return value !== undefined ? value : match;
  });
};

type FormValues = { [key: string]: unknown };

export interface Context {
  api: APIType;
  logger: Logger;
  getCommands: () => HubCommand[];
}


// Hub URLs may differ by letter case, trailing slashes or a keyprint query
export const normalizeHubUrl = (url: string | null | undefined) => {
  return (url || '')
    .trim()
    .toLowerCase()
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');
};

// Normalized addresses of the hubs where the command is available (empty = all hubs)
export const getCommandHubs = (command: HubCommand) => {
  return [ command.hub_url || '', ...(command.more_hubs || '').split(/[,\s]+/) ]
    .map(normalizeHubUrl)
    .filter(url => !!url);
};

interface HubAddress {
  scheme?: string;
  host: string;
  port?: string;
}

// Splits an address such as adcs://hub.example.com:1511 into its parts (scheme and port are optional)
export const parseHubAddress = (url: string): HubAddress | undefined => {
  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\[[^\]]+\]|[^:/]+)(?::(\d+))?(?:\/.*)?$/.exec(normalizeHubUrl(url));
  if (!match) {
    return undefined;
  }

  return {
    scheme: match[1],
    host: match[2],
    port: match[3],
  };
};

// The configured address may be given without the scheme and/or the port (e.g. hub.example.com),
// anything that is specified must match with the hub
export const addressMatchesHub = (configured: string, hubUrl: string) => {
  const wanted = parseHubAddress(configured);
  const actual = parseHubAddress(hubUrl);
  if (!wanted || !actual) {
    return normalizeHubUrl(configured) === normalizeHubUrl(hubUrl);
  }

  return wanted.host === actual.host &&
    (!wanted.scheme || wanted.scheme === actual.scheme) &&
    (!wanted.port || wanted.port === actual.port);
};

export const commandMatchesHub = (command: HubCommand, hubUrl: string) => {
  const commandHubs = getCommandHubs(command);
  return commandHubs.length === 0 || commandHubs.some(address => addressMatchesHub(address, hubUrl));
};

// Hub URL lookups are done for each command separately when the menu is opened, so cache them briefly
const HUB_URL_CACHE_MS = 5000;

export const createHubUrlGetter = (api: APIType) => {
  const cache = new Map<number, { url: Promise<string>, time: number }>();

  return (sessionId: number) => {
    const cached = cache.get(sessionId);
    if (cached && Date.now() - cached.time < HUB_URL_CACHE_MS) {
      return cached.url;
    }

    const url = api.getHub(sessionId).then(hub => hub.hub_url);
    url.catch(() => cache.delete(sessionId));
    cache.set(sessionId, { url, time: Date.now() });
    return url;
  };
};

// Number of recent hub messages searched when the user is no longer in the hub's user list
export const HISTORY_LOOKUP_MESSAGES = 500;

const resolveNick = async (context: Context, sessionId: number, userId: number) => {
  try {
    return (await context.api.getHubUser(sessionId, userId)).nick;
  } catch (e) {
    // The user is not online in the hub anymore (e.g. a nick clicked from older chat messages)
    context.logger.verbose(`User ${userId} not found in the user list of hub ${sessionId} (${e.message}), checking the chat history`);
  }

  const messages = await context.api.getHubMessages(sessionId, HISTORY_LOOKUP_MESSAGES);
  for (let i = messages.length - 1; i >= 0; i--) {
    const from = messages[i].chat_message?.from;
    if (from && from.id === userId && from.nick) {
      return from.nick;
    }
  }

  throw new Error(`The nick of user ${userId} could not be found (the user has left the hub and has no recent chat messages)`);
};

const getMessages = async (context: Context, command: HubCommand, sessionId: number, userIds: number[], inputs?: { [label: string]: string }) => {
  if (!command.text.includes(NICK_VARIABLE)) {
    return [ renderText(command.text, { inputs }) ];
  }

  const nicks = await Promise.all(userIds.slice(0, MAX_USERS_PER_CLICK).map(id => resolveNick(context, sessionId, id)));
  return nicks.map(nick => renderText(command.text, { nick, inputs }));
};

const sendCommand = async (context: Context, command: HubCommand, sessionId: number, userIds: number[], formValues?: FormValues) => {
  const { api, logger } = context;

  try {
    let inputs: { [label: string]: string } | undefined;
    const fields = getInputFields(command);
    if (fields.length > 0) {
      inputs = {};
      for (const field of fields) {
        const value = formValues ? formValues[field.key] : undefined;
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text) {
          await api.postEvent(`Hub commands: nothing was entered for "${field.label}" in "${command.name}", the command was not sent`, SeverityEnum.WARNING);
          return;
        }

        if (field.options && !field.options.includes(text)) {
          await api.postEvent(`Hub commands: "${text}" is not one of the values of "${field.label}" in "${command.name}", the command was not sent`, SeverityEnum.WARNING);
          return;
        }

        inputs[field.label.toLowerCase()] = text;
      }
    }

    if (command.text.includes(NICK_VARIABLE) && userIds.length > MAX_USERS_PER_CLICK) {
      await api.postEvent(
        `Hub commands: only the first ${MAX_USERS_PER_CLICK} selected users were used for "${command.name}"`,
        SeverityEnum.NOTIFY
      );
    }

    const messages = await getMessages(context, command, sessionId, userIds, inputs);

    // Send one at a time to keep the order and to avoid hub flood protections
    for (const text of messages) {
      await api.sendChatMessage(sessionId, text, !!command.third_person);
    }
  } catch (e) {
    logger.error(`Failed to send command "${command.name}": ${e.message}`);
    try {
      await api.postEvent(`Failed to send command "${command.name}": ${e.message}`, SeverityEnum.ERROR);
    } catch (_) {
      // Missing permission for events, the error has been logged already
    }
  }
};

const hasNickVariable = (command: HubCommand) => command.text.includes(NICK_VARIABLE);

const getValidCommands = (context: Context) => {
  return context.getCommands().filter(command => !!command.name && !!command.text);
};

const getItemBase = (context: Context, command: HubCommand, index: number) => ({
  // Names are not required to be unique so the index is used for the ID
  id: `hub_command_${index}`,
  title: command.name,
  icon: {
    semantic: command.icon || 'terminal',
  },
  access: 'hubs_send',

  // Ask for the values of the {input} variables, one box for each different label
  ...(hasInputVariable(command) ? {
    formDefinitions: getInputFields(command).map(field => ({
      key: field.key,
      title: field.label,
      type: 'string',
      // The default value must be one of the options
      default_value: field.options ? field.options[0] : '',
      ...(field.options ? { options: field.options.map(option => ({ id: option, name: option })) } : {}),
    })),
  } : {}),
});

// Commands asking for input can't be used when the client doesn't support menu forms
const isSupported = (command: HubCommand, supports: string[]) => {
  return !hasInputVariable(command) || supports.includes(FORM_SUPPORT);
};

// All hubs must match when the command is limited to a specific hub
const matchesAllHubs = async (
  context: Context,
  getHubUrl: (sessionId: number) => Promise<string>,
  command: HubCommand,
  sessionIds: number[]
) => {
  if (getCommandHubs(command).length === 0) {
    return true;
  }

  try {
    const urls = await Promise.all(sessionIds.map(getHubUrl));
    return urls.every(url => commandMatchesHub(command, url));
  } catch (e) {
    context.logger.error(`Failed to get the hub for session ${sessionIds.join(', ')}: ${e.message}`);
    return false;
  }
};

// Menu of the hub user list, user dropdowns and nicks in chat (entity ID = hub session, selected IDs = hub users)
export const getUserMenuItems = (context: Context): ContextMenuItem<number, number>[] => {
  const getHubUrl = createHubUrlGetter(context.api);

  return getValidCommands(context)
    .filter(command => command.placement !== 'hub')
    .map((command, index) => ({
      ...getItemBase(context, command, index),
      filter: async ({ entityId, supports }) => {
        return isSupported(command, supports) && await matchesAllHubs(context, getHubUrl, command, [ entityId ]);
      },
      onClick: ({ selectedIds, entityId, formValues }) => {
        // The helper doesn't wait for the handler, sendCommand takes care of its own errors
        return sendCommand(context, command, entityId, selectedIds, formValues as FormValues) as unknown as void;
      },
    }));
};

// Menu of the hub session header (Reconnect, Close chat...), selected IDs = hub sessions, no entity ID.
// Commands using {nick} can't be used here as there is no user.
export const getHubMenuItems = (context: Context): ContextMenuItem<number, undefined>[] => {
  const getHubUrl = createHubUrlGetter(context.api);

  return getValidCommands(context)
    .filter(command => command.placement !== 'user' && !hasNickVariable(command))
    .map((command, index) => ({ command, index }))
    .map(({ command, index }) => ({
      ...getItemBase(context, command, index),
      filter: async ({ selectedIds, supports }) => {
        return isSupported(command, supports) && await matchesAllHubs(context, getHubUrl, command, selectedIds);
      },
      onClick: ({ selectedIds, formValues }) => {
        const sendAll = async () => {
          for (const sessionId of selectedIds) {
            await sendCommand(context, command, sessionId, [], formValues as FormValues);
          }
        };

        return sendAll() as unknown as void;
      },
    }));
};
