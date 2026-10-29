/**
 * timetable.js — Monday-to-Sunday class schedule with overlap detection.
 * Day indexes are ISO weekdays (Monday = 1 … Sunday = 7) so the data does not
 * change when the user switches their week-start preference.
 */

import { Store } from './storage.js';
import {
  esc, uid, icon, UI, emptyState, field, selectField, setFormErrors,
  DAY_NAMES, DAY_SHORT, todayISO, startOfWeek, isoOf, addDays,
  timeToMinutes, fmtTime12, isValidTime,
} from './utils.js';
import { openCourseModal } from './courses.js';

const HOUR_PX = 56;

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

export function findOverlaps(entries) {
  const byDay = new Map();
  for (const entry of entries) {
    if (!byDay.has(entry.day)) byDay.set(entry.day, []);
    byDay.get(entry.day).push(entry);
  }
  const ids = new Set();
  const conflicts = [];
  for (const [day, list] of byDay) {
    const sorted = list.slice().sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i];
        const b = sorted[j];
        if (b.start >= a.end) break;
        if (a.start < b.end && b.start < a.end) {
          ids.add(a.id);
          ids.add(b.id);
          conflicts.push({ day, a, b });
        }
      }
    }
  }
  return { ids, conflicts };
}

function layoutColumns(entries) {
  const sorted = entries.slice().sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const clusters = [];
  let current = null;
  for (const entry of sorted) {
    const start = timeToMinutes(entry.start);
    const end = timeToMinutes(entry.end);
    if (!current || start >= current.maxEnd) {
      current = { items: [], maxEnd: end };
      clusters.push(current);
    }
    current.maxEnd = Math.max(current.maxEnd, end);
    current.items.push(entry);
  }
  const placements = new Map();
  for (const cluster of clusters) {
    const colEnds = [];
    const assigned = [];
    for (const entry of cluster.items) {
      const start = timeToMinutes(entry.start);
      let col = colEnds.findIndex((end) => end <= start);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(timeToMinutes(entry.end));
      } else {
        colEnds[col] = timeToMinutes(entry.end);
      }
      assigned.push({ entry, col });
    }
    for (const { entry, col } of assigned) placements.set(entry.id, { col, cols: colEnds.length });
  }
  return placements;
}

function gridBounds(entries) {
  if (!entries.length) return { minHour: 8, maxHour: 19 };
  let min = 24 * 60;
  let max = 0;
  for (const entry of entries) {
    min = Math.min(min, timeToMinutes(entry.start) ?? min);
    max = Math.max(max, timeToMinutes(entry.end) ?? max);
  }
  const minHour = Math.max(0, Math.min(8, Math.floor(min / 60)));
  const maxHour = Math.min(24, Math.max(19, Math.ceil(max / 60)));
  return { minHour, maxHour };
}

function orderedDays() {
  return Store.settings.weekStart === 0 ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
}

