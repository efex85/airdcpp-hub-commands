export const CONFIG_VERSION = 4;

// Version 4 started to keep the commands in sync with commands.txt (no changes to the saved data).
// Version 2 added the optional 'more_hubs' field, version 3 added the 'placement' field
// (commands saved earlier were shown in both menus)
export const migrateSettings = (loadedVersion: number, loadedData: any) => {
  if (loadedVersion < 3 && Array.isArray(loadedData.commands)) {
    return {
      ...loadedData,
      commands: loadedData.commands.map((command: object) => ({
        more_hubs: null,
        placement: 'both',
        ...command,
      })),
    };
  }

  return loadedData;
};

// Nested lists/structs are not supported by the settings API, so the per-hub configuration is a flat list:
// every command carries the hub it belongs to.
// The help texts are shown only once (at the list level) to keep the rows of the form short.
export const SettingDefinitions = [
  {
    key: 'commands',
    title: 'Commands',
    type: 'list',
    item_type: 'struct',
    help: [
      'Commands are shown in the "Hub commands" section of the menus and they are sent to the hub chat as normal messages.',
      '"Show in" selects the menu: the user menus (user list, user dropdown and nicks in chat) or the hub menu (Reconnect/Close menu at the top of the hub).',
      'Use {nick} in the message to insert the nick of the selected user (user menus only, one message is sent for each selected user).',
      'Use {input} in the message to get an input box when the command is selected (e.g. "+tv {input}"). The box can be labeled with {input:Show name}, and each different label gives its own box (e.g. "+reg {input:Username} {input:Profile}"). Use {input:Profile=20,30} to select the value from a list instead (the first value is preselected). Boxes are required by default, add ? after the label to allow leaving it empty (e.g. {input:Comment?}).',
      'The commands are kept in sync with the commands.txt file in the settings folder of the extension (see the instructions inside the file): commands added, changed or removed here are updated to the file and the other way around. Reopen this dialog to see changes made to the file.',
      'Hub: leave empty to show the command in all hubs. The address can be given as adcs://myhub.com:1511 or just as myhub.com (protocol and port are matched only if specified). Other hubs can be listed in "Additional hubs" separated by commas.',
    ].join(' '),
    definitions: [
      {
        key: 'name',
        title: 'Name',
        type: 'string',
        default_value: '',
      }, {
        key: 'placement',
        title: 'Show in',
        type: 'string',
        default_value: 'user',
        options: [
          { id: 'user', name: 'User menus (user list, dropdown, chat nicks)' },
          { id: 'hub', name: 'Hub menu (top of the hub)' },
          { id: 'both', name: 'Both' },
        ],
      }, {
        key: 'text',
        title: 'Message to send',
        type: 'string',
        default_value: '',
      }, {
        key: 'hub_url',
        title: 'Hub',
        type: 'string',
        optional: true,
      }, {
        key: 'more_hubs',
        title: 'Additional hubs',
        type: 'string',
        optional: true,
      }, {
        key: 'third_person',
        title: 'Send as third person (/me)',
        type: 'boolean',
        default_value: false,
      }, {
        key: 'icon',
        title: 'Icon (semantic-ui.com/elements/icon.html)',
        type: 'string',
        optional: true,
      },
    ],
    default_value: [],
  }
];
