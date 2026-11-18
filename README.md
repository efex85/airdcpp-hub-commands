Add custom commands to airdc-web-client:

Quick install:  AirDC web client > Settings > Extensions > Extension catalog > Install from url >https://github.com/efex85/airdcpp-hub-commands/raw/refs/heads/main/quickinstall/airdcpp-hub-commands-1.3.0.tgz

Add your commands. If no hub address is set, its shown in all hubs. Add adcs:// if its a adc hub, port or kp not needed.
Only variable available is {nick} as a user list command (eg. +slap {nick} .

web client daemon does not expose available hub commands so it's not possible to import whatever commands the hub has available. It's all manual work.
