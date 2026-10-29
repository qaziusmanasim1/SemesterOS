/**
 * app.js — boot, routing, shell interactions and the dashboard.
 */

import { Store } from './storage.js';
import {
  esc, icon, UI, emptyState, todayISO, fmtDate, fmtTime12, formatMinutes,
  startOfWeek, addDays, isoOf, isoWeekday, deadlineInfo, dueMoment,
  semesterContext, round, DAY_SHORT, DAY_NAMES,
} from './utils.js';
import { CoursesView, openCourseModal, openCourseDetail } from './courses.js';
import { TasksView, openTaskModal, setTaskStatus } from './tasks.js';
import { TimetableView, openClassModal } from './timetable.js';
import { GradesView, openGradeModal, computeCourseGrade } from './grades.js';
import { StudyView, openSessionModal } from './study.js';
import { NotesView, createNote } from './notes.js';
import { SettingsView } from './settings.js';
import { registerServiceWorker } from './pwa.js';

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

const VIEWS = {
  dashboard: { label: 'Dashboard', title: 'Dashboard', sub: 'Your semester at a glance', icon: 'grid', render: renderDashboard },
  courses: { label: 'Courses', title: 'Courses', sub: 'Manage your enrolled courses', icon: 'book', render: (root) => CoursesView.render(root) },
  tasks: { label: 'Tasks', title: 'Tasks & assessments', sub: 'Deadlines, countdowns and completion', icon: 'tasks', render: (root) => TasksView.render(root) },
  timetable: { label: 'Timetable', title: 'Weekly timetable', sub: 'Classes, rooms and conflicts', icon: 'calendar', render: (root) => TimetableView.render(root) },
  grades: { label: 'Gradebook', title: 'Gradebook', sub: 'Marks, averages and GPA', icon: 'award', render: (root) => GradesView.render(root) },
  study: { label: 'Study', title: 'Study planner', sub: 'Pomodoro focus and planned sessions', icon: 'timer', render: (root) => StudyView.render(root) },
  notes: { label: 'Notes', title: 'Notes', sub: 'Course notes, autosaved locally', icon: 'note', render: (root) => NotesView.render(root) },
  settings: { label: 'Settings', title: 'Settings', sub: 'Semester, theme, grades and data', icon: 'settings', render: (root) => SettingsView.render(root) },
};

const NAV_ORDER = ['dashboard', 'courses', 'tasks', 'timetable', 'grades', 'study', 'notes', 'settings'];
const MOBILE_ORDER = ['dashboard', 'tasks', 'timetable', 'grades'];

let currentRoute = 'dashboard';
let previousRoute = null;

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  return VIEWS[raw] ? raw : 'dashboard';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.innerHTML = icon(theme === 'dark' ? 'moon' : 'sun');
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    toggle.setAttribute('title', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === theme);
  });

  const themeMeta = document.getElementById('theme-color-meta');
  if (themeMeta) {
    themeMeta.setAttribute('content', theme === 'dark' ? '#060912' : '#f2f4fb');
  }
}

function overdueCount() {
  const now = new Date();
  return Store.get().tasks.filter((task) => task.status !== 'done' && (() => {
    const due = dueMoment(task.dueDate, task.dueTime);
    return due && due.getTime() < now.getTime();
  })()).length;
}

