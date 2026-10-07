# Google Tasks for Ubuntu 24.04

A calendar-menu widget for GNOME 46, adapted from [ZTL-UwU/gnome-shell-google-tasks](https://github.com/ZTL-UwU/gnome-shell-google-tasks) (MIT). That extension only supports GNOME 49 and 50. This one targets the GNOME 46 shell shipped with Ubuntu 24.04.

It talks to the Google Tasks API with the token from **Settings → Online Accounts**. Signing in to Chrome does not share that token with the desktop. Online Accounts on Ubuntu 24.04 already requests the Google Tasks scope.

Not affiliated with Google.

## Install

```sh
make install
```

Log out and back in once. GNOME reads new extensions at login, and on Wayland the shell cannot be restarted in place.

Then open the clock menu. If no Google account is connected, use **Online Accounts** in the widget and add the same account you use on your phone.

`gir1.2-goa-1.0` is required. It is already installed on a normal Ubuntu desktop.

## Use

- Switch lists from the dropdown
- Check a task to complete it, or check it again under Completed
- Hover a task to edit it or add a subtask
- Extension settings cover refresh, sort, due-date range, and completed tasks
