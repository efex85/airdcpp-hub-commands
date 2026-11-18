'use strict';

// Entry point for extension-specific code
import { APISocket, addContextMenuItems } from 'airdcpp-apisocket';

// Settings manager docs: https://github.com/airdcpp-web/airdcpp-extension-settings-js
//@ts-ignore
import SettingsManager from 'airdcpp-extension-settings';
import { ExtensionEntryData } from 'airdcpp-extension';

import { CONFIG_VERSION, migrateSettings, SettingDefinitions } from './settings';
import { API } from './api';
import * as path from 'path';

import { COMMAND_FILE_NAME, createCommandFileIfMissing, readCommandFile, watchCommandFile } from './command-file';
import { HubCommand, SeverityEnum } from './types';
import { Context, getHubMenuItems, getUserMenuItems, HUB_MENU_TYPE, HUB_MENU_MIN_FEATURE_LEVEL, HUB_USER_MENU_TYPE } from './commands';


const MENU_INFO = {
  id: '',
  name: 'Hub commands',
  icon: {
    semantic: 'terminal',
  },
};

// Returns a function that removes all added menu items
const addMenuItems = async (context: Context, socket: APISocket, extension: ExtensionEntryData, featureLevel: number) => {
  const menu = { ...MENU_INFO, id: extension.name };

  const removers = [
    // User list, user dropdowns and nicks in chat
    await addContextMenuItems(socket, getUserMenuItems(context), HUB_USER_MENU_TYPE, menu),
  ];

  // Menu of the hub session header (Reconnect, Close chat...)
  if (featureLevel >= HUB_MENU_MIN_FEATURE_LEVEL) {
    removers.push(await addContextMenuItems(socket, getHubMenuItems(context), HUB_MENU_TYPE, menu));
  } else {
    socket.logger.warn(`The hub session menu requires API feature level ${HUB_MENU_MIN_FEATURE_LEVEL} (current: ${featureLevel}), it won't be available`);
  }

  return async () => {
    for (const remove of removers) {
      await remove();
    }
  };
};

const Extension = function (socket: APISocket, extension: ExtensionEntryData) {
  const settings = SettingsManager(socket, {
    extensionName: extension.name,
    configFile: extension.configPath + 'config.json',
    configVersion: CONFIG_VERSION,
    definitions: SettingDefinitions,
  });

  let removeListeners: (() => Promise<void>) | undefined;
  let stopWatchingFile: (() => void) | undefined;

  // Commands from the text file (the settings dialog commands are handled by the settings manager)
  let fileCommands: HubCommand[] = [];
  const commandFilePath = path.join(extension.configPath, COMMAND_FILE_NAME);

  extension.onStart = async (sessionInfo: { system_info: { api_feature_level: number } }) => {
    const featureLevel = sessionInfo.system_info.api_feature_level;
    await settings.load(migrateSettings);

    const context: Context = {
      api: API(socket),
      logger: socket.logger,
      getCommands: () => [ ...(settings.getValue('commands') || []), ...fileCommands ],
    };

    // Replaces the menu items with the current configuration. Reloads are run one at a time.
    let reloadQueue: Promise<void> = Promise.resolve();
    const reloadMenuItems = () => {
      reloadQueue = reloadQueue.then(async () => {
        try {
          await removeListeners?.();
          removeListeners = undefined;
          removeListeners = await addMenuItems(context, socket, extension, featureLevel);
        } catch (e) {
          socket.logger.error(`Failed to update menu items: ${e.message}`);
        }
      });

      return reloadQueue;
    };

    const loadFileCommands = async () => {
      const { commands, errors } = readCommandFile(commandFilePath, socket.logger);
      fileCommands = commands;
      socket.logger.verbose(`Loaded ${commands.length} command(s) from ${commandFilePath}`);

      for (const error of errors) {
        socket.logger.warn(error);
      }

      if (errors.length) {
        try {
          await context.api.postEvent(`Hub commands: ${errors.join('; ')}`, SeverityEnum.WARNING);
        } catch (_) {
          // Missing permission for events, the problems have been logged already
        }
      }
    };

    createCommandFileIfMissing(commandFilePath, socket.logger);
    await loadFileCommands();

    removeListeners = await addMenuItems(context, socket, extension, featureLevel);

    settings.onValuesUpdated = reloadMenuItems;

    stopWatchingFile = watchCommandFile(commandFilePath, async () => {
      await loadFileCommands();
      await reloadMenuItems();
    });
  };

  extension.onStop = async () => {
    stopWatchingFile?.();

    try {
      await removeListeners?.();
    } catch (e) {
      socket.logger.error(`Failed to remove menu items: ${e.message}`);
    }
  };
};

export default Extension;
