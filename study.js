/**
 * study.js — Pomodoro timer and study planner.
 *
 * Timer correctness:
 *  - remaining time is derived from a target timestamp, so throttled tabs and
 *    sleep/wake do not drift.
 *  - a focus phase is logged exactly once, at completion. Pausing, resetting or
 *    navigating away never logs time, and completing a planned session only
 *    flips its status — so the same minutes are never counted twice.
 */

import { Store } from './storage.js';
import {
  esc, uid, icon, UI, emptyState, field, selectField, setFormErrors,
  todayISO, isValidDate, isValidTime, fmtDate, startOfWeek, addDays, isoOf,
  formatMinutes, clamp, DAY_NAMES,
} from './utils.js';

const R = 92;
const CIRC = 2 * Math.PI * R;
const MODE_LABELS = { focus: 'Focus', short: 'Short break', long: 'Long break' };

const timer = {
  mode: 'focus',
  total: 25 * 60,
  remaining: 25 * 60,
  running: false,
  endAt: null,
  completedFocus: 0,
  courseId: '',
};

let ticker = null;

function durationFor(mode) {
  const p = Store.settings.pomodoro;
  if (mode === 'short') return clamp(p.shortBreak, 1, 60) * 60;
  if (mode === 'long') return clamp(p.longBreak, 1, 90) * 60;
  return clamp(p.focus, 1, 180) * 60;
}

function setMode(mode, { reset = true } = {}) {
  timer.mode = mode;
  timer.total = durationFor(mode);
  if (reset) timer.remaining = timer.total;
  timer.running = false;
  timer.endAt = null;
  updateDocumentTitle();
  renderTimerUI();
}

/** Called after settings change so idle timers pick up new durations. */
export function syncTimerSettings() {
  if (timer.running) return;
  const idleAtStart = timer.remaining === timer.total;
  timer.total = durationFor(timer.mode);
  timer.remaining = idleAtStart ? timer.total : Math.min(timer.remaining, timer.total);
  renderTimerUI();
}

function updateDocumentTitle() {
  if (timer.running) {
    const m = Math.floor(timer.remaining / 60);
    const s = String(timer.remaining % 60).padStart(2, '0');
    document.title = `${m}:${s} · ${MODE_LABELS[timer.mode]} — SemesterOS`;
  } else if (document.title.includes('— SemesterOS')) {
    document.title = 'SemesterOS';
  }
}

