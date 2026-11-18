Add custom commands to airdc-web-client:

Quick install:  AirDC web client > Settings > Extensions > Extension catalog > Install from url >https://github.com/efex85/airdcpp-hub-commands/raw/refs/heads/main/quickinstall/airdcpp-hub-commands-1.6.0.tgz

Add your commands. If no hub address is set its shown in all hubs. Add adcs:// if its a adc hub. Port or kp not needed.

Variables available:\
{nick} - only in user list\
{input:reason} - a text box for manual entry\
Choose as user command (user dropdown), hub command (top hub dropdown) or both.

web client daemon does not expose available hub commands so it's not possible to import whatever commands the hub has available. It's all manual work.
