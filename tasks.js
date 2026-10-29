/**
 * tasks.js — assignments, quizzes, exams, projects and labs.
 * Includes search, filters, sorting, completion and deadline countdowns.
 */

import { Store } from './storage.js';
import {
  esc, uid, icon, UI, emptyState, field, selectField, textareaField, setFormErrors,
  TASK_TYPES, TASK_TYPE_LABELS, TASK_STATUSES, STATUS_LABELS, PRIORITIES, PRIORITY_LABELS,
  todayISO, isValidDate, isValidTime, deadlineInfo, dueMoment, fmtDate,
} from './utils.js';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const ui = { search: '', course: 'all', type: 'all', status: 'open', sort: 'due' };

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function courseOptions() {
  return Store.get().courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));
}

function courseOf(task) {
  return Store.getCourse(task.courseId);
}

function coursePill(task) {
  const course = courseOf(task);
  if (!course) return '<span class="course-pill"><span class="dot gray"></span>General</span>';
  return `<span class="course-pill"><span class="dot" style="background:${esc(course.color)}"></span><span>${esc(course.code)}</span></span>`;
}

function dueChip(task) {
  const info = deadlineInfo(task.dueDate, task.dueTime, task.status);
  const tone = info.tone === 'done' ? 'green' : info.tone === 'overdue' ? 'red' : info.tone === 'today' || info.tone === 'soon' ? 'amber' : '';
  const iconName = info.tone === 'done' ? 'check' : info.tone === 'overdue' ? 'alert' : 'clock';
  return `<span class="chip ${tone}">${icon(iconName)}${esc(info.label)}</span>`;
}

function sortTasks(list) {
  const sorted = list.slice();
  switch (ui.sort) {
    case 'due-desc':
      sorted.sort((a, b) => (dueMoment(b.dueDate, b.dueTime)?.getTime() || 0) - (dueMoment(a.dueDate, a.dueTime)?.getTime() || 0));
      break;
    case 'priority':
      sorted.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1)
        || (dueMoment(a.dueDate, a.dueTime)?.getTime() || 0) - (dueMoment(b.dueDate, b.dueTime)?.getTime() || 0));
      break;
    case 'course':
      sorted.sort((a, b) => (courseOf(a)?.code || 'zzz').localeCompare(courseOf(b)?.code || 'zzz')
        || (dueMoment(a.dueDate, a.dueTime)?.getTime() || 0) - (dueMoment(b.dueDate, b.dueTime)?.getTime() || 0));
      break;
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'due':
    default:
      sorted.sort((a, b) => (dueMoment(a.dueDate, a.dueTime)?.getTime() || 0) - (dueMoment(b.dueDate, b.dueTime)?.getTime() || 0));
      break;
  }
  return sorted;
}

function matchesFilters(task) {
  if (ui.course === '__none') {
    if (task.courseId) return false;
  } else if (ui.course !== 'all' && task.courseId !== ui.course) return false;
  if (ui.type !== 'all' && task.type !== ui.type) return false;
  if (ui.status === 'open' && task.status === 'done') return false;
  if (ui.status !== 'open' && ui.status !== 'all' && task.status !== ui.status) return false;
  if (ui.search) {
    const course = courseOf(task);
    const haystack = [
      task.title, task.notes, TASK_TYPE_LABELS[task.type], course?.code, course?.name,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(ui.search.toLowerCase())) return false;
  }
  return true;
}

