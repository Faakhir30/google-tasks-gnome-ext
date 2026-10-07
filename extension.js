// Google Tasks in the GNOME 46 calendar menu.
// Adapted from ZTL-UwU/gnome-shell-google-tasks (MIT) for Ubuntu 24.04.
// GNOME 46 St.BoxLayout uses `vertical`, not Clutter.Orientation.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {buildTaskTree, filterTaskTree, formatDue, sortTaskTree} from './taskModel.js';
import {GoogleTasksManager} from './tasksManager.js';

const REFRESH_INTERVAL_KEY = 'refresh-interval';
const TASK_SORT_ORDER_KEY = 'task-sort-order';
const SHOW_COMPLETED_TASKS_KEY = 'show-completed-tasks';
const TASK_TIMEFRAME_KEY = 'task-timeframe';
const SELECTED_LIST_KEY = 'selected-list-id';

const SORT_ORDERS = new Set(['my-order', 'date', 'deadline', 'starred-recently', 'title']);
const TIMEFRAMES = new Set(['all', 'today', 'this-week', 'this-month']);

const TaskDialog = GObject.registerClass({
    GTypeName: 'LocalGoogleTasksDialog',
    Signals: {
        'saved': {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING]},
    },
}, class TaskDialog extends ModalDialog.ModalDialog {
    _init(heading) {
        super._init({
            styleClass: 'google-tasks-add-dialog',
            destroyOnClose: true,
        });

        this._heading = new St.Label({
            text: heading,
            style_class: 'google-tasks-dialog-title',
        });
        this.contentLayout.add_child(this._heading);

        this._titleEntry = new St.Entry({
            style_class: 'google-tasks-dialog-entry',
            hint_text: 'Task title',
            can_focus: true,
            x_expand: true,
        });
        this._notesEntry = new St.Entry({
            style_class: 'google-tasks-dialog-entry',
            hint_text: 'Description (optional)',
            can_focus: true,
            x_expand: true,
        });
        this.contentLayout.add_child(this._titleEntry);
        this.contentLayout.add_child(this._notesEntry);

        this._titleEntry.clutter_text.connect('activate', () => this._save());
        this._notesEntry.clutter_text.connect('activate', () => this._save());

        this.setButtons([
            {
                label: 'Cancel',
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: 'Save',
                default: true,
                action: () => this._save(),
            },
        ]);
        this.setInitialKeyFocus(this._titleEntry);
    }

    setValues(title, notes) {
        this._titleEntry.set_text(title || '');
        this._notesEntry.set_text(notes || '');
    }

    _save() {
        const title = this._titleEntry.get_text().trim();
        if (title.length > 0)
            this.emit('saved', title, this._notesEntry.get_text().trim());
        this.close();
    }
});

