import {
    buildTaskTree,
    dueDateKey,
    filterTaskTree,
    formatDue,
    sortTaskTree,
} from '../taskModel.js';

const now = new Date(2026, 9, 7, 15, 0, 0);

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const dueToday = '2026-10-07T00:00:00.000Z';
const dueMonday = '2026-10-05T00:00:00.000Z';
const dueSunday = '2026-10-11T00:00:00.000Z';
const dueNext = '2026-10-12T00:00:00.000Z';

assert(dueDateKey(dueToday) === '2026-10-07', 'due date uses the calendar prefix');
assert(dueDateKey('') === null, 'empty due date');
assert(formatDue(dueToday, now) === 'Today', 'today label');
assert(formatDue('2026-10-08T00:00:00.000Z', now) === 'Tomorrow', 'tomorrow label');

const tasks = [
    {id: 'a', title: 'Parent', parent: '', position: '2', due: '', updated: ''},
    {id: 'b', title: 'Child', parent: 'a', position: '1', due: dueToday, updated: ''},
    {id: 'c', title: 'Orphan', parent: 'missing', position: '1', due: dueMonday, updated: '2026-10-01T00:00:00.000Z'},
    {id: 'd', title: 'Later', parent: '', position: '1', due: dueNext, updated: '2026-10-06T00:00:00.000Z'},
];

const tree = buildTaskTree(tasks);
assert(tree.length === 3, `expected 3 roots, got ${tree.length}`);
const parent = tree.find(task => task.id === 'a');
assert(parent.children.length === 1 && parent.children[0].id === 'b', 'child nested under parent');
assert(tree.some(task => task.id === 'c'), 'missing parent becomes a root');

const today = filterTaskTree(tree, 'today', now);
assert(today.length === 1 && today[0].id === 'a', 'parent kept when a child is due today');
assert(today[0].children.length === 1, 'matching child kept');

const week = filterTaskTree(tree, 'this-week', now);
const weekIds = week.map(task => task.id).sort();
assert(weekIds.includes('a') && weekIds.includes('c'), 'week includes Monday and today');
assert(!weekIds.includes('d'), 'next week is excluded');

const byTitle = sortTaskTree(tree, 'title').map(task => task.title);
assert(byTitle[0] === 'Later', `title sort starts with Later, got ${byTitle}`);

const byDeadline = sortTaskTree(
    [{id: '1', title: 'None', due: '', children: []}, {id: '2', title: 'Soon', due: dueSunday, children: []}],
    'deadline',
);
assert(byDeadline[0].id === '2' && byDeadline[1].id === '1', 'undated tasks sort after deadlines');

const byPosition = sortTaskTree(
    [{id: '1', title: 'B', position: '0002', children: []}, {id: '2', title: 'A', position: '0001', children: []}],
    'my-order',
);
assert(byPosition.map(task => task.id).join() === '2,1', 'position sort');

print('taskModel tests passed');
