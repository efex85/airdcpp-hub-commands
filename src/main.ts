'use strict';

// Entry point for extension-specific code
import { APISocket, addContextMenuItems } from 'airdcpp-apisocket';

// Settings manager docs: https://github.com/airdcpp-web/airdcpp-extension-settings-js
//@ts-ignore
import SettingsManager from 'airdcpp-extension-settings';
import { ExtensionEntryData } from 'airdcpp-extension';

import { CONFIG_VERSION, migrateSettings, SettingDefinitions } from './settings';
import { API } from './api';
import * as fs from 'fs';
import * as path from 'path';

import { COMMAND_FILE_NAME, createCommandFileIfMissing, DEFAULT_COMMAND_FILE, readCommandFile, watchCommandFile } from './command-file';
import { haveSameCommands, mergeFileCommands, serializeCommands, unionCommands, updateFileContent } from './command-sync';
import { HubCommand, SeverityEnum } from './types';
import { Context, getHubMenuItems, getUserMenuItems, HUB_MENU_TYPE, HUB_MENU_MIN_FEATURE_LEVEL, HUB_USER_MENU_TYPE } from './commands';


// How long to wait for the settings update event from the server
const SETTINGS_UPDATE_TIMEOUT_MS = 5000;

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

  const commandFilePath = path.join(extension.configPath, COMMAND_FILE_NAME);
  const configFilePath = extension.configPath + 'config.json';

  const getModifiedTime = (filePath: string) => {
    try {
      return fs.statSync(filePath).mtimeMs;
    } catch (_) {
      return undefined;
    }
  };

  extension.onStart = async (sessionInfo: { system_info: { api_feature_level: number } }) => {
    const featureLevel = sessionInfo.system_info.api_feature_level;

    // Check which one of the files was changed last (this must be done before the settings are loaded)
    const configModified = getModifiedTime(configFilePath);
    const fileExisted = fs.existsSync(commandFilePath);
    const fileModified = getModifiedTime(commandFilePath);

    // Settings saved by older versions that had no shared list with the file
    let migrated = false;
    await settings.load((version: number, data: any) => {
      migrated = true;
      return migrateSettings(version, data);
    });

    const getSettingsCommands = (): HubCommand[] => settings.getValue('commands') || [];

    const context: Context = {
      api: API(socket),
      logger: socket.logger,
      getCommands: getSettingsCommands,
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

    const reportProblems = async (errors: string[]) => {
      for (const error of errors) {
        socket.logger.warn(error);
      }

      try {
        await context.api.postEvent(`Hub commands: ${errors.join('; ')}. The commands were not synchronized until this has been fixed.`, SeverityEnum.WARNING);
      } catch (_) {
        // Missing permission for events, the problems have been logged already
      }
    };

    // The settings manager updates its values when the update event is received from the server,
    // wait for that so that the new values can be used right away
    let commandsApplied: (() => void) | undefined;
    const setCommands = async (commands: HubCommand[]) => {
      let timer: NodeJS.Timeout | undefined;
      const applied = new Promise<void>(resolve => {
        commandsApplied = resolve;
        timer = setTimeout(resolve, SETTINGS_UPDATE_TIMEOUT_MS);
      });

      try {
        await settings.setValue('commands', commands);
        await applied;
      } finally {
        clearTimeout(timer);
        commandsApplied = undefined;
      }
    };

    // The commands are kept in both places. Changes are applied only when the lists differ, which also
    // prevents the updates from triggering each other endlessly.

    // Settings dialog -> file
    const syncSettingsToFile = async () => {
      const { commands: fileCommands, errors } = readCommandFile(commandFilePath, socket.logger);
      if (errors.length) {
        // Don't overwrite a file that is being edited
        await reportProblems(errors);
        return;
      }

      const wanted = serializeCommands(getSettingsCommands());
      if (haveSameCommands(wanted, serializeCommands(fileCommands))) {
        return;
      }

      let content = DEFAULT_COMMAND_FILE;
      try {
        content = fs.readFileSync(commandFilePath, 'utf8');
      } catch (_) {
        // The file has been removed, create it again
      }

      fs.writeFileSync(commandFilePath, updateFileContent(content, wanted));
      socket.logger.verbose(`Updated ${commandFilePath} with the commands from the settings`);
    };

    // File -> settings dialog
    const syncFileToSettings = async (merge = false) => {
      const { commands: fileCommands, errors } = readCommandFile(commandFilePath, socket.logger);
      if (errors.length) {
        // The lines with errors would be lost
        await reportProblems(errors);
        return;
      }

      const current = getSettingsCommands();
      const next = merge ? unionCommands(current, fileCommands) : mergeFileCommands(fileCommands, current);
      if (haveSameCommands(serializeCommands(next), serializeCommands(current))) {
        return;
      }

      // The menu items are reloaded when the settings update event is received
      await setCommands(next);
    };

    settings.onValuesUpdated = (updated: { [key: string]: unknown }) => {
      const reloaded = reloadMenuItems();
      if (updated && 'commands' in updated) {
        commandsApplied?.();
        return reloaded.then(syncSettingsToFile).catch((e: Error) => {
          socket.logger.error(`Failed to update ${COMMAND_FILE_NAME}: ${e.message}`);
        });
      }

      return reloaded;
    };

    createCommandFileIfMissing(commandFilePath, socket.logger);

    if (migrated) {
      // Commands from both places are kept
      await syncFileToSettings(true);
      await syncSettingsToFile();
    } else if (fileExisted && (configModified === undefined || (fileModified ?? 0) > configModified)) {
      await syncFileToSettings();
    } else {
      await syncSettingsToFile();
    }

    await reloadMenuItems();

    stopWatchingFile = watchCommandFile(commandFilePath, () => {
      syncFileToSettings().catch((e: Error) => {
        socket.logger.error(`Failed to apply the changes of ${COMMAND_FILE_NAME}: ${e.message}`);
      });
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