function hourLabel(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

export function openClassModal(entry = null) {
  const courses = Store.get().courses;
  if (!courses.length) {
    UI.modal({
      title: 'Add a course first',
      subtitle: 'Weekly classes belong to a course.',
      body: `<div class="form-hint-box">${icon('book')}<span>You do not have any courses yet. Create one, then come back and add its weekly schedule.</span></div>`,
      submitLabel: 'Add a course',
      onSubmit() {
        openCourseModal();
        return true;
      },
    });
    return;
  }

  const editing = Boolean(entry);
  const body = `
    <div class="form-grid">
      <div class="span-2">${selectField({
        label: 'Course', name: 'courseId', required: true,
        value: entry?.courseId || courses[0].id,
        options: courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
      })}</div>
      ${selectField({
        label: 'Day', name: 'day', required: true,
        value: entry?.day || 1,
        options: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: DAY_NAMES[d - 1] })),
      })}
      ${field({ label: 'Room (optional)', name: 'room', value: entry?.room || '', placeholder: 'CS-104' })}
      ${field({ label: 'Start time', name: 'start', type: 'time', value: entry?.start || '09:00', required: true })}
      ${field({ label: 'End time', name: 'end', type: 'time', value: entry?.end || '10:00', required: true })}
      <div class="span-2">${field({ label: 'Instructor for this class (optional)', name: 'instructor', value: entry?.instructor || '', placeholder: 'Leave blank to use the course instructor' })}</div>
    </div>
    <div class="overlap-banner" data-overlap-warning hidden></div>
    ${editing ? `<div style="display:flex;justify-content:flex-start"><button type="button" class="btn danger small" data-delete-this-class>${icon('trash')} Remove this class</button></div>` : ''}`;

  const modal = UI.modal({
    title: editing ? 'Edit class' : 'Add a class',
    subtitle: editing ? 'Change the day, time, room or instructor.' : 'Add a recurring weekly class to your timetable.',
    body,
    submitLabel: editing ? 'Save changes' : 'Add class',
    onSubmit(values, form) {
      const errors = {};
      if (!Store.getCourse(values.courseId)) errors.courseId = 'Choose an existing course.';
      const day = Number(values.day);
      if (!Number.isInteger(day) || day < 1 || day > 7) errors.day = 'Choose a weekday.';
      if (!isValidTime(values.start)) errors.start = 'Enter a valid start time.';
      if (!isValidTime(values.end)) errors.end = 'Enter a valid end time.';
      if (isValidTime(values.start) && isValidTime(values.end) && values.start >= values.end) {
        errors.end = 'The class must end after it starts.';
      }
      if (Object.keys(errors).length) {
        setFormErrors(form, errors);
        return false;
      }
      const clean = {
        courseId: values.courseId,
        day,
        start: values.start,
        end: values.end,
        room: (values.room || '').trim(),
        instructor: (values.instructor || '').trim(),
      };
      if (editing) {
        Store.update((state) => {
          const target = state.timetable.find((c) => c.id === entry.id);
          if (!target) return false;
          Object.assign(target, clean);
        });
        UI.toast('Class updated.', 'success');
      } else {
        Store.update((state) => {
          state.timetable.push({ id: uid('class'), ...clean });
        });
        UI.toast('Class added to your timetable.', 'success');
      }
      return true;
    },
  });

  if (!modal) return;
  const { overlay, form } = modal;
  const removeBtn = overlay.querySelector('[data-delete-this-class]');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      UI.closeModal();
      deleteClass(entry.id);
    });
  }
  const warning = overlay.querySelector('[data-overlap-warning]');
  const check = () => {
    if (!warning) return;
    const day = Number(form.elements.day.value);
    const start = form.elements.start.value;
    const end = form.elements.end.value;
    if (![start, end].every(isValidTime) || start >= end) {
      warning.hidden = true;
      return;
    }
    const clashes = Store.get().timetable.filter((c) => c.id !== entry?.id
      && c.day === day
      && start < c.end && end > c.start);
    if (!clashes.length) {
      warning.hidden = true;
      warning.innerHTML = '';
      return;
    }
    const names = clashes.map((c) => {
      const course = Store.getCourse(c.courseId);
      return `${course ? course.code : 'Class'} ${fmtTime12(c.start)}–${fmtTime12(c.end)}`;
    });
    warning.hidden = false;
    warning.innerHTML = `${icon('alert')}<div><strong>Overlaps an existing class.</strong>
      <ul>${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <div class="subtle" style="margin-top:4px">You can still save, but the timetable will flag the conflict.</div></div>`;
  };
  form.addEventListener('input', check);
  form.addEventListener('change', check);
  check();
}

