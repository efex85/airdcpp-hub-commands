'use strict';

// Entry point for extension-specific code
import { APISocket, addContextMenuItems } from 'airdcpp-apisocket';

// Settings manager docs: https://github.com/airdcpp-web/airdcpp-extension-settings-js
//@ts-ignore
import SettingsManager from 'airdcpp-extension-settings';
import { ExtensionEntryData } from 'airdcpp-extension';

import { CONFIG_VERSION, migrateSettings, SettingDefinitions } from './settings';
import { API } from './api';
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

  extension.onStart = async (sessionInfo: { system_info: { api_feature_level: number } }) => {
    const featureLevel = sessionInfo.system_info.api_feature_level;
    await settings.load(migrateSettings);

    const context: Context = {
      api: API(socket),
      logger: socket.logger,
      getCommands: () => settings.getValue('commands') || [],
    };

    removeListeners = await addMenuItems(context, socket, extension, featureLevel);

    settings.onValuesUpdated = async () => {
      // Replace the menu items with the new configuration
      try {
        await removeListeners?.();
        removeListeners = await addMenuItems(context, socket, extension, featureLevel);
      } catch (e) {
        socket.logger.error(`Failed to update menu items: ${e.message}`);
      }
    };
  };

  extension.onStop = async () => {
    try {
      await removeListeners?.();
    } catch (e) {
      socket.logger.error(`Failed to remove menu items: ${e.message}`);
    }
  };
};

export default Extension;
