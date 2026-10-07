import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Goa from 'gi://Goa';
import Soup from 'gi://Soup';

const LISTS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100';

Gio._promisify(Goa.OAuth2Based.prototype, 'call_get_access_token', 'call_get_access_token_finish');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

export class TasksError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export class GoogleTasksManager {
    constructor() {
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session();
        this._client = null;
    }

    destroy() {
        this._cancellable.cancel();
    }

    async load(includeCompleted) {
        const {token, email} = await this._authorize();
        const lists = await this._paged(LISTS_URL, token);
        const taskLists = lists.map(list => ({
            id: list.id,
            title: list.title || 'Untitled',
        }));

        const tasks = [];
        const showCompleted = includeCompleted ? 'true' : 'false';
        for (const list of taskLists) {
            const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?maxResults=100&showCompleted=${showCompleted}&showHidden=${showCompleted}`;
            const items = await this._paged(url, token);
            for (const item of items) {
                tasks.push({
                    id: item.id,
                    title: item.title || '',
                    notes: item.notes || '',
                    status: item.status || 'needsAction',
                    taskListId: list.id,
                    parent: item.parent || '',
                    due: item.due || '',
                    updated: item.updated || '',
                    position: item.position || '',
                });
            }
        }

        return {email, taskLists, tasks};
    }

    async createTask(title, notes, taskListId, parentTaskId) {
        const {token} = await this._authorize();
        let listId = taskListId;
        if (!listId) {
            const lists = await this._paged(LISTS_URL, token);
            if (lists.length === 0)
                throw new TasksError('no-lists', 'No task lists found');
            listId = lists[0].id;
        }

        const parent = parentTaskId ? `?parent=${encodeURIComponent(parentTaskId)}` : '';
        const body = {title};
        if (notes)
            body.notes = notes;
        await this._request(
            'POST',
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks${parent}`,
            token,
            body,
        );
    }

    async updateTask(taskListId, taskId, title, notes) {
        const {token} = await this._authorize();
        const body = {title};
        if (notes !== undefined)
            body.notes = notes;
        await this._patch(taskListId, taskId, token, body);
    }

    async completeTask(taskListId, taskId) {
        const {token} = await this._authorize();
        await this._patch(taskListId, taskId, token, {status: 'completed'});
    }

    async uncompleteTask(taskListId, taskId) {
        const {token} = await this._authorize();
        await this._patch(taskListId, taskId, token, {status: 'needsAction'});
    }

    async _patch(taskListId, taskId, token, body) {
        await this._request(
            'PATCH',
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
            token,
            body,
        );
    }

    async _authorize() {
        let client;
        try {
            if (!this._client)
                this._client = Goa.Client.new_sync(this._cancellable);
            client = this._client;
        } catch (error) {
            if (isCancelled(error))
                throw new TasksError('cancelled', 'Cancelled');
            throw new TasksError('goa', 'Could not reach Online Accounts');
        }

        const google = client.get_accounts().find(account =>
            account.get_account().provider_type === 'google');
        if (!google) {
            throw new TasksError(
                'no-account',
                'Add your Google account in Online Accounts. Signing in to Chrome does not connect the desktop.',
            );
        }

        const oauth2 = google.get_oauth2_based();
        if (!oauth2)
            throw new TasksError('no-oauth', 'This Google account does not provide OAuth');

        try {
            const [token] = await oauth2.call_get_access_token(this._cancellable);
            return {
                token,
                email: google.get_account().presentation_identity || '',
            };
        } catch (error) {
            if (isCancelled(error))
                throw new TasksError('cancelled', 'Cancelled');
            throw new TasksError('token', 'Could not get a Google access token. Remove the account in Online Accounts and add it again.');
        }
    }

    async _paged(url, token) {
        const items = [];
        let pageToken = null;
        do {
            const joiner = url.includes('?') ? '&' : '?';
            const pageUrl = pageToken
                ? `${url}${joiner}pageToken=${encodeURIComponent(pageToken)}`
                : url;
            const data = await this._request('GET', pageUrl, token);
            if (data.items)
                items.push(...data.items);
            pageToken = data.nextPageToken || null;
        } while (pageToken);
        return items;
    }

    async _request(method, url, token, body) {
        const message = Soup.Message.new(method, url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        if (body) {
            const bytes = GLib.Bytes.new(new TextEncoder().encode(JSON.stringify(body)));
            message.set_request_body_from_bytes('application/json', bytes);
        }

        let responseBytes;
        try {
            responseBytes = await this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
            );
        } catch (error) {
            if (isCancelled(error))
                throw new TasksError('cancelled', 'Cancelled');
            throw new TasksError('network', error instanceof Error ? error.message : String(error));
        }

        const status = message.get_status();
        const raw = responseBytes?.get_data();
        const text = raw ? new TextDecoder().decode(raw) : '';
        if (status < 200 || status >= 300) {
            let detail = '';
            try {
                detail = JSON.parse(text)?.error?.message || '';
            } catch {
                detail = '';
            }
            if (status === 401 || status === 403) {
                throw new TasksError(
                    'forbidden',
                    'Google Tasks access was not granted. In Online Accounts, remove this Google account and add it again.',
                );
            }
            throw new TasksError('http', detail || `Google Tasks returned HTTP ${status}`);
        }

        if (!text)
            return {};
        return JSON.parse(text);
    }
}