function updateSidebar() {
  const nav = document.getElementById('nav-links');
  if (nav) {
    const overdue = overdueCount();
    nav.innerHTML = NAV_ORDER.map((id) => {
      const view = VIEWS[id];
      const badge = id === 'tasks' && overdue
        ? `<span class="nav-badge">${overdue}</span>`
        : '';
      return `<a class="nav-item ${currentRoute === id ? 'active' : ''}" href="#/${id}" ${currentRoute === id ? 'aria-current="page"' : ''}>
        ${icon(view.icon)}<span>${view.label}</span>${badge}
      </a>`;
    }).join('');
  }

  const foot = document.getElementById('sidebar-foot');
  if (foot) {
    const ctx = semesterContext(Store.settings);
    foot.innerHTML = `${ctx.start && ctx.end && ctx.week !== null
      ? `<div class="semester-mini">
          <div class="sm-top"><span class="sm-label">Semester</span><span class="sm-value">Week ${Math.max(1, ctx.week)} / ${ctx.totalWeeks}</span></div>
          <div class="progress"><div class="progress-bar" style="width:${Math.min(100, Math.max(0, Math.round(((ctx.elapsed || 0) / (ctx.totalDays || 1)) * 100)))}%"></div></div>
          <div class="sm-hint">${ctx.daysLeft !== null && ctx.daysLeft >= 0 ? `${ctx.daysLeft} day${ctx.daysLeft === 1 ? '' : 's'} left` : 'Semester has ended'}</div>
        </div>`
      : `<div class="semester-mini">
          <div class="sm-top"><span class="sm-label">Semester</span></div>
          <div class="sm-hint" style="margin-top:0">No semester dates yet.</div>
          <a class="btn ghost small" href="#/settings" style="margin-top:9px;width:100%">Set dates</a>
        </div>`}
      <div class="sidebar-note"><span class="dot"></span> Saved on this device</div>`;
  }

  const bottom = document.getElementById('bottom-nav');
  if (bottom) {
    const overdue = overdueCount();
    bottom.innerHTML = `${MOBILE_ORDER.map((id) => `<a class="bottom-item ${currentRoute === id ? 'active' : ''}" href="#/${id}" ${currentRoute === id ? 'aria-current="page"' : ''}>
      ${icon(VIEWS[id].icon)}<span>${VIEWS[id].label === 'Gradebook' ? 'Grades' : VIEWS[id].label}</span>
      ${id === 'tasks' && overdue ? `<span class="bn-badge">${overdue}</span>` : ''}
    </a>`).join('')}
    <button class="bottom-item" data-open-menu aria-label="Open all navigation">
      ${icon('menu')}<span>More</span>
    </button>`;
  }
}

function updateTopbar(route) {
  const view = VIEWS[route];
  const title = document.getElementById('page-title');
  const sub = document.getElementById('page-sub');
  if (title) title.textContent = view.title;
  if (sub) sub.textContent = view.sub;
}

function updateStorageBanner() {
  const banner = document.getElementById('storage-banner');
  if (!banner) return;
  if (!Store.storageError) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `${icon('alert')}<div>${esc(Store.storageError)} <a class="link-btn" href="#/settings">Open settings</a></div>`;
}

function setSidebar(open) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const toggle = document.getElementById('menu-toggle');
  if (!sidebar || !scrim) return;
  sidebar.classList.toggle('open', open);
  scrim.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
}