function logFocusSession() {
  const minutes = Math.round(timer.total / 60);
  const course = timer.courseId ? Store.getCourse(timer.courseId) : null;
  Store.update((state) => {
    state.studySessions.push({
      id: uid('session'),
      courseId: course ? course.id : null,
      title: 'Pomodoro focus',
      date: todayISO(),
      start: '',
      minutes,
      status: 'completed',
      source: 'pomodoro',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  });
  UI.toast(`${minutes} minutes logged${course ? ` for ${course.code}` : ''}. Take a breath.`, 'success');
}

function completePhase() {
  if (!timer.running) return;
  timer.running = false;
  timer.endAt = null;
  timer.remaining = 0;
  const finishedMode = timer.mode;
  if (finishedMode === 'focus') {
    timer.completedFocus += 1;
    logFocusSession();
    const every = clamp(Store.settings.pomodoro.longBreakEvery, 1, 12);
    setMode(timer.completedFocus % every === 0 ? 'long' : 'short');
  } else {
    UI.toast('Break finished. Ready for another focus block?', 'info');
    setMode('focus');
  }
  renderTimerUI();
  updateDocumentTitle();
}

function startTimer() {
  if (timer.running) return;
  if (timer.remaining <= 0) timer.remaining = timer.total;
  timer.endAt = Date.now() + timer.remaining * 1000;
  timer.running = true;
  updateDocumentTitle();
  renderTimerUI();
}

function pauseTimer() {
  if (!timer.running) return;
  timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  timer.running = false;
  timer.endAt = null;
  updateDocumentTitle();
  renderTimerUI();
}

function resetTimer() {
  timer.running = false;
  timer.endAt = null;
  timer.remaining = timer.total;
  updateDocumentTitle();
  renderTimerUI();
}

function toggleTimer() {
  if (timer.running) pauseTimer();
  else startTimer();
}

function tick() {
  if (timer.running) {
    const seconds = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    timer.remaining = seconds;
    if (seconds <= 0) {
      completePhase();
    } else {
      renderTimerUI();
    }
  }
}

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(tick, 250);
}

function renderTimerUI() {
  ensureTicker();
  const timeEl = document.getElementById('pomo-time');
  if (!timeEl) return;
  const minutes = Math.floor(timer.remaining / 60);
  const seconds = String(timer.remaining % 60).padStart(2, '0');
  timeEl.textContent = `${String(minutes).padStart(2, '0')}:${seconds}`;

  const phaseEl = document.getElementById('pomo-phase');
  if (phaseEl) {
    phaseEl.textContent = timer.mode === 'focus'
      ? `Focus ${timer.completedFocus > 0 ? `· ${timer.completedFocus} done` : ''}`
      : MODE_LABELS[timer.mode];
  }

  const ring = document.querySelector('.pomo-ring');
  if (ring) ring.classList.toggle('break', timer.mode !== 'focus');
  const fill = document.getElementById('pomo-fill');
  if (fill) {
    const progress = timer.total ? 1 - timer.remaining / timer.total : 0;
    fill.style.strokeDashoffset = String(CIRC * (1 - progress));
  }

  const toggleBtn = document.getElementById('pomo-toggle');
  if (toggleBtn) {
    const label = timer.running ? 'Pause' : timer.remaining < timer.total && timer.remaining > 0 ? 'Resume' : 'Start';
    toggleBtn.innerHTML = `${icon(timer.running ? 'pause' : 'play')} <span>${label}</span>`;
    toggleBtn.setAttribute('aria-label', `${label} ${MODE_LABELS[timer.mode].toLowerCase()} timer`);
  }

  const dots = document.querySelectorAll('.pomo-cycle i');
  if (dots.length) {
    const every = clamp(Store.settings.pomodoro.longBreakEvery, 1, 12);
    const filled = timer.completedFocus % every;
    dots.forEach((dot, index) => {
      dot.classList.toggle('on', index < filled || (filled === 0 && timer.completedFocus > 0 && index === every - 1));
    });
  }

  const modeButtons = document.querySelectorAll('[data-pomo-mode]');
  modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.pomoMode === timer.mode));
}

/* ------------------------------------------------------------------ *
 * Planner actions
 * ------------------------------------------------------------------ */

export function openSessionModal(session = null) {
  const editing = Boolean(session);
  const courses = Store.get().courses;
  const body = `
    <div class="form-grid">
      ${selectField({
        label: 'Course', name: 'courseId', value: session?.courseId || '',
        options: courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
        placeholder: courses.length ? 'General study' : 'No courses yet',
      })}
      ${field({ label: 'Date', name: 'date', type: 'date', value: session?.date || todayISO(), required: true })}
      <div class="span-2">${field({ label: 'What will you study?', name: 'title', value: session?.title || '', placeholder: 'e.g. Review graph traversal proofs', required: true })}</div>
      ${field({ label: 'Start time (optional)', name: 'start', type: 'time', value: session?.start || '' })}
      ${field({ label: 'Planned minutes', name: 'minutes', type: 'number', value: session ? session.minutes : 45, min: 1, max: 1440, step: 5, required: true, inputmode: 'numeric' })}
    </div>
    <div class="form-hint-box">${icon('timer')}<span>Planning is separate from tracking. A planned session only counts toward study time after you mark it complete — and it can never be counted twice.</span></div>`;

  UI.modal({
    title: editing ? 'Edit study session' : 'Plan a study session',
    subtitle: editing ? 'Adjust the plan before you study.' : 'Block out focused time for a course.',
    body,
    submitLabel: editing ? 'Save changes' : 'Plan session',
    onSubmit(values, form) {
      const errors = {};
      if (!values.title) errors.title = 'Describe what you plan to study.';
      if (!isValidDate(values.date)) errors.date = 'Choose a valid date.';
      if (values.start && !isValidTime(values.start)) errors.start = 'Enter a valid time or leave it blank.';
      const minutes = Number(values.minutes);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) errors.minutes = 'Duration must be between 1 and 1440 minutes.';
      if (values.courseId && !Store.getCourse(values.courseId)) errors.courseId = 'That course no longer exists.';
      if (Object.keys(errors).length) {
        setFormErrors(form, errors);
        return false;
      }
      const clean = {
        courseId: values.courseId || null,
        title: values.title,
        date: values.date,
        start: values.start || '',
        minutes: Math.round(minutes),
      };
      if (editing) {
        Store.update((state) => {
          const target = state.studySessions.find((s) => s.id === session.id);
          if (!target) return false;
          Object.assign(target, clean);
        });
        UI.toast('Study session updated.', 'success');
      } else {
        Store.update((state) => {
          state.studySessions.push({
            id: uid('session'),
            ...clean,
            status: 'planned',
            source: 'planner',
            createdAt: new Date().toISOString(),
            completedAt: null,
          });
        });
        UI.toast('Study session planned.', 'success');
      }
      return true;
    },
  });
}