export async function deleteClass(id) {
  const entry = Store.get().timetable.find((c) => c.id === id);
  if (!entry) return;
  const course = Store.getCourse(entry.courseId);
  const ok = await UI.confirm({
    title: 'Remove class?',
    message: `${course ? `${course.code} · ` : ''}${DAY_NAMES[entry.day - 1]} ${fmtTime12(entry.start)}–${fmtTime12(entry.end)} will be removed from your weekly timetable.`,
    confirmLabel: 'Remove class',
  });
  if (!ok) return;
  Store.update((state) => { state.timetable = state.timetable.filter((c) => c.id !== id); });
  UI.toast('Class removed.', 'success');
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

function blockMarkup(entry, placement, conflictIds, minHour) {
  const course = Store.getCourse(entry.courseId);
  const color = course?.color || '#7c6cff';
  const start = timeToMinutes(entry.start);
  const end = timeToMinutes(entry.end);
  const top = ((start - minHour * 60) / 60) * HOUR_PX;
  const height = Math.max(26, ((end - start) / 60) * HOUR_PX - 3);
  const { col, cols } = placement;
  const width = 100 / cols;
  const left = `calc(${col * width}% + 3px)`;
  const w = `calc(${width}% - 6px)`;
  const overlap = conflictIds.has(entry.id);
  const title = `${course ? `${course.code} — ${course.name}` : 'Class'}\n${fmtTime12(entry.start)}–${fmtTime12(entry.end)}${entry.room ? `\nRoom ${entry.room}` : ''}`;
  return `<button class="tt-block ${overlap ? 'is-overlap' : ''}" style="top:${top}px;height:${height}px;left:${left};width:${w};--c:${esc(color)}" data-edit-class="${esc(entry.id)}" title="${esc(title)}">
    <strong>${esc(course?.code || 'Class')}</strong>
    <span>${esc(fmtTime12(entry.start))}${entry.room ? ` · ${esc(entry.room)}` : ''}</span>
    ${height > 58 ? `<span class="tt-block-time">${esc(course?.name || '')}</span>` : ''}
  </button>`;
}

export const TimetableView = {
  render(root) {
    const { timetable } = Store.get();
    const { ids: conflictIds, conflicts } = findOverlaps(timetable);
    const { minHour, maxHour } = gridBounds(timetable);
    const days = orderedDays();
    const weekStartDate = startOfWeek(new Date(), Store.settings.weekStart);
    const today = todayISO();
    const perDay = new Map(days.map((d) => [d, []]));
    for (const entry of timetable) perDay.get(entry.day)?.push(entry);

    const headCells = days.map((day, index) => {
      const date = addDays(weekStartDate, index);
      const iso = isoOf(date);
      const isToday = iso === today;
      return `<div class="tt-head-cell ${isToday ? 'today' : ''}">${DAY_SHORT[day - 1]}<span>${esc(date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span></div>`;
    }).join('');

    const hours = [];
    for (let h = minHour; h <= maxHour; h += 1) hours.push(h);

    const hourColumn = `<div class="tt-hours" style="height:${(maxHour - minHour) * HOUR_PX}px">
      ${hours.map((h) => `<div class="tt-hour"><span>${hourLabel(h)}</span></div>`).join('')}
    </div>`;

    const columns = days.map((day, index) => {
      const entries = perDay.get(day) || [];
      const placements = layoutColumns(entries);
      const isToday = isoOf(addDays(weekStartDate, index)) === today;
      const lines = hours.map(() => '<div class="tt-hourline"></div>').join('');
      return `<div class="tt-col ${isToday ? 'today' : ''}" data-day-col="${day}" style="height:${(maxHour - minHour) * HOUR_PX}px">
        ${lines}
        ${entries.map((entry) => blockMarkup(entry, placements.get(entry.id) || { col: 0, cols: 1 }, conflictIds, minHour)).join('')}
      </div>`;
    }).join('');

    const agenda = days.map((day, index) => {
      const date = addDays(weekStartDate, index);
      const isToday = isoOf(date) === today;
      const entries = (perDay.get(day) || []).slice().sort((a, b) => a.start.localeCompare(b.start));
      return `<div class="agenda-day">
        <div class="agenda-day-head ${isToday ? 'today' : ''}">
          <span>${DAY_NAMES[day - 1]}${isToday ? ' · Today' : ''}</span>
          <span>${esc(date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span>
        </div>
        ${entries.length
          ? entries.map((entry) => {
            const course = Store.getCourse(entry.courseId);
            return `<div class="agenda-item">
              <span class="dot" style="background:${esc(course?.color || '#7c6cff')}"></span>
              <span class="agenda-time">${esc(fmtTime12(entry.start))}<br>${esc(fmtTime12(entry.end))}</span>
              <span class="agenda-main">
                <strong>${esc(course?.code || 'Class')}${conflictIds.has(entry.id) ? ' <span class="chip amber" style="height:16px;padding:0 4px;font-size:9px">overlap</span>' : ''}</strong>
                <span>${esc(course?.name || '')}${entry.room ? ` · ${esc(entry.room)}` : ''}${entry.instructor ? ` · ${esc(entry.instructor)}` : ''}</span>
              </span>
              <button class="icon-btn" data-edit-class="${esc(entry.id)}" aria-label="Edit class">${icon('pencil')}</button>
            </div>`;
          }).join('')
          : '<div class="agenda-none">No classes</div>'}
      </div>`;
    }).join('');

    const conflictBanner = conflicts.length
      ? `<div class="overlap-banner">${icon('alert')}<div>
          <strong>${conflicts.length} overlapping class${conflicts.length === 1 ? '' : 'es'} this week</strong>
          <ul>${conflicts.slice(0, 5).map(({ day, a, b }) => {
            const ca = Store.getCourse(a.courseId);
            const cb = Store.getCourse(b.courseId);
            return `<li>${DAY_NAMES[day - 1]}: ${esc(ca?.code || 'Class')} (${esc(fmtTime12(a.start))}–${esc(fmtTime12(a.end))}) overlaps ${esc(cb?.code || 'Class')} (${esc(fmtTime12(b.start))}–${esc(fmtTime12(b.end))})</li>`;
          }).join('')}</ul>
        </div></div>`
      : '';

    const hasCourses = Store.get().courses.length > 0;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${icon('calendar')} Weekly timetable</p>
          <h2>Your week, mapped out</h2>
          <p class="lede">${timetable.length
            ? `${timetable.length} class${timetable.length === 1 ? '' : 'es'} each week${conflicts.length ? ` · ${conflicts.length} overlap${conflicts.length === 1 ? '' : 's'} detected` : ' · no overlaps'}. Click any block to edit it.`
            : 'Add your recurring classes to see your week and catch scheduling conflicts.'}</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" data-new-class>${icon('plus')} Add class</button>
        </div>
      </div>
      ${conflictBanner}
      ${!hasCourses
        ? `<div class="card card-pad">${emptyState({
          iconName: 'calendar',
          title: 'Create a course to start your timetable',
          body: 'Weekly classes are linked to courses so they can carry the right name, color and instructor.',
          action: '<button class="btn primary" data-add-course-first>' + icon('plus') + ' Add a course</button>',
        })}</div>`
        : `<div class="card tt-card">
          <div class="tt-scroll">
            <div class="tt-inner">
              <div class="tt-grid tt-head" style="grid-template-columns:62px repeat(7,minmax(106px,1fr))">
                <div class="tt-head-cell" aria-hidden="true"></div>
                ${headCells}
              </div>
              <div class="tt-grid tt-body" style="grid-template-columns:62px repeat(7,minmax(106px,1fr))">
                ${hourColumn}
                ${columns}
              </div>
            </div>
          </div>
          <div class="tt-agenda">${agenda}</div>
        </div>`}
      ${hasCourses && !timetable.length ? `<div class="empty" style="padding-top:18px"><p>No classes scheduled yet. Add one with the button above.</p></div>` : ''}`;

    root.onclick = (event) => {
      const edit = event.target.closest('[data-edit-class]');
      if (edit) {
        openClassModal(Store.get().timetable.find((c) => c.id === edit.dataset.editClass));
        return;
      }
      if (event.target.closest('[data-new-class]')) {
        openClassModal();
        return;
      }
      if (event.target.closest('[data-add-course-first]')) openCourseModal();
    };
  },
};
