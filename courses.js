/**
 * courses.js — course CRUD plus the course detail view.
 */

import { Store } from './storage.js';
import {
  esc, uid, icon, UI, emptyState, field, colorField, setFormErrors,
  COURSE_COLORS, fmtDate, deadlineInfo, semesterContext, clamp, round,
} from './utils.js';
import { computeCourseGrade } from './grades.js';

/* ------------------------------------------------------------------ *
 * Derived data
 * ------------------------------------------------------------------ */

export function courseTasks(courseId) {
  return Store.get().tasks.filter((t) => t.courseId === courseId);
}

function courseNextDeadline(courseId) {
  const upcoming = courseTasks(courseId)
    .filter((t) => t.status !== 'done')
    .sort((a, b) => (a.dueDate + (a.dueTime || '')).localeCompare(b.dueDate + (b.dueTime || '')));
  return upcoming[0] || null;
}

function creditLabel(credits) {
  return `${round(credits, 1)} cr`;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function validateCourse(values, editingId) {
  const errors = {};
  const code = (values.code || '').trim();
  const name = (values.name || '').trim();
  if (!code) errors.code = 'A course code is required (for example BSAI-201).';
  else if (code.length > 20) errors.code = 'Keep the course code under 20 characters.';
  if (!name) errors.name = 'A course name is required.';
  if (code) {
    const clash = Store.get().courses.find((c) => c.id !== editingId && c.code.toLowerCase() === code.toLowerCase());
    if (clash) errors.code = `Another course already uses the code ${clash.code}.`;
  }
  const credits = Number(values.credits);
  if (values.credits === '' || Number.isNaN(credits)) errors.credits = 'Enter credit hours (use 0 if the course has none).';
  else if (credits < 0 || credits > 30) errors.credits = 'Credit hours must be between 0 and 30.';
  return { errors, code, name, credits };
}

/* ------------------------------------------------------------------ *
 * Modals
 * ------------------------------------------------------------------ */

export function openCourseModal(course = null) {
  const editing = Boolean(course);
  const body = `
    <div class="form-grid">
      ${field({ label: 'Course code', name: 'code', value: course?.code || '', placeholder: 'BSAI-201', required: true, span: 1 })}
      ${field({ label: 'Credit hours', name: 'credits', type: 'number', value: course ? course.credits : 3, min: 0, max: 30, step: 0.5, required: true, inputmode: 'decimal' })}
      <div class="span-2">${field({ label: 'Course name', name: 'name', value: course?.name || '', placeholder: 'Data Structures & Algorithms', required: true })}</div>
      <div class="span-2">${field({ label: 'Instructor (optional)', name: 'instructor', value: course?.instructor || '', placeholder: 'Dr. A. Rahman' })}</div>
      <div class="span-2">${colorField({ value: course?.color || COURSE_COLORS[Store.get().courses.length % COURSE_COLORS.length] })}</div>
    </div>
    <div class="form-hint-box">${icon('target')}<span>Credit hours are only used for GPA, and only once you configure a grade scale in Settings. Set them to 0 for pass/fail or non-credit courses.</span></div>`;

  UI.modal({
    title: editing ? 'Edit course' : 'Add a course',
    subtitle: editing ? `Updating ${course.code}` : 'Courses group your tasks, classes, grades and notes.',
    body,
    submitLabel: editing ? 'Save changes' : 'Add course',
    onSubmit(values, form) {
      const { errors, code, name, credits } = validateCourse(values, course?.id);
      if (Object.keys(errors).length) {
        setFormErrors(form, errors);
        return false;
      }
      const color = /^#[0-9a-fA-F]{6}$/.test(values.color || '') ? values.color : COURSE_COLORS[0];
      if (editing) {
        Store.update((state) => {
          const target = state.courses.find((c) => c.id === course.id);
          if (!target) return false;
          Object.assign(target, { code, name, instructor: (values.instructor || '').trim(), credits: clamp(credits, 0, 30), color });
        });
        UI.toast(`${code} updated.`, 'success');
      } else {
        Store.update((state) => {
          state.courses.push({
            id: uid('course'),
            code,
            name,
            instructor: (values.instructor || '').trim(),
            credits: clamp(credits, 0, 30),
            color,
            createdAt: new Date().toISOString(),
          });
        });
        UI.toast(`${code} added.`, 'success');
      }
      return true;
    },
  });
}

export function openCourseDetail(courseId) {
  const course = Store.getCourse(courseId);
  if (!course) {
    UI.toast('That course no longer exists.', 'error');
    return;
  }
  const tasks = courseTasks(courseId);
  const grade = computeCourseGrade(courseId);
  const classes = Store.get().timetable.filter((c) => c.courseId === courseId)
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  const notes = Store.get().notes.filter((n) => n.courseId === courseId);
  const done = tasks.filter((t) => t.status === 'done').length;

  const taskRows = tasks.length
    ? tasks
      .slice()
      .sort((a, b) => (a.dueDate + (a.dueTime || '')).localeCompare(b.dueDate + (b.dueTime || '')))
      .slice(0, 8)
      .map((t) => {
        const info = deadlineInfo(t.dueDate, t.dueTime, t.status);
        return `<div class="detail-row">
          <span class="dot ${info.tone === 'overdue' ? 'red' : info.tone === 'done' ? 'green' : 'amber'}"></span>
          <span class="main"><strong>${esc(t.title)}</strong><span>${esc(fmtDate(t.dueDate, { year: false }))} · ${esc(info.label)}</span></span>
        </div>`;
      })
      .join('')
    : '<div class="detail-empty">No assignments yet.</div>';

  const classRows = classes.length
    ? classes.map((c) => `<div class="detail-row">
        <span class="main"><strong>${esc(c.start)} – ${esc(c.end)}</strong><span>${esc(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][c.day - 1] || '')}${c.room ? ` · ${esc(c.room)}` : ''}</span></span>
      </div>`).join('')
    : '<div class="detail-empty">No weekly classes scheduled.</div>';

  const noteRows = notes.length
    ? notes.map((n) => `<div class="detail-row"><span class="main"><strong>${esc(n.title)}</strong><span>${esc((n.body || '').slice(0, 90))}</span></span></div>`).join('')
    : '<div class="detail-empty">No notes yet.</div>';

  const body = `
    <div class="course-detail-head">
      <span class="course-badge" style="background:${esc(course.color)}">${esc(course.code.slice(0, 3).toUpperCase())}</span>
      <div>
        <div style="font-weight:640;font-size:15px">${esc(course.name)}</div>
        <div class="subtle" style="font-size:12px">${esc(course.code)}${course.instructor ? ` · ${esc(course.instructor)}` : ''} · ${esc(creditLabel(course.credits))}</div>
      </div>
    </div>
    <div class="course-stats" style="margin-top:2px">
      <div>
        <div class="course-stat-label">Tasks complete</div>
        <div class="course-stat-value">${done}<small> / ${tasks.length}</small></div>
      </div>
      <div>
        <div class="course-stat-label">Current average</div>
        <div class="course-stat-value">${grade.weighted !== null ? `${round(grade.weighted, 1)}%` : '—'}</div>
      </div>
    </div>
    <div>
      <div class="detail-section-title">Assignments & assessments</div>
      <div class="detail-list">${taskRows}</div>
    </div>
    <div>
      <div class="detail-section-title">Weekly classes</div>
      <div class="detail-list">${classRows}</div>
    </div>
    <div>
      <div class="detail-section-title">Notes</div>
      <div class="detail-list">${noteRows}</div>
    </div>`;

  UI.modal({
    title: course.code,
    subtitle: course.name,
    body,
    submitLabel: 'Edit course',
    cancelLabel: 'Close',
    onSubmit() {
      openCourseModal(Store.getCourse(courseId));
      return true;
    },
  });
}

export async function confirmDeleteCourse(courseId) {
  const course = Store.getCourse(courseId);
  if (!course) return;
  const counts = {
    tasks: Store.get().tasks.filter((t) => t.courseId === courseId).length,
    classes: Store.get().timetable.filter((c) => c.courseId === courseId).length,
    grades: Store.get().grades.filter((g) => g.courseId === courseId).length,
    sessions: Store.get().studySessions.filter((s) => s.courseId === courseId).length,
    notes: Store.get().notes.filter((n) => n.courseId === courseId).length,
  };
  const attached = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${key}`)
    .join(', ');
  const ok = await UI.confirm({
    title: `Delete ${course.code}?`,
    message: `This permanently removes ${course.name} from your semester.`,
    note: attached
      ? `Also removed: ${attached}. There is no undo — export a backup first if you are unsure.`
      : 'This course has no linked records.',
    confirmLabel: 'Delete course',
    tone: 'danger',
  });
  if (!ok) return;
  Store.deleteCourse(courseId);
  UI.toast(`${course.code} and its records were deleted.`, 'success');
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

function courseCard(course) {
  const tasks = courseTasks(course.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const grade = computeCourseGrade(course.id);
  const next = courseNextDeadline(course.id);
  const nextInfo = next ? deadlineInfo(next.dueDate, next.dueTime, next.status) : null;
  const gradeLabel = grade.weighted !== null ? `${round(grade.weighted, 1)}%` : '—';
  const classes = Store.get().timetable.filter((c) => c.courseId === course.id).length;

  return `<article class="course-card" data-open-course="${esc(course.id)}" tabindex="0" role="button" aria-label="Open ${esc(course.code)} ${esc(course.name)}">
    <div class="course-stripe" style="background:${esc(course.color)}"></div>
    <div class="course-card-inner">
      <div class="course-top">
        <div style="min-width:0">
          <div class="course-code"><span class="dot" style="background:${esc(course.color)}"></span>${esc(course.code)}</div>
          <div class="course-name">${esc(course.name)}</div>
          <div class="course-instructor">${course.instructor ? esc(course.instructor) : 'No instructor set'} · ${esc(creditLabel(course.credits))}</div>
        </div>
        <div class="course-actions">
          <button class="icon-btn" data-edit-course="${esc(course.id)}" title="Edit course" aria-label="Edit ${esc(course.code)}">${icon('pencil')}</button>
          <button class="icon-btn danger" data-delete-course="${esc(course.id)}" title="Delete course" aria-label="Delete ${esc(course.code)}">${icon('trash')}</button>
        </div>
      </div>

      <div class="course-meta">
        <span class="chip">${icon('book')}${classes} class${classes === 1 ? '' : 'es'}/week</span>
        <span class="chip ${grade.weighted === null ? '' : grade.weighted >= 75 ? 'green' : grade.weighted >= 60 ? 'amber' : 'red'}">${icon('award')}${gradeLabel}</span>
      </div>

      <div>
        <div class="progress-meta"><span>Task progress</span><strong>${done}/${tasks.length || 0}</strong></div>
        <div class="progress"><div class="progress-bar ${pct === 100 && tasks.length ? 'green' : ''}" style="width:${pct}%"></div></div>
      </div>

      <div class="course-stats">
        <div>
          <div class="course-stat-label">Next deadline</div>
          <div style="font-size:12px;font-weight:580;margin-top:3px" class="${nextInfo?.tone === 'overdue' ? 'overdue-text' : ''}">${next ? esc(next.title) : 'Nothing due'}</div>
        </div>
        <div>
          <div class="course-stat-label">Due</div>
          <div class="course-stat-value" style="font-size:12.5px">${next && nextInfo ? esc(nextInfo.label) : '—'}</div>
        </div>
      </div>
    </div>
  </article>`;
}

export const CoursesView = {
  render(root) {
    const { courses } = Store.get();
    const ctx = semesterContext(Store.settings);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${icon('book')} Courses</p>
          <h2>Your semester courses</h2>
          <p class="lede">${courses.length
            ? `${courses.length} course${courses.length === 1 ? '' : 's'}${ctx.week ? ` · week ${esc(ctx.week)} of ${esc(ctx.totalWeeks)}` : ''}. Tap a card to see its assignments, classes and notes.`
            : 'Add the courses you are enrolled in. Everything else in SemesterOS hangs off them.'}</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" data-new-course>${icon('plus')} Add course</button>
        </div>
      </div>
      ${courses.length
        ? `<div class="course-grid">${courses.map(courseCard).join('')}</div>`
        : `<div class="card card-pad">${emptyState({
          iconName: 'book',
          title: 'No courses yet',
          body: 'Create your first course, then add its assignments, weekly classes and notes.',
          action: '<button class="btn primary" data-new-course>' + icon('plus') + ' Add your first course</button>',
        })}</div>`}`;

    root.onclick = (event) => {
      const editBtn = event.target.closest('[data-edit-course]');
      if (editBtn) {
        event.stopPropagation();
        openCourseModal(Store.getCourse(editBtn.dataset.editCourse));
        return;
      }
      const delBtn = event.target.closest('[data-delete-course]');
      if (delBtn) {
        event.stopPropagation();
        confirmDeleteCourse(delBtn.dataset.deleteCourse);
        return;
      }
      const newBtn = event.target.closest('[data-new-course]');
      if (newBtn) {
        openCourseModal();
        return;
      }
      const card = event.target.closest('[data-open-course]');
      if (card) openCourseDetail(card.dataset.openCourse);
    };

    root.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('[data-open-course]');
      if (!card) return;
      event.preventDefault();
      openCourseDetail(card.dataset.openCourse);
    };
  },
};