function toggleSessionComplete(id) {
  const session = Store.get().studySessions.find((s) => s.id === id);
  if (!session) return;
  if (session.status === 'completed') {
    Store.update((state) => {
      const target = state.studySessions.find((s) => s.id === id);
      if (!target) return false;
      target.status = 'planned';
      target.completedAt = null;
    });
    UI.toast('Session reopened — its minutes are no longer counted.');
    return;
  }
  Store.update((state) => {
    const target = state.studySessions.find((s) => s.id === id);
    if (!target || target.status === 'completed') return false;
    target.status = 'completed';
    target.completedAt = new Date().toISOString();
  });
  UI.toast(`${session.minutes} minutes logged.`, 'success');
}

async function deleteSession(id) {
  const session = Store.get().studySessions.find((s) => s.id === id);
  if (!session) return;
  const ok = await UI.confirm({
    title: 'Delete study session?',
    message: `"${session.title}" on ${fmtDate(session.date, { year: false })} will be removed.`,
    note: session.status === 'completed' ? 'Its minutes will be removed from your weekly study total.' : '',
    confirmLabel: 'Delete session',
  });
  if (!ok) return;
  Store.update((state) => { state.studySessions = state.studySessions.filter((s) => s.id !== id); });
  UI.toast('Study session deleted.', 'success');
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

function sessionRow(session) {
  const course = Store.getCourse(session.courseId);
  const done = session.status === 'completed';
  const weekday = session.date ? DAY_NAMES[(new Date(`${session.date}T00:00:00`).getDay() + 6) % 7] : '';
  return `<div class="session-row ${done ? 'done' : ''}">
    <button class="session-check ${done ? 'done' : ''}" data-toggle-session="${esc(session.id)}" aria-label="${done ? 'Reopen' : 'Mark complete'}">
      ${icon('check')}
    </button>
    <div class="session-main">
      <div class="session-title">${esc(session.title)}</div>
      <div class="session-meta">
        <span class="course-pill"><span class="dot" style="background:${esc(course?.color || '#6a7695')}"></span>${esc(course?.code || 'General')}</span>
        <span>·</span>
        <span>${esc(weekday)} ${esc(fmtDate(session.date, { year: false }))}${session.start ? ` · ${esc(session.start)}` : ''}</span>
        ${session.source === 'pomodoro' ? '<span>· timer</span>' : ''}
      </div>
    </div>
    <span class="session-minutes">${done ? formatMinutes(session.minutes) : `plan ${formatMinutes(session.minutes)}`}</span>
    <div class="session-actions">
      <button class="icon-btn" data-edit-session="${esc(session.id)}" aria-label="Edit session" title="Edit">${icon('pencil')}</button>
      <button class="icon-btn danger" data-delete-session="${esc(session.id)}" aria-label="Delete session" title="Delete">${icon('trash')}</button>
    </div>
  </div>`;
}

export const StudyView = {
  render(root) {
    ensureTicker();
    const data = Store.get();
    const now = new Date();
    const weekStartDate = startOfWeek(now, data.settings.weekStart);
    const weekStartISO = isoOf(weekStartDate);
    const weekEndISO = isoOf(addDays(weekStartDate, 6));
    const today = todayISO();
    const courses = data.courses;

    const completedThisWeek = data.studySessions.filter((s) => s.status === 'completed' && s.date >= weekStartISO && s.date <= weekEndISO);
    const weekMinutes = completedThisWeek.reduce((sum, s) => sum + s.minutes, 0);
    const planned = data.studySessions.filter((s) => s.status === 'planned').sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    const upcomingPlanned = planned.filter((s) => s.date >= today);
    const plannedMinutes = upcomingPlanned.reduce((sum, s) => sum + s.minutes, 0);
    const recentCompleted = data.studySessions
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '') || b.date.localeCompare(a.date))
      .slice(0, 6);

    const byCourse = new Map();
    for (const session of completedThisWeek) {
      const key = session.courseId || '__none';
      byCourse.set(key, (byCourse.get(key) || 0) + session.minutes);
    }
    const breakdown = [...byCourse.entries()]
      .map(([id, minutes]) => ({ id, minutes, course: id === '__none' ? null : Store.getCourse(id) }))
      .sort((a, b) => b.minutes - a.minutes);
    const maxBreakdown = Math.max(1, ...breakdown.map((b) => b.minutes));

    if (timer.courseId && !Store.getCourse(timer.courseId)) timer.courseId = '';
    if (!timer.running) {
      const wasFresh = timer.remaining === timer.total;
      timer.total = durationFor(timer.mode);
      if (wasFresh) timer.remaining = timer.total;
    }

    const progress = timer.total ? 1 - timer.remaining / timer.total : 0;
    const every = clamp(data.settings.pomodoro.longBreakEvery, 1, 12);
    const dots = Array.from({ length: every }, (_, i) => `<i class="${i < timer.completedFocus % every ? 'on' : ''}"></i>`).join('');

    const sessionList = (list, emptyTitle, emptyBody) => (list.length
      ? `<div class="session-list">${list.map(sessionRow).join('')}</div>`
      : emptyState({ iconName: 'timer', title: emptyTitle, body: emptyBody }));

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${icon('timer')} Study planner</p>
          <h2>Focus now, finish calm</h2>
          <p class="lede">${formatMinutes(weekMinutes)} studied this week · ${formatMinutes(plannedMinutes)} planned ahead.</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" data-new-session>${icon('plus')} Plan session</button>
        </div>
      </div>

      <div class="study-grid">
        <section class="card pomo-card" aria-label="Pomodoro timer">
          <div class="pomo-modes" role="tablist">
            ${['focus', 'short', 'long'].map((mode) => `<button data-pomo-mode="${mode}" class="${timer.mode === mode ? 'active' : ''}" role="tab" aria-selected="${timer.mode === mode}">${MODE_LABELS[mode]}</button>`).join('')}
          </div>

          <div class="pomo-ring-wrap">
            <svg class="pomo-ring ${timer.mode !== 'focus' ? 'break' : ''}" viewBox="0 0 208 208" aria-hidden="true">
              <circle class="track" cx="104" cy="104" r="${R}"></circle>
              <circle class="fill" id="pomo-fill" cx="104" cy="104" r="${R}"
                stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${(CIRC * (1 - progress)).toFixed(2)}"></circle>
            </svg>
            <div class="pomo-center">
              <div class="pomo-time" id="pomo-time" aria-live="off">${String(Math.floor(timer.remaining / 60)).padStart(2, '0')}:${String(timer.remaining % 60).padStart(2, '0')}</div>
              <div class="pomo-phase" id="pomo-phase">${MODE_LABELS[timer.mode]}</div>
              <div class="pomo-cycle" aria-hidden="true">${dots}</div>
            </div>
          </div>

          <div class="pomo-controls">
            <button class="btn primary" id="pomo-toggle" data-pomo-toggle aria-label="Start timer">
              ${icon(timer.running ? 'pause' : 'play')} <span>${timer.running ? 'Pause' : 'Start'}</span>
            </button>
            <button class="btn ghost icon-only" data-pomo-reset aria-label="Reset timer" title="Reset">${icon('reset')}</button>
          </div>

          <div class="pomo-course">
            ${selectField({
              label: 'Log focus sessions to', name: 'pomoCourse',
              value: timer.courseId,
              placeholder: 'General study',
              options: courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
              hint: 'Each completed focus block is logged once, when the timer reaches zero.',
            })}
          </div>
          <p class="pomo-tip">${data.settings.pomodoro.focus} min focus · ${data.settings.pomodoro.shortBreak} min short break · ${data.settings.pomodoro.longBreak} min long break every ${every} sessions. <button class="link-btn" data-go-settings>Adjust</button></p>
        </section>

        <div>
          <section class="card card-pad" aria-label="Weekly study">
            <div class="planner-head">
              <div>
                <div class="card-title">${icon('target')} This week</div>
                <div class="card-sub">Completed focus time, ${esc(fmtDate(weekStartISO, { year: false }))} – ${esc(fmtDate(weekEndISO, { year: false }))}</div>
              </div>
            </div>
            <div class="study-stats">
              <div class="study-stat"><div class="v">${formatMinutes(weekMinutes)}</div><div class="l">Studied</div></div>
              <div class="study-stat"><div class="v">${completedThisWeek.length}</div><div class="l">Sessions</div></div>
              <div class="study-stat"><div class="v">${formatMinutes(plannedMinutes)}</div><div class="l">Planned ahead</div></div>
            </div>
            <div class="study-breakdown">
              ${breakdown.length
                ? breakdown.map((row) => `<div class="breakdown-row">
                    <span class="breakdown-name"><span class="dot" style="background:${esc(row.course?.color || '#6a7695')}"></span><span>${esc(row.course?.code || 'General')}</span></span>
                    <span class="breakdown-bar"><i style="width:${Math.round((row.minutes / maxBreakdown) * 100)}%;--c:${esc(row.course?.color || '#6a7695')}"></i></span>
                    <span class="breakdown-val">${formatMinutes(row.minutes)}</span>
                  </div>`).join('')
                : '<p class="settings-note">Complete a Pomodoro or mark a planned session done to see your weekly split.</p>'}
            </div>
          </section>

          <section class="card" style="margin-top:16px" aria-label="Study plan">
            <div class="card-head bordered">
              <div>
                <div class="card-title">${icon('calendar')} Planned sessions</div>
                <div class="card-sub">${planned.length ? `${planned.length} session${planned.length === 1 ? '' : 's'} waiting` : 'Nothing planned yet'}</div>
              </div>
              <button class="btn small" data-new-session>${icon('plus')} Plan</button>
            </div>
            <div class="card-body" style="padding-top:14px">
              ${sessionList(planned, 'No study sessions planned', 'Plan a block for a course, then mark it complete after you study.')}
            </div>
          </section>

          ${recentCompleted.length ? `<section class="card" style="margin-top:16px" aria-label="Recent study">
            <div class="card-head bordered">
              <div><div class="card-title">${icon('check')} Recently completed</div><div class="card-sub">Already counted in your totals</div></div>
            </div>
            <div class="card-body" style="padding-top:14px">
              <div class="session-list">${recentCompleted.map(sessionRow).join('')}</div>
            </div>
          </section>` : ''}
        </div>
      </div>`;

    root.onclick = (event) => {
      const modeBtn = event.target.closest('[data-pomo-mode]');
      if (modeBtn) {
        if (timer.running) UI.toast('Timer reset — switching modes stops the current phase.', 'warn');
        setMode(modeBtn.dataset.pomoMode);
        return;
      }
      if (event.target.closest('[data-pomo-toggle]')) { toggleTimer(); return; }
      if (event.target.closest('[data-pomo-reset]')) { resetTimer(); return; }
      const toggle = event.target.closest('[data-toggle-session]');
      if (toggle) { toggleSessionComplete(toggle.dataset.toggleSession); return; }
      const edit = event.target.closest('[data-edit-session]');
      if (edit) { openSessionModal(Store.get().studySessions.find((s) => s.id === edit.dataset.editSession)); return; }
      const del = event.target.closest('[data-delete-session]');
      if (del) { deleteSession(del.dataset.deleteSession); return; }
      if (event.target.closest('[data-new-session]')) { openSessionModal(); return; }
      if (event.target.closest('[data-go-settings]')) window.location.hash = '#/settings';
    };

    const courseSelect = root.querySelector('select[name="pomoCourse"]');
    if (courseSelect) {
      courseSelect.addEventListener('change', () => {
        timer.courseId = courseSelect.value;
      });
    }

    renderTimerUI();
  },
};