const TasksSection = GObject.registerClass({
    GTypeName: 'LocalGoogleTasksSection',
    Signals: {
        'add-task': {},
        'status-clicked': {},
    },
}, class TasksSection extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'weather-button google-tasks-section',
            vertical: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({
            style_class: 'google-tasks-header',
            x_expand: true,
        });

        this._listLabel = new St.Label({
            text: 'Tasks',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._listLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const dropdownContent = new St.BoxLayout({x_expand: true});
        dropdownContent.add_child(this._listLabel);
        dropdownContent.add_child(new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 12,
        }));

        this._listButton = new St.Button({
            style_class: 'google-tasks-dropdown-button',
            can_focus: true,
            x_expand: true,
            child: dropdownContent,
        });
        this._listMenu = new PopupMenu.PopupMenu(this._listButton, 0.0, St.Side.TOP);
        Main.uiGroup.add_child(this._listMenu.actor);
        this._listMenu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuManager.addMenu(this._listMenu);
        this._listButton.connect('clicked', () => this._listMenu.toggle());

        this._addButton = new St.Button({
            style_class: 'google-tasks-add-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'list-add-symbolic', icon_size: 16}),
        });
        this._addButton.connect('clicked', () => this.emit('add-task'));

        header.add_child(this._listButton);
        header.add_child(this._addButton);
        this.add_child(header);

        this._activeList = new St.BoxLayout({
            style_class: 'tasks-list',
            vertical: true,
            x_expand: true,
        });
        this.add_child(this._activeList);

        const completedHeader = new St.BoxLayout({x_expand: true});
        completedHeader.add_child(new St.Label({
            text: 'Completed',
            style_class: 'tasks-completed-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._completedIcon = new St.Icon({
            icon_name: 'pan-end-symbolic',
            icon_size: 12,
        });
        completedHeader.add_child(this._completedIcon);
        this._completedButton = new St.Button({
            style_class: 'tasks-completed-toggle',
            can_focus: true,
            x_expand: true,
            child: completedHeader,
            visible: false,
        });
        this._completedExpanded = false;
        this._completedButton.connect('clicked', () => {
            this._completedExpanded = !this._completedExpanded;
            this._completedList.visible = this._completedExpanded;
            this._completedIcon.icon_name = this._completedExpanded
                ? 'pan-down-symbolic'
                : 'pan-end-symbolic';
        });

        this._completedList = new St.BoxLayout({
            style_class: 'tasks-list tasks-completed-list',
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this.add_child(this._completedButton);
        this.add_child(this._completedList);

        this.connect('destroy', () => this._listMenu.destroy());
    }

    closeMenu() {
        this._listMenu.close();
    }

    setLists(taskLists, selectedId, onSelect) {
        this._listMenu.removeAll();
        this._addButton.reactive = taskLists.length > 0;
        if (taskLists.length === 0) {
            this._listLabel.set_text('Tasks');
            this._listButton.reactive = false;
            this._listMenu.close();
            return;
        }

        this._listButton.reactive = true;
        const selected = taskLists.find(list => list.id === selectedId) ?? taskLists[0];
        this._listLabel.set_text(selected.title);

        for (const list of taskLists) {
            const item = new PopupMenu.PopupMenuItem(list.title);
            if (list.id === selected.id)
                item.setOrnament(PopupMenu.Ornament.CHECK);
            item.connect('activate', () => onSelect(list.id));
            this._listMenu.addMenuItem(item);
        }
    }

    setStatus(message, buttonLabel) {
        this._clearRows();
        const label = new St.Label({
            text: message,
            style_class: 'google-tasks-status',
            x_expand: true,
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._activeList.add_child(label);

        if (buttonLabel) {
            const button = new St.Button({
                label: buttonLabel,
                style_class: 'google-tasks-status-button',
                can_focus: true,
                x_align: Clutter.ActorAlign.START,
            });
            button.connect('clicked', () => this.emit('status-clicked'));
            this._activeList.add_child(button);
        }
    }

    showTasks(active, completed, handlers) {
        this._clearRows();
        this._addRows(this._activeList, active, false, handlers);
        if (completed.length === 0)
            return;

        this._completedButton.visible = true;
        this._addRows(this._completedList, completed, true, handlers);
        this._completedList.visible = this._completedExpanded;
    }

    _clearRows() {
        this._activeList.destroy_all_children();
        this._completedList.destroy_all_children();
        this._completedButton.visible = false;
        this._completedList.visible = false;
    }

    _addRows(parent, tasks, completed, handlers, depth = 0) {
        for (const task of tasks) {
            if (task.title)
                parent.add_child(this._createRow(task, completed, handlers, depth));
            if (task.children?.length)
                this._addRows(parent, task.children, completed, handlers, depth + 1);
        }
    }

    _createRow(task, completed, handlers, depth) {
        const row = new St.BoxLayout({
            style_class: 'task-box',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (depth > 0)
            row.style = `margin-left: ${depth * 16}px;`;

        const check = new St.Icon({
            icon_name: 'object-select-symbolic',
            icon_size: 10,
        });
        check.opacity = completed ? 255 : 0;

        const radio = new St.Button({
            style_class: completed ? 'task-radio task-radio-completed' : 'task-radio',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: check,
        });
        radio.connect('notify::hover', () => {
            if (!completed)
                check.opacity = radio.hover ? 255 : 0;
        });
        radio.connect('clicked', () => {
            radio.reactive = false;
            if (completed)
                handlers.onUncomplete(task);
            else
                handlers.onComplete(task);
        });

        const text = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const title = new St.Label({
            text: task.title,
            style_class: completed ? 'task-label task-label-completed' : 'task-label',
            x_expand: true,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);

        if (task.notes) {
            const notes = new St.Label({
                text: task.notes,
                style_class: 'task-description',
                x_expand: true,
            });
            notes.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(notes);
        }

        const due = formatDue(task.due);
        if (due) {
            text.add_child(new St.Label({
                text: due,
                style_class: due === 'Today' ? 'task-due task-due-today' : 'task-due',
            }));
        }

        row.add_child(radio);
        row.add_child(text);

        const hoverButtons = [];
        if (!completed) {
            const subtask = this._iconButton('list-add-symbolic', 'task-subtask-button', () => {
                handlers.onAddSubtask(task);
            });
            hoverButtons.push(subtask);
            row.add_child(subtask);
        }
        const edit = this._iconButton('document-edit-symbolic', 'task-edit-button', () => {
            handlers.onEdit(task);
        });
        hoverButtons.push(edit);
        row.add_child(edit);
        row.connect('notify::hover', () => {
            const shown = row.hover;
            for (const button of hoverButtons) {
                button.opacity = shown ? 255 : 0;
                button.reactive = shown;
            }
        });

        return row;
    }

    _iconButton(iconName, styleClass, onClick) {
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
            reactive: false,
            child: new St.Icon({icon_name: iconName, icon_size: 12}),
        });
        button.connect('clicked', () => onClick());
        return button;
    }
});

export default class GoogleTasksExtension extends Extension {
    enable() {
        this._settings = null;
        this._section = null;
        this._manager = null;
        this._dateMenu = null;
        this._menuOpenId = 0;
        this._settingIds = [];
        this._refreshTimerId = 0;
        this._completeTimerId = 0;
        this._generation = 0;
        this._taskLists = [];
        this._activeByList = new Map();
        this._completedByList = new Map();
        this._statusAction = null;

        try {
            this._start();
        } catch (error) {
            console.error(`Google Tasks failed to start: ${error}`);
            this.disable();
            throw error;
        }
    }

    _start() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        const scroll = dateMenu?._displaysSection;
        const displaysBox = scroll?.child ?? scroll?.get_child?.();
        if (!dateMenu || !displaysBox?.add_child) {
            throw new Error('Calendar menu not found');
        }

        this._dateMenu = dateMenu;
        this._settings = this.getSettings();
        this._manager = new GoogleTasksManager();
        this._section = new TasksSection();
        displaysBox.insert_child_at_index(this._section, 0);

        this._section.connect('add-task', () => this._openDialog());
        this._section.connect('status-clicked', () => this._statusAction?.());

        this._menuOpenId = dateMenu.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                this._section?.closeMenu();
            else
                this._refresh();
        });

        for (const key of [TASK_SORT_ORDER_KEY, TASK_TIMEFRAME_KEY, SELECTED_LIST_KEY]) {
            this._settingIds.push(this._settings.connect(`changed::${key}`, () => {
                this._render();
            }));
        }
        this._settingIds.push(this._settings.connect(`changed::${SHOW_COMPLETED_TASKS_KEY}`, () => {
            this._refresh();
        }));
        this._settingIds.push(this._settings.connect(`changed::${REFRESH_INTERVAL_KEY}`, () => {
            this._restartTimer();
        }));

        this._section.setStatus('Loading tasks…');
        this._refresh();
        this._restartTimer();
        console.log('Google Tasks: enabled');
    }

    disable() {
        this._generation += 1;
        this._stopTimer(this._refreshTimerId);
        this._refreshTimerId = 0;
        this._stopTimer(this._completeTimerId);
        this._completeTimerId = 0;

        if (this._dateMenu && this._menuOpenId) {
            this._dateMenu.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }
        this._dateMenu = null;

        if (this._settings) {
            for (const id of this._settingIds)
                this._settings.disconnect(id);
            this._settings = null;
        }
        this._settingIds = [];

        this._manager?.destroy();
        this._manager = null;
        this._section?.destroy();
        this._section = null;
        this._taskLists = [];
        this._activeByList = new Map();
        this._completedByList = new Map();
        this._statusAction = null;
    }

    _restartTimer() {
        this._stopTimer(this._refreshTimerId);
        const seconds = this._settings?.get_int(REFRESH_INTERVAL_KEY) || 20;
        this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            if (this._dateMenu?.menu.isOpen)
                this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer(id) {
        if (id)
            GLib.source_remove(id);
    }

    _selectedListId() {
        const stored = this._settings?.get_string(SELECTED_LIST_KEY) || '';
        if (stored && this._taskLists.some(list => list.id === stored))
            return stored;
        return this._taskLists[0]?.id || '';
    }

    _sortOrder() {
        const value = this._settings?.get_string(TASK_SORT_ORDER_KEY);
        return SORT_ORDERS.has(value) ? value : 'my-order';
    }

    _timeframe() {
        const value = this._settings?.get_string(TASK_TIMEFRAME_KEY);
        return TIMEFRAMES.has(value) ? value : 'all';
    }

    _showCompleted() {
        return this._settings ? this._settings.get_boolean(SHOW_COMPLETED_TASKS_KEY) : true;
    }

    _render() {
        if (!this._section)
            return;

        const selectedId = this._selectedListId();
        this._section.setLists(this._taskLists, selectedId, id => {
            this._settings?.set_string(SELECTED_LIST_KEY, id);
        });

        if (this._taskLists.length === 0) {
            this._statusAction = () => this._openOnlineAccounts();
            this._section.setStatus(
                'No task lists yet. Add a list in Google Tasks, or connect a Google account in Online Accounts.',
                'Online Accounts',
            );
            return;
        }

        const order = this._sortOrder();
        const timeframe = this._timeframe();
        const now = new Date();
        const active = sortTaskTree(
            filterTaskTree(buildTaskTree(this._activeByList.get(selectedId) ?? []), timeframe, now),
            order,
        );
        const completed = this._showCompleted()
            ? sortTaskTree(
                filterTaskTree(buildTaskTree(this._completedByList.get(selectedId) ?? []), timeframe, now),
                order,
            )
            : [];

        if (active.length === 0 && completed.length === 0) {
            this._section.setStatus(timeframe === 'all' ? 'No tasks' : 'No tasks in this range');
            return;
        }

        this._section.showTasks(active, completed, {
            onComplete: task => this._complete(task),
            onUncomplete: task => this._uncomplete(task),
            onEdit: task => this._openDialog(task),
            onAddSubtask: task => this._openDialog(null, task),
        });
    }

    async _refresh() {
        if (!this._manager || !this._section)
            return;

        const generation = ++this._generation;
        try {
            const {taskLists, tasks} = await this._manager.load(this._showCompleted());
            if (generation !== this._generation || !this._section)
                return;

            this._taskLists = taskLists;
            this._activeByList = new Map(taskLists.map(list => [list.id, []]));
            this._completedByList = new Map(taskLists.map(list => [list.id, []]));
            for (const task of tasks) {
                const bucket = task.status === 'completed' ? this._completedByList : this._activeByList;
                bucket.get(task.taskListId)?.push(task);
            }
            this._render();
        } catch (error) {
            if (generation !== this._generation || !this._section)
                return;
            if (error?.code === 'cancelled')
                return;

            console.error(`Google Tasks: ${error?.message || error}`);
            const needsAccount = error?.code === 'no-account' || error?.code === 'forbidden' || error?.code === 'token';
            this._statusAction = needsAccount
                ? () => this._openOnlineAccounts()
                : () => this._refresh();
            if (needsAccount || this._taskLists.length === 0)
                this._section.setLists([], '', () => {});
            this._section.setStatus(error?.message || 'Could not load tasks', needsAccount ? 'Online Accounts' : 'Retry');
        }
    }

    _closeCalendar() {
        this._section?.closeMenu();
        this._dateMenu?.menu.close();
    }

    _openOnlineAccounts() {
        this._closeCalendar();
        try {
            Gio.Subprocess.new(
                ['gnome-control-center', 'online-accounts'],
                Gio.SubprocessFlags.NONE,
            );
        } catch (error) {
            Main.notify('Google Tasks', 'Open Settings → Online Accounts and add your Google account.');
        }
    }

    _openDialog(task = null, parentTask = null) {
        if (!this._manager)
            return;
        this._closeCalendar();

        const dialog = new TaskDialog(parentTask ? 'New subtask' : task ? 'Edit task' : 'New task');
        if (task)
            dialog.setValues(task.title, task.notes);
        dialog.connect('saved', (_dialog, title, notes) => {
            this._saveDialog(task, parentTask, title, notes).catch(error => {
                console.error(`Google Tasks: ${error?.message || error}`);
                Main.notify('Google Tasks', error?.message || 'Could not save the task');
            });
        });
        dialog.open();
    }

    async _saveDialog(task, parentTask, title, notes) {
        if (!this._manager)
            return;
        if (task)
            await this._manager.updateTask(task.taskListId, task.id, title, notes);
        else
            await this._manager.createTask(title, notes, parentTask?.taskListId || this._selectedListId(), parentTask?.id);
        this._refresh();
    }

    _complete(task) {
        this._stopTimer(this._completeTimerId);
        this._completeTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
            this._completeTimerId = 0;
            this._mutate(task, true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _uncomplete(task) {
        this._mutate(task, false);
    }

    async _mutate(task, completed) {
        if (!this._manager || !task.taskListId)
            return;
        try {
            if (completed)
                await this._manager.completeTask(task.taskListId, task.id);
            else
                await this._manager.uncompleteTask(task.taskListId, task.id);
            this._refresh();
        } catch (error) {
            console.error(`Google Tasks: ${error?.message || error}`);
            Main.notify('Google Tasks', error?.message || 'Could not update the task');
            this._refresh();
        }
    }
}