function closeQuickMenu() {
  const menu = document.getElementById('quick-add-menu');
  const btn = document.getElementById('quick-add');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function buildQuickMenu() {
  const menu = document.getElementById('quick-add-menu');
  if (!menu) return;
  const items = [
    { kind: 'task', icon: 'tasks', label: 'New task' },
    { kind: 'course', icon: 'book', label: 'New course' },
    { kind: 'class', icon: 'calendar', label: 'Add a class' },
    { kind: 'grade', icon: 'award', label: 'Record a mark' },
    { kind: 'session', icon: 'timer', label: 'Plan study session' },
    { kind: 'note', icon: 'note', label: 'New note' },
  ];
  menu.innerHTML = items.map((item) => `<button class="menu-item" data-quick="${item.kind}" role="menuitem">${icon(item.icon)}${item.label}</button>`).join('');
}

function quickAdd(kind) {
  if (kind === 'task') openTaskModal();
  else if (kind === 'course') openCourseModal();
  else if (kind === 'class') openClassModal();
  else if (kind === 'grade') {
    if (!Store.get().courses.length) { openCourseModal(); return; }
    openGradeModal();
  } else if (kind === 'session') openSessionModal();
  else if (kind === 'note') {
    createNote();
  }
}

function routeChanged() {
  currentRoute = parseRoute();
  updateTopbar(currentRoute);
  updateSidebar();
  updateStorageBanner();
  setSidebar(false);
  closeQuickMenu();
  if (previousRoute !== null && previousRoute !== currentRoute) window.scrollTo({ top: 0, behavior: 'auto' });
  previousRoute = currentRoute;
  renderCurrent();
}

function renderCurrent() {
  const root = document.getElementById('view');
  if (!root) return;
  const view = VIEWS[currentRoute] || VIEWS.dashboard;
  try {
    root.innerHTML = '';
    view.render(root);
  } catch (error) {
    console.error('View render failed:', error);
    root.innerHTML = `<div class="card card-pad">${emptyState({
      iconName: 'alert',
      title: 'This view could not render',
      body: 'Your saved data is safe. Reload the page, or open Settings to export a backup.',
      action: '<button class="btn" onclick="window.location.hash=\'#/settings\'">Open settings</button>',
    })}</div>`;
  }
  updateSidebar();
  updateStorageBanner();
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

function dueSort(a, b) {
  return (dueMoment(a.dueDate, a.dueTime)?.getTime() || 0) - (dueMoment(b.dueDate, b.dueTime)?.getTime() || 0);
}

function statCard({ label, value, unit = '', iconName, tone = '', foot = '' }) {
  return `<div class="stat-card">
    <div class="stat-top">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-icon ${tone}">${icon(iconName)}</span>
    </div>
    <div class="stat-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    <div class="stat-foot">${foot}</div>
  </div>`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function onboardingMarkup() {
  return `<section class="onboarding">
    <span class="eyebrow">${icon('sparkles')} Welcome to SemesterOS</span>
    <h2>Your whole semester, in one calm place.</h2>
    <p class="lede">This is a real, offline-first workspace — no sample data has been added. Start with your courses, then let deadlines, classes, marks and focus time come together on this dashboard.</p>
    <div class="onboarding-actions">
      <button class="btn primary" data-quick="course">${icon('plus')} Add your first course</button>
      <button class="btn" data-quick="task">${icon('tasks')} Add a task</button>
      <button class="btn ghost" data-seed-sample>Load optional sample semester</button>
    </div>
    <div class="steps-grid">
      <div class="step-card"><span class="step-num">1</span><div><h4>Set up your courses</h4><p>Code, name, instructor, credit hours and a color that becomes the course's identity everywhere.</p></div></div>
      <div class="step-card"><span class="step-num">2</span><div><h4>Add deadlines & your week</h4><p>Assignments, quizzes, exams and labs — plus the weekly timetable, with overlap warnings.</p></div></div>
      <div class="step-card"><span class="step-num">3</span><div><h4>Track marks & study</h4><p>Weighted grades, opt-in GPA, Pomodoro focus sessions and course notes that autosave.</p></div></div>
    </div>
    <p class="settings-note" style="margin-top:18px">Prefer to explore first? The sample semester is optional and only loads after you confirm — you can clear it anytime in Settings.</p>
  </section>`;
}

function todayClasses(now) {
  const today = isoWeekday(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  return Store.get().timetable
    .filter((entry) => entry.day === today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((entry) => {
      const course = Store.getCourse(entry.courseId);
      const [sh, sm] = entry.start.split(':').map(Number);
      const [eh, em] = entry.end.split(':').map(Number);
      const isNow = minutes >= sh * 60 + sm && minutes < eh * 60 + em;
      return { entry, course, isNow };
    });
}

function renderDashboard(root) {
  const data = Store.get();
  const now = new Date();
  const settings = data.settings;
  const courses = data.courses;
  const tasks = data.tasks;
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const today = todayISO();

  const classList = todayClasses(now);
  const overdue = openTasks.filter((t) => deadlineInfo(t.dueDate, t.dueTime, t.status, now).tone === 'overdue').sort(dueSort);
  const upcoming = openTasks
    .filter((t) => deadlineInfo(t.dueDate, t.dueTime, t.status, now).tone !== 'overdue')
    .sort(dueSort)
    .slice(0, 6);
  const dueNextWeek = openTasks.filter((t) => {
    const info = deadlineInfo(t.dueDate, t.dueTime, t.status, now);
    return info.days !== null && info.days >= 0 && info.days <= 7;
  });
  const dueToday = openTasks.filter((t) => deadlineInfo(t.dueDate, t.dueTime, t.status, now).tone === 'today');

  const weekStartDate = startOfWeek(now, settings.weekStart);
  const weekDates = Array.from({ length: 7 }, (_, i) => isoOf(addDays(weekStartDate, i)));
  const sessions = data.studySessions.filter((s) => s.status === 'completed');
  const weeklyMinutes = weekDates.map((date) => sessions.filter((s) => s.date === date).reduce((sum, s) => sum + s.minutes, 0));
  const weekTotal = weeklyMinutes.reduce((a, b) => a + b, 0);
  const weekSessions = sessions.filter((s) => s.date >= weekDates[0] && s.date <= weekDates[6]).length;
  const maxMinutes = Math.max(30, ...weeklyMinutes);

  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const progress = tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const ctx = semesterContext(settings, now);
  const isFirstRun = !courses.length && !tasks.length;

  const todayFormatted = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const greetingName = settings.displayName ? `, ${settings.displayName}` : '';

  const classMarkup = classList.length
    ? classList.map(({ entry, course, isNow }) => `<div class="class-row" data-dash-class="${esc(entry.id)}">
        <div class="class-time"><strong>${esc(fmtTime12(entry.start))}</strong><span>${esc(fmtTime12(entry.end))}</span></div>
        <div class="class-info">
          <strong><span class="dot" style="display:inline-block;margin-right:6px;background:${esc(course?.color || '#7c6cff')}"></span>${esc(course?.code || 'Class')}${course ? ` · ${esc(course.name)}` : ''}</strong>
          <span>${entry.room ? esc(entry.room) : 'Room not set'}${entry.instructor || course?.instructor ? ` · ${esc(entry.instructor || course.instructor)}` : ''}</span>
        </div>
        ${isNow ? '<span class="class-flag">Now</span>' : ''}
      </div>`).join('')
    : emptyState({
      iconName: 'calendar',
      title: 'No classes today',
      body: 'A free day — use it well. Your weekly classes live in the timetable.',
      action: '<button class="btn small" data-quick="class">' + icon('plus') + ' Add a class</button>',
    });

  const upcomingMarkup = upcoming.length
    ? upcoming.map((task) => {
      const course = Store.getCourse(task.courseId);
      const info = deadlineInfo(task.dueDate, task.dueTime, task.status, now);
      const tone = info.tone === 'today' || info.tone === 'soon' ? 'amber' : '';
      return `<div class="deadline-row" data-dash-edit-task="${esc(task.id)}">
        <span class="dot" style="background:${esc(course?.color || '#6a7695')}"></span>
        <div class="deadline-main">
          <div class="deadline-title">${esc(task.title)}</div>
          <div class="deadline-meta"><span>${esc(course?.code || 'General')}</span><span>·</span><span>${esc(fmtDate(task.dueDate, { year: false }))}${task.dueTime ? ` · ${esc(task.dueTime)}` : ''}</span></div>
        </div>
        <div class="deadline-when"><span class="chip ${tone}">${icon('clock')}${esc(info.label)}</span></div>
      </div>`;
    }).join('')
    : emptyState({
      iconName: 'check',
      title: 'Nothing coming up',
      body: tasks.length ? 'Every open task is overdue — check the overdue list.' : 'Add your first assignment to see deadlines here.',
      action: '<button class="btn small" data-quick="task">' + icon('plus') + ' Add task</button>',
    });

  const overdueMarkup = overdue.length
    ? `<div class="overdue-list">${overdue.slice(0, 4).map((task) => `<div class="overdue-row">
        <span class="or-main"><strong>${esc(task.title)}</strong><span>${esc(deadlineInfo(task.dueDate, task.dueTime, task.status, now).label)} · ${esc(Store.getCourse(task.courseId)?.code || 'General')}</span></span>
        <button class="check-btn" data-dash-done="${esc(task.id)}" title="Mark done" aria-label="Mark ${esc(task.title)} done">${icon('check')}</button>
      </div>`).join('')}</div>
      ${overdue.length > 4 ? `<a class="link-btn" href="#/tasks" style="margin-top:11px">View all ${overdue.length} overdue</a>` : ''}`
    : `<div class="empty small" style="padding:14px 4px">
        <span class="empty-icon" style="color:var(--green);background:var(--green-soft)">${icon('check')}</span>
        <h3>All clear</h3><p>No overdue tasks right now.</p>
      </div>`;

  const courseProgress = courses.length
    ? courses.map((course) => {
      const courseTaskList = tasks.filter((t) => t.courseId === course.id);
      const done = courseTaskList.filter((t) => t.status === 'done').length;
      const pct = courseTaskList.length ? Math.round((done / courseTaskList.length) * 100) : 0;
      const grade = computeCourseGrade(course.id);
      return `<div class="cp-item" data-open-course="${esc(course.id)}" role="button" tabindex="0">
        <div class="cp-top">
          <span class="cp-name"><span class="dot" style="background:${esc(course.color)}"></span><span>${esc(course.code)}</span></span>
          <span class="cp-val">${grade.weighted !== null ? `${esc(round(grade.weighted, 1))}%` : '—'}</span>
        </div>
        <div class="progress"><div class="progress-bar ${pct === 100 && courseTaskList.length ? 'green' : ''}" style="width:${pct}%;background:${course.color}"></div></div>
        <div class="cp-meta">${done}/${courseTaskList.length} tasks · ${esc(round(course.credits, 1))} cr</div>
      </div>`;
    }).join('')
    : `<p class="settings-note">Add courses to see progress here.</p>`;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${icon('calendar')} ${esc(todayFormatted)}</p>
        <h1>${esc(greeting())}${esc(greetingName)}.</h1>
        <p class="lede">${isFirstRun
          ? 'A fresh semester workspace. Add a course to begin — nothing is pre-filled.'
          : ctx.start && ctx.week
            ? `Week ${esc(Math.max(1, ctx.week))} of ${esc(ctx.totalWeeks)}${ctx.daysLeft !== null ? ` · ${Math.max(0, ctx.daysLeft)} days left` : ''} · ${classList.length} class${classList.length === 1 ? '' : 'es'} today · ${dueToday.length} due today.`
            : `${courses.length} course${courses.length === 1 ? '' : 's'} · ${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}${ctx.start ? '' : ' · set your semester dates in Settings'}.`}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" data-quick="task">${icon('plus')} Add task</button>
        <button class="btn ghost" data-quick="course">${icon('book')} Add course</button>
      </div>
    </div>

    ${isFirstRun ? onboardingMarkup() : ''}

    <div class="stat-grid">
      ${statCard({
        label: 'Due next 7 days', value: dueNextWeek.length, iconName: 'clock', tone: 'amber',
        foot: dueNextWeek.length ? `<span class="warn">${dueToday.length} due today</span> · ${dueNextWeek.length - dueToday.length} later this week` : '<span class="up">Nothing due — clear runway</span>',
      })}
      ${statCard({
        label: 'Overdue', value: overdue.length, iconName: 'alert', tone: overdue.length ? 'red' : 'green',
        foot: overdue.length ? '<span style="color:var(--red)">Needs attention</span>' : '<span style="color:var(--green)">All caught up</span>',
      })}
      ${statCard({
        label: 'Study this week', value: formatMinutes(weekTotal), iconName: 'timer', tone: 'blue',
        foot: `${weekSessions} completed session${weekSessions === 1 ? '' : 's'}`,
      })}
      ${statCard({
        label: 'Task progress', value: `${progress}<small style="font-size:13px;font-weight:500;color:var(--faint)">%</small>`, iconName: 'target', tone: 'green',
        foot: `${doneTasks} of ${tasks.length || 0} complete${!courses.length ? ' · no courses yet' : ''}`,
      })}
    </div>

    <div class="dash-grid">
      <section class="card span-2">
        <div class="card-head bordered">
          <div>
            <div class="card-title">${icon('calendar')} Today's classes</div>
            <div class="card-sub">${esc(DAY_NAMES[isoWeekday(now) - 1] || '')} · ${classList.length} scheduled</div>
          </div>
          <a class="card-action" href="#/timetable">Full week ${icon('arrowRight')}</a>
        </div>
        <div class="card-body today-list">${classMarkup}</div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${icon('timer')} Weekly study time</div>
            <div class="chart-total" style="margin-top:9px"><strong>${formatMinutes(weekTotal)}</strong><span>this week</span></div>
          </div>
          <a class="card-action" href="#/study">Study</a>
        </div>
        <div class="card-body">
          <div class="study-chart">
            ${weekDates.map((date, index) => {
              const mins = weeklyMinutes[index];
              const height = mins ? Math.max(4, Math.round((mins / maxMinutes) * 100)) : 3;
              return `<div class="chart-col ${date === today ? 'today' : ''}" title="${esc(fmtDate(date, { year: false }))}: ${formatMinutes(mins)}">
                <div class="chart-bar-wrap"><div class="chart-bar" style="height:${height}%"></div></div>
                <span class="chart-label">${esc(DAY_SHORT[(new Date(`${date}T00:00:00`).getDay() + 6) % 7] || '')}</span>
              </div>`;
            }).join('')}
          </div>
          <div class="chart-legend"><span>${weekSessions} session${weekSessions === 1 ? '' : 's'} completed</span><span>${formatMinutes(Math.round(weekTotal / 7))} daily avg</span></div>
        </div>
      </section>

      <section class="card span-2">
        <div class="card-head bordered">
          <div>
            <div class="card-title">${icon('clock')} Upcoming deadlines</div>
            <div class="card-sub">Nearest first · ${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}</div>
          </div>
          <a class="card-action" href="#/tasks">View all ${icon('arrowRight')}</a>
        </div>
        <div class="deadline-list">${upcomingMarkup}</div>
      </section>

      <section class="card">
        <div class="card-head bordered">
          <div>
            <div class="card-title">${icon('alert')} Overdue</div>
            <div class="card-sub">${overdue.length ? `${overdue.length} task${overdue.length === 1 ? '' : 's'} past due` : 'Nothing past due'}</div>
          </div>
        </div>
        <div class="card-body">${overdueMarkup}</div>
      </section>

      <section class="card span-3">
        <div class="card-head bordered">
          <div>
            <div class="card-title">${icon('target')} Course progress</div>
            <div class="card-sub">Task completion and weighted average per course</div>
          </div>
          <a class="card-action" href="#/courses">Manage courses ${icon('arrowRight')}</a>
        </div>
        <div class="card-body"><div class="course-progress-grid">${courseProgress}</div></div>
      </section>
    </div>`;

  root.onclick = (event) => {
    const quick = event.target.closest('[data-quick]');
    if (quick) {
      quickAdd(quick.dataset.quick);
      return;
    }
    if (event.target.closest('[data-seed-sample]')) {
      seedSample();
      return;
    }
    const editTask = event.target.closest('[data-dash-edit-task]');
    if (editTask) {
      openTaskModal(Store.get().tasks.find((t) => t.id === editTask.dataset.dashEditTask));
      return;
    }
    const done = event.target.closest('[data-dash-done]');
    if (done) {
      setTaskStatus(done.dataset.dashDone, 'done');
      return;
    }
    const courseEl = event.target.closest('[data-open-course]');
    if (courseEl) {
      openCourseDetail(courseEl.dataset.openCourse);
      return;
    }
    const classEl = event.target.closest('[data-dash-class]');
    if (classEl) openClassModal(Store.get().timetable.find((c) => c.id === classEl.dataset.dashClass));
  };

  root.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const courseEl = event.target.closest('[data-open-course]');
    if (!courseEl) return;
    event.preventDefault();
    openCourseDetail(courseEl.dataset.openCourse);
  };
}

async function seedSample() {
  const hasData = Store.get().courses.length || Store.get().tasks.length || Store.get().notes.length;
  const ok = await UI.confirm({
    title: 'Load optional sample semester?',
    message: 'This adds four example BSAI courses, deadlines, a weekly timetable, marks, study sessions and notes so you can explore the app.',
    note: hasData
      ? 'This REPLACES your current data. A safety copy is kept and can be restored from Settings.'
      : 'You can clear it at any time from Settings → Danger zone.',
    confirmLabel: 'Load sample semester',
    tone: 'primary',
  });
  if (!ok) return;
  if (hasData) {
    try {
      localStorage.setItem('semesteros.preimport.v1', JSON.stringify({ savedAt: new Date().toISOString(), data: Store.buildExport() }));
    } catch { /* best effort */ }
  }
  Store.seedSample();
  UI.toast('Sample semester loaded. Edit or clear it anytime.', 'success');
  window.location.hash = '#/dashboard';
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function bindShell() {
  const menuToggle = document.getElementById('menu-toggle');
  if (menuToggle) {
    menuToggle.innerHTML = icon('menu');
    menuToggle.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      setSidebar(!sidebar.classList.contains('open'));
    });
  }

  document.getElementById('scrim')?.addEventListener('click', () => setSidebar(false));

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = Store.settings.theme === 'dark' ? 'light' : 'dark';
      Store.updateSettings({ theme: next }, { silent: true });
      applyTheme(next);
    });
  }

  const quickBtn = document.getElementById('quick-add');
  const quickMenu = document.getElementById('quick-add-menu');
  if (quickBtn && quickMenu) {
    buildQuickMenu();
    quickBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = quickMenu.hidden;
      quickMenu.hidden = !willOpen;
      quickBtn.setAttribute('aria-expanded', String(willOpen));
    });
    quickMenu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-quick]');
      if (!item) return;
      closeQuickMenu();
      quickAdd(item.dataset.quick);
    });
    document.addEventListener('click', (event) => {
      if (quickMenu.hidden) return;
      if (quickMenu.contains(event.target) || quickBtn.contains(event.target)) return;
      closeQuickMenu();
    });
  }

  document.getElementById('bottom-nav')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-menu]')) setSidebar(true);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeQuickMenu();
      setSidebar(false);
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) {
      setSidebar(false);
      document.body.style.overflow = '';
    }
  });

  window.addEventListener('hashchange', routeChanged);

  window.addEventListener('semesteros:appearance', () => applyTheme(Store.settings.theme));
}

function boot() {
  Store.init();
  bindShell();
  applyTheme(Store.settings.theme);
  if (!window.location.hash) {
    history.replaceState(null, '', '#/dashboard');
  }
  currentRoute = parseRoute();
  updateTopbar(currentRoute);
  updateSidebar();
  updateStorageBanner();
  renderCurrent();
  previousRoute = currentRoute;

  Store.subscribe(() => {
    applyTheme(Store.settings.theme);
    renderCurrent();
  });

  registerServiceWorker();
}

boot();
