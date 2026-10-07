// Pure task-list helpers. Google Tasks stores a due date as midnight UTC
// (YYYY-MM-DDT00:00:00.000Z). The calendar day is the date prefix, not the
// timestamp shifted into the local timezone.

export function formatLocalDate(date) {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

export function dueDateKey(due) {
    if (!due)
        return null;
    const prefix = due.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
}

export function formatDue(due, now = new Date()) {
    const key = dueDateKey(due);
    if (!key)
        return '';

    const today = formatLocalDate(now);
    if (key === today)
        return 'Today';

    const tomorrow = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    if (key === tomorrow)
        return 'Tomorrow';

    const [year, month, day] = key.split('-').map(part => Number.parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    const options = year === now.getFullYear()
        ? {month: 'short', day: 'numeric'}
        : {month: 'short', day: 'numeric', year: 'numeric'};
    return date.toLocaleDateString(undefined, options);
}

export function buildTaskTree(tasks) {
    const nodes = new Map();
    for (const task of tasks)
        nodes.set(task.id, {...task, children: []});

    const roots = [];
    for (const task of tasks) {
        const node = nodes.get(task.id);
        const parent = task.parent ? nodes.get(task.parent) : null;
        if (parent)
            parent.children.push(node);
        else
            roots.push(node);
    }
    return roots;
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function inTimeframe(task, timeframe, now) {
    if (timeframe === 'all')
        return true;

    const due = dueDateKey(task.due);
    if (!due)
        return false;

    if (timeframe === 'today')
        return due === formatLocalDate(now);

    if (timeframe === 'this-week') {
        const day = now.getDay();
        const monday = addDays(now, -((day + 6) % 7));
        const start = formatLocalDate(monday);
        const end = formatLocalDate(addDays(monday, 6));
        return due >= start && due <= end;
    }

    if (timeframe === 'this-month') {
        const month = `${now.getMonth() + 1}`.padStart(2, '0');
        return due.startsWith(`${now.getFullYear()}-${month}`);
    }

    return true;
}

export function filterTaskTree(tasks, timeframe, now = new Date()) {
    if (timeframe === 'all')
        return tasks;

    const filtered = [];
    for (const task of tasks) {
        const children = task.children?.length
            ? filterTaskTree(task.children, timeframe, now)
            : [];
        if (inTimeframe(task, timeframe, now))
            filtered.push(task);
        else if (children.length > 0)
            filtered.push({...task, children});
    }
    return filtered;
}

function comparePosition(left, right) {
    if (!left && !right)
        return 0;
    if (!left)
        return 1;
    if (!right)
        return -1;
    return left < right ? -1 : left > right ? 1 : 0;
}

function compareDeadline(left, right) {
    const a = dueDateKey(left);
    const b = dueDateKey(right);
    if (!a && !b)
        return 0;
    if (!a)
        return 1;
    if (!b)
        return -1;
    return a < b ? -1 : a > b ? 1 : 0;
}

function updatedTime(task) {
    const time = Date.parse(task.updated || '');
    return Number.isNaN(time) ? 0 : time;
}

function sortLevel(tasks, order) {
    const sorted = [...tasks];
    switch (order) {
    case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    case 'date':
    case 'starred-recently':
        sorted.sort((a, b) => updatedTime(b) - updatedTime(a));
        break;
    case 'deadline':
        sorted.sort((a, b) => compareDeadline(a.due, b.due));
        break;
    case 'my-order':
    default:
        sorted.sort((a, b) => comparePosition(a.position, b.position));
        break;
    }
    return sorted;
}

export function sortTaskTree(tasks, order) {
    return sortLevel(tasks, order).map(task => ({
        ...task,
        children: task.children?.length ? sortTaskTree(task.children, order) : [],
    }));
}
