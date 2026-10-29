/**
 * grades.js — gradebook math and UI.
 *
 * Weighted course percentage = Σ(weight × obtained/max) / Σ(weight) × 100,
 * using only entries that have a weight above zero. Unweighted marks are shown
 * separately so nothing is silently dropped.
 *
 * GPA is computed ONLY when the student has configured a grade scale in
 * Settings and the course has credit hours. No grading system is assumed.
 */

import { Store } from './storage.js';
import {
  esc, uid, icon, UI, emptyState, field, selectField, setFormErrors,
  round, clamp, isValidDate, fmtDate,
} from './utils.js';

const state = { courseId: null };

/* ------------------------------------------------------------------ *
 * Math (exported so the dashboard can reuse it)
 * ------------------------------------------------------------------ */

export function summarizeGradeItems(items) {
  const weightedItems = items.filter((g) => g.weight > 0 && g.max > 0);
  const weightSum = weightedItems.reduce((sum, g) => sum + g.weight, 0);
  const weighted = weightSum > 0
    ? weightedItems.reduce((sum, g) => sum + g.weight * (g.obtained / g.max), 0) / weightSum * 100
    : null;
  const raw = items.length
    ? items.reduce((sum, g) => sum + g.obtained, 0) / items.reduce((sum, g) => sum + g.max, 0) * 100
    : null;
  return {
    items,
    weighted: weighted === null ? null : round(weighted, 2),
    raw: raw === null ? null : round(raw, 2),
    weightSum: round(weightSum, 2),
    weightedCount: weightedItems.length,
  };
}

export function computeCourseGrade(courseId, grades = Store.get().grades) {
  return summarizeGradeItems(grades.filter((g) => g.courseId === courseId));
}

export function gradeBand(percentage, scale = Store.settings.gradeScale) {
  if (percentage === null || percentage === undefined || !scale.length) return null;
  const sorted = scale.slice().sort((a, b) => b.min - a.min);
  return sorted.find((band) => percentage >= band.min) || null;
}