export function openTaskCount() {
  return Store.get().tasks.filter((t) => t.status !== 'done').length;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export function setTaskStatus(taskId, status) {
  if (!TASK_STATUSES.includes(status)) return;
  const task = Store.get().tasks.find((t) => t.id === taskId);
  if (!task) return;
  const wasDone = task.status === 'done';
  Store.update((state) => {
    const target = state.tasks.find((t) => t.id === taskId);
    if (!target) return false;
    target.status = status;
    target.completedAt = status === 'done' ? (target.completedAt || new Date().toISOString()) : null;
  });
  if (status === 'done' && !wasDone) UI.toast('Task completed. Nice work.', 'success');
  else if (wasDone && status !== 'done') UI.toast('Task reopened.');
}

export async function deleteTask(taskId) {
  const task = Store.get().tasks.find((t) => t.id === taskId);
  if (!task) return;
  const ok = await UI.confirm({
    title: 'Delete task?',
    message: `"${task.title}" will be removed from your semester.`,
    confirmLabel: 'Delete task',
  });
  if (!ok) return;
  Store.update((state) => { state.tasks = state.tasks.filter((t) => t.id !== taskId); });
  UI.toast('Task deleted.', 'success');
}

function validateTask(values) {
  const errors = {};
  if (!values.title) errors.title = 'Give this task a title.';
  else if (values.title.length > 160) errors.title = 'Keep the title under 160 characters.';
  if (!values.dueDate) errors.dueDate = 'A due date is required.';
  else if (!isValidDate(values.dueDate)) errors.dueDate = 'Enter a valid due date.';
  if (values.dueTime && !isValidTime(values.dueTime)) errors.dueTime = 'Enter a valid time (HH:MM) or leave it blank.';
  if (!TASK_TYPES.includes(values.type)) errors.type = 'Choose a task type.';
  if (!TASK_STATUSES.includes(values.status)) errors.status = 'Choose a status.';
  if (!PRIORITIES.includes(values.priority)) errors.priority = 'Choose a priority.';
  if (values.courseId && !Store.getCourse(values.courseId)) errors.courseId = 'That course no longer exists.';
  return errors;
}

export function openTaskModal(task = null, defaults = {}) {
  const editing = Boolean(task);
  const courses = Store.get().courses;
  const body = `
    <div class="form-grid">
      <div class="span-2">${field({ label: 'Title', name: 'title', value: task?.title || '', placeholder: 'e.g. Problem set 4 — graph theory', required: true })}</div>
      ${selectField({
        label: 'Type', name: 'type', required: true,
        value: task?.type || defaults.type || 'assignment',
        options: TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] })),
      })}
      ${selectField({
        label: 'Course', name: 'courseId', value: task?.courseId || defaults.courseId || '',
        options: courseOptions(),
        placeholder: courses.length ? 'No course (general)' : 'No courses yet',
        hint: courses.length ? '' : 'Create a course to group tasks by course.',
      })}
      ${field({ label: 'Due date', name: 'dueDate', type: 'date', value: task?.dueDate || defaults.dueDate || todayISO(), required: true })}
      ${field({ label: 'Time (optional)', name: 'dueTime', type: 'time', value: task?.dueTime || '', hint: 'Defaults to end of day when blank.' })}
      ${selectField({
        label: 'Priority', name: 'priority', value: task?.priority || 'medium',
        options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
      })}
      ${selectField({
        label: 'Status', name: 'status', value: task?.status || 'todo',
        options: TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
      })}
      <div class="span-2">${textareaField({ label: 'Notes (optional)', name: 'notes', value: task?.notes || '', rows: 3, placeholder: 'Requirements, submission link, page numbers…' })}</div>
    </div>`;

  UI.modal({
    title: editing ? 'Edit task' : 'New task',
    subtitle: editing ? 'Update the details or deadline.' : 'Track an assignment, quiz, exam, project or lab.',
    body,
    submitLabel: editing ? 'Save changes' : 'Add task',
    onSubmit(values, form) {
      const errors = validateTask(values);
      if (Object.keys(errors).length) {
        setFormErrors(form, errors);
        return false;
      }
      const now = new Date().toISOString();
      const clean = {
        title: values.title,
        type: values.type,
        courseId: values.courseId || null,
        dueDate: values.dueDate,
        dueTime: values.dueTime || '',
        priority: values.priority,
        status: values.status,
        notes: values.notes || '',
      };
      if (editing) {
        Store.update((state) => {
          const target = state.tasks.find((t) => t.id === task.id);
          if (!target) return false;
          const wasDone = target.status === 'done';
          Object.assign(target, clean);
          target.completedAt = clean.status === 'done' ? (wasDone ? target.completedAt : now) : null;
        });
        UI.toast('Task updated.', 'success');
      } else {
        Store.update((state) => {
          state.tasks.push({
            id: uid('task'),
            ...clean,
            createdAt: now,
            completedAt: clean.status === 'done' ? now : null,
          });
        });
        UI.toast('Task added.', 'success');
      }
      return true;
    },
  });
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function taskRow(task) {
  const info = deadlineInfo(task.dueDate, task.dueTime, task.status);
  const done = task.status === 'done';
  const statusClass = done ? 'done' : task.status === 'in-progress' ? 'progress' : '';
  return `<div class="task-row ${done ? 'done' : ''} ${info.tone === 'overdue' ? 'overdue' : ''}" data-task-row="${esc(task.id)}">
    <button class="task-check" data-toggle-task="${esc(task.id)}" aria-label="${done ? 'Mark as not done' : 'Mark as done'}" title="${done ? 'Reopen task' : 'Complete task'}">${icon('check')}</button>
    <div class="task-main">
      <div class="task-title">${esc(task.title)}</div>
      <div class="task-meta">
        <span class="type-tag ${esc(task.type)}">${esc(TASK_TYPE_LABELS[task.type] || task.type)}</span>
        ${coursePill(task)}
        ${task.priority === 'high' ? '<span class="sep"></span><span class="priority high">High</span>' : ''}
        <span class="sep"></span>
        <span class="subtle nowrap">${esc(fmtDate(task.dueDate, { year: false }))}${task.dueTime ? ` · ${esc(task.dueTime)}` : ''}</span>
      </div>
      ${task.notes ? `<div class="task-notes">${esc(task.notes)}</div>` : ''}
    </div>
    <div class="task-side">
      ${dueChip(task)}
      <select class="status-select ${statusClass}" data-status-task="${esc(task.id)}" aria-label="Status for ${esc(task.title)}">
        ${TASK_STATUSES.map((s) => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <div class="task-actions">
        <button class="icon-btn" data-edit-task="${esc(task.id)}" title="Edit task" aria-label="Edit ${esc(task.title)}">${icon('pencil')}</button>
        <button class="icon-btn danger" data-delete-task="${esc(task.id)}" title="Delete task" aria-label="Delete ${esc(task.title)}">${icon('trash')}</button>
      </div>
    </div>
  </div>`;
}

function groupMarkup(tasks) {
  if (!tasks.length) return '';
  if (ui.sort !== 'due' || ui.status === 'done') {
    return `<div class="task-group">
      <div class="task-group-head"><h3>${tasks.length} task${tasks.length === 1 ? '' : 's'}</h3></div>
      <div class="task-list">${tasks.map(taskRow).join('')}</div>
    </div>`;
  }

  const groups = [
    { key: 'overdue', label: 'Overdue', tone: 'red' },
    { key: 'today', label: 'Due today', tone: 'amber' },
    { key: 'soon', label: 'Next 7 days', tone: 'amber' },
    { key: 'later', label: 'Later', tone: '' },
    { key: 'done', label: 'Completed', tone: 'green' },
  ];
  const buckets = new Map(groups.map((g) => [g.key, []]));
  for (const task of tasks) {
    const info = deadlineInfo(task.dueDate, task.dueTime, task.status);
    const key = info.tone === 'done' ? 'done' : info.tone === 'overdue' ? 'overdue' : info.tone === 'today' ? 'today' : info.tone === 'soon' ? 'soon' : 'later';
    buckets.get(key).push(task);
  }
  return groups
    .map((group) => {
      const items = buckets.get(group.key);
      if (!items.length) return '';
      return `<div class="task-group">
        <div class="task-group-head">
          <span class="dot ${group.tone}"></span>
          <h3>${group.label}</h3>
          <span class="count">${items.length}</span>
        </div>
        <div class="task-list">${items.map(taskRow).join('')}</div>
      </div>`;
    })
    .join('');
}

function listMarkup() {
  const tasks = Store.get().tasks.filter(matchesFilters);
  const sorted = sortTasks(tasks);
  if (!sorted.length) {
    const anyTasks = Store.get().tasks.length > 0;
    return `<div class="card card-pad">${emptyState({
      iconName: anyTasks ? 'search' : 'tasks',
      title: anyTasks ? 'No tasks match these filters' : 'No tasks yet',
      body: anyTasks
        ? 'Try a different course, type or status — or clear the search.'
        : 'Add assignments, quizzes, midterms and projects so deadlines stop surprising you.',
      action: anyTasks
        ? '<button class="btn ghost" data-clear-filters>Clear filters</button>'
        : '<button class="btn primary" data-new-task>' + icon('plus') + ' Add your first task</button>',
    })}</div>`;
  }
  return groupMarkup(sorted);
}

function toolbarMarkup() {
  const courses = Store.get().courses;
  const filtersActive = ui.search || ui.course !== 'all' || ui.type !== 'all' || ui.status !== 'open' || ui.sort !== 'due';
  return `<div class="toolbar">
    <div class="search-box">
      ${icon('search')}
      <input type="search" name="taskSearch" placeholder="Search tasks, notes or courses…" value="${esc(ui.search)}" aria-label="Search tasks">
    </div>
    <select name="courseFilter" aria-label="Filter by course">
      <option value="all">All courses</option>
      ${courses.map((c) => `<option value="${esc(c.id)}" ${ui.course === c.id ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}
      ${Store.get().tasks.some((t) => !t.courseId) ? `<option value="__none" ${ui.course === '__none' ? 'selected' : ''}>General</option>` : ''}
    </select>
    <select name="typeFilter" aria-label="Filter by type">
      <option value="all">All types</option>
      ${TASK_TYPES.map((t) => `<option value="${esc(t)}" ${ui.type === t ? 'selected' : ''}>${esc(TASK_TYPE_LABELS[t])}</option>`).join('')}
    </select>
    <select name="statusFilter" aria-label="Filter by status">
      <option value="open" ${ui.status === 'open' ? 'selected' : ''}>Open tasks</option>
      <option value="all" ${ui.status === 'all' ? 'selected' : ''}>Every status</option>
      ${TASK_STATUSES.map((s) => `<option value="${esc(s)}" ${ui.status === s ? 'selected' : ''}>${esc(STATUS_LABELS[s])}</option>`).join('')}
    </select>
    <select name="sortBy" aria-label="Sort tasks">
      <option value="due" ${ui.sort === 'due' ? 'selected' : ''}>Sort: due date</option>
      <option value="due-desc" ${ui.sort === 'due-desc' ? 'selected' : ''}>Sort: latest first</option>
      <option value="priority" ${ui.sort === 'priority' ? 'selected' : ''}>Sort: priority</option>
      <option value="course" ${ui.sort === 'course' ? 'selected' : ''}>Sort: course</option>
      <option value="title" ${ui.sort === 'title' ? 'selected' : ''}>Sort: title</option>
    </select>
    ${filtersActive ? `<button class="btn ghost small" data-clear-filters title="Reset filters">${icon('filter')} Reset</button>` : ''}
  </div>`;
}

export const TasksView = {
  render(root) {
    const all = Store.get().tasks;
    const open = all.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => deadlineInfo(t.dueDate, t.dueTime, t.status).tone === 'overdue');
    const completedThisWeek = all.filter((t) => t.status === 'done' && t.completedAt
      && (Date.now() - new Date(t.completedAt).getTime()) < 7 * 86400000).length;

    // Keep filters valid if a course was deleted.
    if (ui.course !== 'all' && ui.course !== '__none' && !Store.getCourse(ui.course)) ui.course = 'all';

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${icon('tasks')} Tasks & assessments</p>
          <h2>Everything that needs doing</h2>
          <p class="lede">${open.length} open · ${overdue.length} overdue · ${completedThisWeek} completed in the last 7 days.</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" data-new-task>${icon('plus')} New task</button>
        </div>
      </div>
      ${toolbarMarkup()}
      <div data-task-list>${listMarkup()}</div>`;

    const listEl = root.querySelector('[data-task-list]');

    const refreshList = () => {
      if (!listEl) return;
      listEl.innerHTML = listMarkup();
    };

    root.oninput = (event) => {
      if (event.target.name === 'taskSearch') {
        ui.search = event.target.value;
        refreshList();
      }
    };

    root.onchange = (event) => {
      const name = event.target.name;
      if (name === 'courseFilter') ui.course = event.target.value;
      else if (name === 'typeFilter') ui.type = event.target.value;
      else if (name === 'statusFilter') ui.status = event.target.value;
      else if (name === 'sortBy') ui.sort = event.target.value;
      else if (event.target.dataset.statusTask) {
        setTaskStatus(event.target.dataset.statusTask, event.target.value);
        return;
      } else return;

      // Rebuild the toolbar (for the reset button) and the list.
      const toolbar = root.querySelector('.toolbar');
      if (toolbar) toolbar.outerHTML = toolbarMarkup();
      refreshList();
    };

    root.onclick = (event) => {
      const toggle = event.target.closest('[data-toggle-task]');
      if (toggle) {
        const task = Store.get().tasks.find((t) => t.id === toggle.dataset.toggleTask);
        if (task) setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done');
        return;
      }
      const edit = event.target.closest('[data-edit-task]');
      if (edit) {
        openTaskModal(Store.get().tasks.find((t) => t.id === edit.dataset.editTask));
        return;
      }
      const del = event.target.closest('[data-delete-task]');
      if (del) {
        deleteTask(del.dataset.deleteTask);
        return;
      }
      if (event.target.closest('[data-new-task]')) {
        openTaskModal();
        return;
      }
      if (event.target.closest('[data-clear-filters]')) {
        Object.assign(ui, { search: '', course: 'all', type: 'all', status: 'open', sort: 'due' });
        TasksView.render(root);
      }
    };
  },
};
