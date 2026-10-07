import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SORT_OPTIONS = [
    {id: 'my-order', label: 'My order'},
    {id: 'date', label: 'Date'},
    {id: 'deadline', label: 'Deadline'},
    {id: 'starred-recently', label: 'Starred recently'},
    {id: 'title', label: 'Title'},
];

const TIMEFRAME_OPTIONS = [
    {id: 'all', label: 'All tasks'},
    {id: 'today', label: 'Today'},
    {id: 'this-week', label: 'This week'},
    {id: 'this-month', label: 'This month'},
];

export default class GoogleTasksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Google Tasks',
            icon_name: 'view-list-symbolic',
        });

        const account = new Adw.PreferencesGroup({
            title: 'Account',
            description: 'Uses the Google account in Settings → Online Accounts. Signing in to Chrome is not enough.',
        });
        const accountRow = new Adw.ActionRow({
            title: 'Online Accounts',
            subtitle: 'Add the same Google account you use on your phone',
        });
        const openButton = new Gtk.Button({
            label: 'Open',
            valign: Gtk.Align.CENTER,
        });
        openButton.connect('clicked', () => {
            Gio.Subprocess.new(
                ['gnome-control-center', 'online-accounts'],
                Gio.SubprocessFlags.NONE,
            );
        });
        accountRow.add_suffix(openButton);
        accountRow.activatable_widget = openButton;
        account.add(accountRow);

        const general = new Adw.PreferencesGroup({title: 'Tasks'});
        const refreshRow = new Adw.SpinRow({
            title: 'Refresh interval',
            subtitle: 'Seconds between syncs while the calendar menu is open',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 3600,
                step_increment: 5,
                page_increment: 30,
            }),
            digits: 0,
        });
        settings.bind('refresh-interval', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const sortRow = comboRow('Sort by', SORT_OPTIONS, settings, 'task-sort-order');
        const timeframeRow = comboRow('Timeframe', TIMEFRAME_OPTIONS, settings, 'task-timeframe');
        timeframeRow.subtitle = 'Show tasks due in this range';

        const completedRow = new Adw.SwitchRow({
            title: 'Show completed tasks',
            subtitle: 'Collapsible list under the open tasks',
        });
        settings.bind('show-completed-tasks', completedRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        general.add(refreshRow);
        general.add(sortRow);
        general.add(timeframeRow);
        general.add(completedRow);

        page.add(account);
        page.add(general);
        window.add(page);
    }
}

function comboRow(title, options, settings, key) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(options.map(option => option.label)),
    });
    const current = settings.get_string(key);
    row.selected = Math.max(0, options.findIndex(option => option.id === current));
    row.connect('notify::selected', () => {
        const option = options[row.selected];
        if (option)
            settings.set_string(key, option.id);
    });
    return row;
}