export function computeGPA() {
  const data = Store.get();
  const scale = data.settings.gradeScale;
  if (!scale.length) {
    return { available: false, reason: 'no-scale', gpa: null, rows: [], totalCredits: 0, excluded: [] };
  }
  const rows = [];
  const excluded = [];
  for (const course of data.courses) {
    const grade = computeCourseGrade(course.id);
    if (grade.weighted === null) continue;
    if (!(course.credits > 0)) {
      excluded.push({ course, reason: 'No credit hours set' });
      continue;
    }
    const band = gradeBand(grade.weighted, scale);
    if (!band) {
      excluded.push({ course, reason: 'No matching grade band' });
      continue;
    }
    rows.push({ course, percentage: grade.weighted, band, credits: course.credits });
  }
  if (!rows.length) {
    return {
      available: false,
      reason: 'no-grades',
      gpa: null,
      rows,
      totalCredits: 0,
      excluded,
    };
  }
  const totalCredits = rows.reduce((sum, r) => sum + r.credits, 0);
  const points = rows.reduce((sum, r) => sum + r.band.points * r.credits, 0);
  return {
    available: true,
    gpa: round(points / totalCredits, 2),
    rows,
    totalCredits: round(totalCredits, 2),
    excluded,
  };
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export function openGradeModal(grade = null, courseId = null) {
  const courses = Store.get().courses;
  if (!courses.length) {
    UI.toast('Add a course before recording marks.', 'warn');
    return;
  }
  const editing = Boolean(grade);
  const defaultCourse = grade?.courseId || courseId || (state.courseId && state.courseId !== '__none' ? state.courseId : courses[0].id);
  const body = `
    <div class="form-grid">
      ${selectField({
        label: 'Course', name: 'courseId', required: true, value: defaultCourse,
        options: courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
      })}
      <div class="span-2 span-2">${field({ label: 'Assessment name', name: 'title', value: grade?.title || '', placeholder: 'e.g. Midterm exam, Quiz 2, Final project', required: true })}</div>
      ${field({ label: 'Marks obtained', name: 'obtained', type: 'number', value: grade ? grade.obtained : '', min: 0, step: 'any', required: true, inputmode: 'decimal', placeholder: '78' })}
      ${field({ label: 'Out of (maximum)', name: 'max', type: 'number', value: grade ? grade.max : 100, min: 0.01, step: 'any', required: true, inputmode: 'decimal', placeholder: '100' })}
      ${field({
        label: 'Weight (% of final grade)', name: 'weight', type: 'number',
        value: grade ? grade.weight : 0, min: 0, max: 100, step: 'any', inputmode: 'decimal',
        hint: 'Use 0 for unweighted practice marks.',
      })}
      ${field({ label: 'Date (optional)', name: 'date', type: 'date', value: grade?.date || '' })}
    </div>
    <div class="form-hint-box">${icon('award')}<span>Weights describe how much each assessment counts toward the final grade. If your weights do not add up to 100%, the gradebook will tell you rather than guess.</span></div>`;

  UI.modal({
    title: editing ? 'Edit mark' : 'Record a mark',
    subtitle: editing ? 'Adjust the marks, maximum or weight.' : 'Add an assessment result to your gradebook.',
    body,
    submitLabel: editing ? 'Save changes' : 'Add mark',
    onSubmit(values, form) {
      const errors = {};
      if (!Store.getCourse(values.courseId)) errors.courseId = 'Choose an existing course.';
      if (!values.title) errors.title = 'Give this assessment a name.';
      const obtained = Number(values.obtained);
      const max = Number(values.max);
      const weight = values.weight === '' ? 0 : Number(values.weight);
      if (values.obtained === '' || Number.isNaN(obtained) || obtained < 0) errors.obtained = 'Enter marks obtained (0 or more).';
      if (values.max === '' || Number.isNaN(max) || max <= 0) errors.max = 'Maximum marks must be greater than 0.';
      if (Number.isNaN(weight) || weight < 0 || weight > 100) errors.weight = 'Weight must be between 0 and 100.';
      if (values.date && !isValidDate(values.date)) errors.date = 'Enter a valid date or leave it blank.';
      if (Object.keys(errors).length) {
        setFormErrors(form, errors);
        return false;
      }
      const clean = {
        courseId: values.courseId,
        title: values.title,
        obtained,
        max,
        weight,
        date: values.date || '',
      };
      if (editing) {
        Store.update((draft) => {
          const target = draft.grades.find((g) => g.id === grade.id);
          if (!target) return false;
          Object.assign(target, clean);
        });
        UI.toast('Mark updated.', 'success');
      } else {
        Store.update((draft) => {
          draft.grades.push({ id: uid('grade'), ...clean });
        });
        UI.toast('Mark added.', 'success');
      }
      state.courseId = clean.courseId;
      return true;
    },
  });
}

async function deleteGrade(id) {
  const grade = Store.get().grades.find((g) => g.id === id);
  if (!grade) return;
  const ok = await UI.confirm({
    title: 'Delete this mark?',
    message: `"${grade.title}" (${grade.obtained}/${grade.max}) will be removed from the gradebook.`,
    confirmLabel: 'Delete mark',
  });
  if (!ok) return;
  Store.update((draft) => { draft.grades = draft.grades.filter((g) => g.id !== id); });
  UI.toast('Mark deleted.', 'success');
}

/* ------------------------------------------------------------------ *
 * Rendering helpers
 * ------------------------------------------------------------------ */

function percentClass(pct) {
  if (pct === null) return '';
  if (pct >= 75) return 'good';
  if (pct >= 60) return 'mid';
  return 'low';
}

function letterChip(pct) {
  const band = gradeBand(pct);
  if (!band) return '<span class="chip">—</span>';
  return `<span class="chip ${pct >= 75 ? 'green' : pct >= 60 ? 'amber' : 'red'}">${esc(band.letter)}</span>`;
}

function gradeTable(items) {
  if (!items.length) {
    return `<div class="grade-empty-panel">${emptyState({
      iconName: 'award',
      title: 'No marks recorded',
      body: 'Record a quiz, assignment or exam to start seeing your course average.',
      action: `<button class="btn small" data-new-grade>${icon('plus')} Record a mark</button>`,
    })}</div>`;
  }
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>Assessment</th><th class="num">Marks</th><th class="num">Score</th><th class="num">Weight</th><th>Weight of final</th><th>Date</th><th class="actions"><span class="sr-only">Actions</span></th>
    </tr></thead>
    <tbody>
      ${items.map((g) => {
        const pct = g.max > 0 ? (g.obtained / g.max) * 100 : null;
        return `<tr>
          <td class="title-cell">${esc(g.title)}${pct !== null && pct > 100 ? ' <span class="chip violet">extra credit</span>' : ''}</td>
          <td class="num">${esc(round(g.obtained, 2))} / ${esc(round(g.max, 2))}</td>
          <td class="num pct-cell ${percentClass(pct)}">${pct === null ? '—' : `${esc(round(pct, 1))}%`}</td>
          <td class="num">${g.weight > 0 ? `${esc(round(g.weight, 1))}%` : '<span class="subtle">—</span>'}</td>
          <td>
            <div class="weight-track">
              <div class="progress"><div class="progress-bar" style="width:${clamp(g.weight, 0, 100)}%"></div></div>
            </div>
          </td>
          <td class="muted nowrap">${g.date ? esc(fmtDate(g.date, { year: false })) : '—'}</td>
          <td class="actions">
            <button class="icon-btn" data-edit-grade="${esc(g.id)}" aria-label="Edit ${esc(g.title)}" title="Edit">${icon('pencil')}</button>
            <button class="icon-btn danger" data-delete-grade="${esc(g.id)}" aria-label="Delete ${esc(g.title)}" title="Delete">${icon('trash')}</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

function gpaPanel() {
  const gpa = computeGPA();
  const scale = Store.settings.gradeScale;

  if (!scale.length) {
    return `<div class="gpa-panel">
      <div class="gpa-hero">
        <div class="label">Semester GPA</div>
        <div class="gpa-value">—<small> / —</small></div>
        <p class="gpa-note">GPA is off until you define your own grade scale. SemesterOS does not assume any university's grading system.</p>
        <div class="settings-actions"><button class="btn small primary" data-go-settings>Set up grade scale</button></div>
      </div>
      <div class="gpa-table-wrap">${emptyState({
        iconName: 'target',
        title: 'Your grading system, your rules',
        body: 'Add letter grades, minimum percentages and grade points in Settings → Grade scale. GPA then uses credit hours from each course.',
        action: '<button class="btn small" data-go-settings>Open grade scale settings</button>',
      })}</div>
    </div>`;
  }

  if (!gpa.available) {
    return `<div class="gpa-panel">
      <div class="gpa-hero">
        <div class="label">Semester GPA</div>
        <div class="gpa-value">—</div>
        <p class="gpa-note">${gpa.reason === 'no-grades'
          ? 'Record weighted marks for at least one course with credit hours to calculate a GPA.'
          : 'GPA could not be calculated yet.'}</p>
      </div>
      <div class="gpa-table-wrap">${emptyState({
        iconName: 'award',
        title: 'Waiting for grade data',
        body: 'A course needs recorded marks and credit hours greater than zero. Courses without marks are excluded.',
      })}</div>
    </div>`;
  }

  return `<div class="gpa-panel">
    <div class="gpa-hero">
      <div class="label">Semester GPA</div>
      <div class="gpa-value">${esc(gpa.gpa.toFixed(2))}<small> / ${esc(Math.max(...scale.map((band) => band.points)))} max</small></div>
      <div class="gpa-meta">
        <div>Graded credits<strong>${esc(round(gpa.totalCredits, 1))}</strong></div>
        <div>Courses counted<strong>${gpa.rows.length}</strong></div>
        <div>Scale<strong>${scale.length} bands</strong></div>
      </div>
      <p class="gpa-note">Weighted averages only. ${gpa.excluded.length ? `${gpa.excluded.length} course${gpa.excluded.length === 1 ? '' : 's'} excluded for missing credit hours or a matching grade band.` : 'Every graded course has credit hours.'}</p>
    </div>
    <div class="gpa-table-wrap">
      <table class="data-table">
        <thead><tr><th>Course</th><th class="num">Credits</th><th class="num">Average</th><th>Grade</th><th class="num">Points</th></tr></thead>
        <tbody>
          ${gpa.rows.map((row) => `<tr>
            <td><span class="course-pill"><span class="dot" style="background:${esc(row.course.color)}"></span><span>${esc(row.course.code)}</span></span></td>
            <td class="num">${esc(round(row.credits, 1))}</td>
            <td class="num">${esc(round(row.percentage, 1))}%</td>
            <td><span class="chip green">${esc(row.band.letter)}</span></td>
            <td class="num">${esc(row.band.points)}</td>
          </tr>`).join('')}
          <tr>
            <td colspan="2" style="font-weight:600">Weighted GPA</td>
            <td colspan="3" class="num"><strong>${esc(gpa.gpa.toFixed(2))}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

export const GradesView = {
  render(root) {
    const data = Store.get();
    const courses = data.courses;
    const orphanGrades = data.grades.filter((g) => !g.courseId || !Store.getCourse(g.courseId));

    if (!courses.length && !orphanGrades.length) {
      root.innerHTML = `
        <div class="page-head">
          <div><p class="eyebrow">${icon('award')} Gradebook</p><h2>Know exactly where you stand</h2>
          <p class="lede">Weighted averages, grade letters and GPA — calculated from your own grading scale.</p></div>
        </div>
        <div class="card card-pad">${emptyState({
          iconName: 'award',
          title: 'Add a course to open the gradebook',
          body: 'Marks are recorded per course so SemesterOS can calculate accurate averages and credit-weighted GPA.',
          action: '<button class="btn primary" data-go-courses>Go to Courses</button>',
        })}</div>`;
      root.onclick = (event) => {
        if (event.target.closest('[data-go-courses]')) window.location.hash = '#/courses';
      };
      return;
    }

    const tabs = [
      ...courses.map((c) => ({ id: c.id, label: c.code, color: c.color })),
      ...(orphanGrades.length ? [{ id: '__none', label: 'Unassigned', color: '#6a7695' }] : []),
    ];
    if (!tabs.some((t) => t.id === state.courseId)) state.courseId = tabs[0]?.id || null;
    const active = tabs.find((t) => t.id === state.courseId) || tabs[0];
    const activeCourse = active.id === '__none' ? null : Store.getCourse(active.id);
    const items = data.grades
      .filter((g) => (active.id === '__none' ? (!g.courseId || !Store.getCourse(g.courseId)) : g.courseId === active.id))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title));
    const grade = active.id === '__none' ? summarizeGradeItems(items) : computeCourseGrade(active.id);
    const pct = grade.weighted;

    const weightStatus = grade.weightSum === 0
      ? 'No weights set yet — add a weight to any assessment to calculate a final grade.'
      : Math.abs(grade.weightSum - 100) < 0.01
        ? 'Weights add up to exactly 100% of the final grade.'
        : grade.weightSum < 100
          ? `Weights currently cover ${esc(round(grade.weightSum, 1))}% of the final grade.`
          : `Weights add up to ${esc(round(grade.weightSum, 1))}% — that is over 100%, so double-check them.`;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${icon('award')} Gradebook</p>
          <h2>Know exactly where you stand</h2>
          <p class="lede">Weighted averages use your own weights. Unweighted practice marks never distort the final percentage.</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" data-new-grade ${courses.length ? '' : 'disabled'}>${icon('plus')} Record mark</button>
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="Course gradebooks">
        ${tabs.map((t) => `<button class="tab ${t.id === active.id ? 'active' : ''}" data-grade-tab="${esc(t.id)}" role="tab" aria-selected="${t.id === active.id}">
          <span class="dot" style="background:${esc(t.color)}"></span>${esc(t.label)}
        </button>`).join('')}
      </div>

      <div class="grade-summary">
        <div class="mini-stat">
          <div class="label">Weighted average</div>
          <div class="value" style="color:${pct === null ? 'inherit' : pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)'}">${pct === null ? '—' : `${esc(round(pct, 1))}<small>%</small>`}</div>
          <div class="sub">${grade.weightedCount} weighted assessment${grade.weightedCount === 1 ? '' : 's'}</div>
        </div>
        <div class="mini-stat">
          <div class="label">Grade letter</div>
          <div class="value">${letterChip(pct)}</div>
          <div class="sub">${Store.settings.gradeScale.length ? 'From your grade scale' : 'Configure a scale in Settings'}</div>
        </div>
        <div class="mini-stat">
          <div class="label">Weight recorded</div>
          <div class="value">${esc(round(grade.weightSum, 1))}<small>%</small></div>
          <div class="sub">${grade.items.length} mark${grade.items.length === 1 ? '' : 's'} total</div>
        </div>
        <div class="mini-stat">
          <div class="label">Unweighted average</div>
          <div class="value">${grade.raw === null ? '—' : `${esc(round(grade.raw, 1))}<small>%</small>`}</div>
          <div class="sub">All marks, including practices</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head bordered">
          <div>
            <div class="card-title">${activeCourse ? `${esc(activeCourse.code)} · ${esc(activeCourse.name)}` : 'Unassigned marks'}</div>
            <div class="card-sub">${activeCourse ? `${esc(round(activeCourse.credits, 1))} credit hours${activeCourse.instructor ? ` · ${esc(activeCourse.instructor)}` : ''}` : 'These marks are not linked to a course.'}</div>
          </div>
          <button class="btn small" data-new-grade>${icon('plus')} Add mark</button>
        </div>
        ${gradeTable(items)}
        <div class="card-body" style="padding-top:0">
          <div class="progress-meta"><span>Final grade weight recorded</span><strong>${esc(round(grade.weightSum, 1))}%</strong></div>
          <div class="progress"><div class="progress-bar ${grade.weightSum === 100 ? 'green' : grade.weightSum > 100 ? 'red' : 'amber'}" style="width:${clamp(grade.weightSum, 0, 100)}%"></div></div>
          <div class="weight-warning" style="background:${grade.weightSum === 100 ? 'var(--green-soft)' : 'var(--amber-soft)'};border-color:${grade.weightSum === 100 ? 'rgba(52,211,153,.25)' : 'rgba(251,191,36,.25)'};color:${grade.weightSum === 100 ? 'var(--green)' : 'var(--amber)'}">
            ${icon(grade.weightSum === 100 ? 'check' : 'alert')}<span>${weightStatus}</span>
          </div>
        </div>
      </div>

      ${gpaPanel()}`;

    root.onclick = (event) => {
      const tab = event.target.closest('[data-grade-tab]');
      if (tab) {
        state.courseId = tab.dataset.gradeTab;
        GradesView.render(root);
        return;
      }
      const edit = event.target.closest('[data-edit-grade]');
      if (edit) {
        openGradeModal(Store.get().grades.find((g) => g.id === edit.dataset.editGrade), active.id === '__none' ? null : active.id);
        return;
      }
      const del = event.target.closest('[data-delete-grade]');
      if (del) { deleteGrade(del.dataset.deleteGrade); return; }
      if (event.target.closest('[data-new-grade]')) {
        openGradeModal(null, active.id === '__none' ? null : active.id);
        return;
      }
      if (event.target.closest('[data-go-settings]')) { window.location.hash = '#/settings'; return; }
      if (event.target.closest('[data-go-courses]')) window.location.hash = '#/courses';
    };
  },
};
