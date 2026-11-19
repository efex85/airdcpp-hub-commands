Add custom commands to airdc-web-client:

Quick install:  AirDC web client > Settings > Extensions > Extension catalog > Install from url >https://github.com/efex85/airdcpp-hub-commands/raw/refs/heads/main/quickinstall/airdcpp-hub-commands-1.8.0.tgz

Add your commands. If no hub address is set its shown in all hubs. Add adcs:// if its a adc hub. Port and kp are optional.

Variables available:\
{nick} - only in user list\
{input:reason} - a text box for manual entry. You can add multiple, example: +reg nick {input:Nickname} {input:Profile}\
{input:reason=value1,value2} - ceeates a dropdown with preset values, example: +reg nick {input:Nickname} {input:Profile=20,30,40}\

Choose as user command (user dropdown), hub command (top hub dropdown) or both.

web client daemon does not expose available hub commands so it's not possible to import whatever commands the hub has available. It's all manual work.

It also creates a command.txt file in the extensions settings folder if you want to manage your commands that way instead of in the web ui.
