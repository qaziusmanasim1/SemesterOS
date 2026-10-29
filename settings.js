/**
 * settings.js — semester dates, appearance, timer defaults, grade scale and
 * local data management (export / validated import / restore / clear).
 */

import { Store, SCHEMA_VERSION } from './storage.js';
import {
  esc, icon, UI, field, formValues, setFormErrors, isValidDate,
  todayISO, semesterContext, round,
} from './utils.js';
import { syncTimerSettings } from './study.js';

const EXAMPLE_SCALE = [
  { letter: 'A', min: 90, points: 4 },
  { letter: 'A-', min: 85, points: 3.7 },
  { letter: 'B+', min: 80, points: 3.3 },
  { letter: 'B', min: 75, points: 3 },
  { letter: 'B-', min: 70, points: 2.7 },
  { letter: 'C+', min: 65, points: 2.3 },
  { letter: 'C', min: 60, points: 2 },
  { letter: 'D', min: 50, points: 1 },
  { letter: 'F', min: 0, points: 0 },
];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024, 1)} KB`;
  return `${round(bytes / (1024 * 1024), 2)} MB`;
}

function bandRow(band = { letter: '', min: '', points: '' }) {
  return `<div class="scale-row" data-band-row>
    <input data-band-letter value="${esc(band.letter)}" placeholder="A" maxlength="4" aria-label="Grade letter">
    <input data-band-min type="number" min="0" max="100" step="0.1" value="${esc(band.min)}" placeholder="90" aria-label="Minimum percentage">
    <input data-band-points type="number" min="0" max="10" step="0.01" value="${esc(band.points)}" placeholder="4.0" aria-label="Grade points">
    <button type="button" class="icon-btn" data-remove-band aria-label="Remove grade band">${icon('trash')}</button>
  </div>`;
}

function collectBands(root) {
  const errors = [];
  const bands = [];
  const seenLetters = new Set();
  const seenMins = new Set();
  root.querySelectorAll('[data-band-row]').forEach((row, index) => {
    const letter = row.querySelector('[data-band-letter]').value.trim();
    const minRaw = row.querySelector('[data-band-min]').value;
    const pointsRaw = row.querySelector('[data-band-points]').value;
    if (!letter && !minRaw && !pointsRaw) return;
    if (!letter) {
      errors.push(`Row ${index + 1} needs a letter grade.`);
      return;
    }
    if (letter.length > 4) {
      errors.push(`Grade letter "${letter}" must be 4 characters or fewer.`);
      return;
    }
    const min = Number(minRaw);
    const points = Number(pointsRaw);
    if (minRaw === '' || Number.isNaN(min) || min < 0 || min > 100) {
      errors.push(`"${letter}" needs a minimum percentage between 0 and 100.`);
      return;
    }
    if (pointsRaw === '' || Number.isNaN(points) || points < 0 || points > 10) {
      errors.push(`"${letter}" needs grade points between 0 and 10.`);
      return;
    }
    if (seenLetters.has(letter.toUpperCase())) {
      errors.push(`Grade letter "${letter}" appears more than once.`);
      return;
    }
    if (seenMins.has(min)) {
      errors.push(`Two grade bands both start at ${min}%. Use unique minimums.`);
      return;
    }
    seenLetters.add(letter.toUpperCase());
    seenMins.add(min);
    bands.push({ letter, min: round(min, 2), points: round(points, 2) });
  });
  return { bands: bands.sort((a, b) => b.min - a.min), errors };
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

export const SettingsView = {
  render(root) {
    const settings = Store.settings;
    const ctx = semesterContext(settings);
    const info = Store.storageInfo();
    const safety = Store.getSafetyCopy();
    const scale = settings.gradeScale.slice().sort((a, b) => b.min - a.min);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${icon('settings')} Settings</p>
          <h2>Make SemesterOS yours</h2>
          <p class="lede">All data stays in this browser. Configure your semester, grading system and study defaults.</p>
        </div>
      </div>

      <div class="settings-stack">
        <section class="settings-card">
          <div class="settings-head">
            <h2>${icon('calendar')} Semester & profile</h2>
            <p>Used for the weekly dashboard context and progress in the sidebar. Your name is only used for the greeting.</p>
          </div>
          <div class="settings-body">
            <form id="semester-form" class="form-grid" novalidate>
              <div class="span-2">${field({ label: 'Your name (optional)', name: 'displayName', value: settings.displayName, placeholder: 'e.g. Qazi' })}</div>
              ${field({ label: 'Semester start', name: 'semesterStart', type: 'date', value: settings.semesterStart })}
              ${field({ label: 'Semester end', name: 'semesterEnd', type: 'date', value: settings.semesterEnd })}
            </form>
            <div class="settings-actions">
              <button class="btn primary" data-save-semester>Save semester</button>
              <span class="settings-note">${ctx.week && ctx.totalWeeks ? `Currently week ${ctx.week} of ${ctx.totalWeeks}${ctx.daysLeft !== null ? ` · ${Math.max(0, ctx.daysLeft)} days left` : ''}.` : 'Set start and end dates to see week progress.'}</span>
            </div>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-head">
            <h2>${icon('sun')} Appearance</h2>
            <p>Theme and week layout apply immediately across the app.</p>
          </div>
          <div class="settings-body">
            <div class="setting-inline">
              <div class="setting-info"><strong>Theme</strong><span>Deep navy dark mode, or a bright light mode for daytime.</span></div>
              <div class="segmented" role="group" aria-label="Theme">
                <button data-theme-choice="dark" class="${settings.theme === 'dark' ? 'active' : ''}">${icon('moon')} Dark</button>
                <button data-theme-choice="light" class="${settings.theme === 'light' ? 'active' : ''}">${icon('sun')} Light</button>
              </div>
            </div>
            <div class="setting-inline">
              <div class="setting-info"><strong>Week starts on</strong><span>Changes the timetable and weekly study totals.</span></div>
              <div class="segmented" role="group" aria-label="Week start">
                <button data-weekstart="1" class="${settings.weekStart === 1 ? 'active' : ''}">Monday</button>
                <button data-weekstart="0" class="${settings.weekStart === 0 ? 'active' : ''}">Sunday</button>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-head">
            <h2>${icon('timer')} Pomodoro defaults</h2>
            <p>These durations apply the next time you start or reset a phase. A running timer is never interrupted.</p>
          </div>
          <div class="settings-body">
            <form id="pomodoro-form" class="form-grid" novalidate>
              ${field({ label: 'Focus minutes', name: 'pfocus', type: 'number', value: settings.pomodoro.focus, min: 1, max: 180, step: 1, required: true })}
              ${field({ label: 'Short break minutes', name: 'pshort', type: 'number', value: settings.pomodoro.shortBreak, min: 1, max: 60, step: 1, required: true })}
              ${field({ label: 'Long break minutes', name: 'plong', type: 'number', value: settings.pomodoro.longBreak, min: 1, max: 90, step: 1, required: true })}
              ${field({ label: 'Long break after', name: 'pevery', type: 'number', value: settings.pomodoro.longBreakEvery, min: 1, max: 12, step: 1, required: true, hint: 'Number of completed focus sessions.' })}
            </form>
            <div class="settings-actions"><button class="btn primary" data-save-pomodoro>Save timer defaults</button></div>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-head">
            <h2>${icon('award')} Grade scale</h2>
            <p>Define how percentages map to letters and grade points. SemesterOS never assumes a grading system. GPA stays off until this list is valid and courses have credit hours.</p>
          </div>
          <div class="settings-body">
            <div class="scale-table">
              <div class="scale-row header">
                <span>Letter</span><span>Min %</span><span>Points</span><span></span>
              </div>
              <div data-band-rows>
                ${scale.length ? scale.map(bandRow).join('') : '<div class="scale-empty">No grade scale configured — GPA is off.<br>Add bands manually or load an example to edit.</div>'}
              </div>
            </div>
            <div id="scale-errors"></div>
            <div class="scale-actions">
              <button class="btn small" data-add-band>${icon('plus')} Add band</button>
              <button class="btn ghost small" data-load-example>Load a common 4.0 example</button>
              <button class="btn primary small" data-save-scale>Save grade scale</button>
            </div>
            <p class="settings-note" style="margin-top:9px">Percentages are matched against the highest minimum that fits. Bands can use any letters and point values — including 10-point or percentage systems. ${scale.length ? `${scale.length} bands configured.` : 'GPA is currently disabled.'}</p>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-head">
            <h2>${icon('layers')} Your data</h2>
            <p>SemesterOS has no server. Export a JSON backup regularly, especially before clearing this browser.</p>
          </div>
          <div class="settings-body">
            <div class="data-actions">
              <button class="data-action" data-export-backup>
                ${icon('download')}
                <span><strong>Export backup</strong><span>Download every course, task, mark, session and note as JSON.</span></span>
              </button>
              <button class="data-action" data-import-backup>
                ${icon('upload')}
                <span><strong>Restore from backup</strong><span>Validate a SemesterOS JSON file, then replace this data.</span></span>
              </button>
              ${safety ? `<button class="data-action" data-restore-safety>
                ${icon('reset')}
                <span><strong>Restore safety copy</strong><span>Saved ${esc(new Date(safety.savedAt).toLocaleString())} · ${safety.counts.courses} courses, ${safety.counts.tasks} tasks.</span></span>
              </button>` : ''}
            </div>
            <input type="file" id="import-file" accept="application/json,.json" hidden>
            <div class="data-meta">
              <span class="chip ${info.available ? 'green' : 'red'}">${info.available ? 'Local storage available' : 'Local storage unavailable'}</span>
              <span>${formatBytes(info.bytes)} stored in this browser</span>
              <span>·</span>
              <span>Schema v${SCHEMA_VERSION}</span>
            </div>
            ${info.error ? `<div class="import-errors"><strong>Storage problem</strong><p>${esc(info.error)}</p></div>` : ''}
          </div>
        </section>

        <section class="settings-card danger-zone">
          <div class="settings-head">
            <h2>${icon('trash')} Danger zone</h2>
            <p>Clearing data removes everything from this browser, including any safety copy. Export a backup first — this cannot be undone.</p>
          </div>
          <div class="settings-body">
            <button class="btn danger" data-clear-all>${icon('trash')} Clear all SemesterOS data</button>
          </div>
        </section>

        <p class="settings-note" style="text-align:center;padding-bottom:8px">SemesterOS · offline-first · no accounts, no cloud, no tracking</p>
      </div>`;

    const refreshThemeButtons = () => {
      root.querySelectorAll('[data-theme-choice]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeChoice === Store.settings.theme);
      });
    };

    root.onclick = async (event) => {
      const themeBtn = event.target.closest('[data-theme-choice]');
      if (themeBtn) {
        const theme = themeBtn.dataset.themeChoice;
        Store.updateSettings({ theme }, { silent: true });
        document.documentElement.dataset.theme = theme;
        refreshThemeButtons();
        window.dispatchEvent(new CustomEvent('semesteros:appearance'));
        return;
      }

      const weekBtn = event.target.closest('[data-weekstart]');
      if (weekBtn) {
        const weekStart = Number(weekBtn.dataset.weekstart);
        Store.updateSettings({ weekStart }, { silent: true });
        root.querySelectorAll('[data-weekstart]').forEach((btn) => {
          btn.classList.toggle('active', Number(btn.dataset.weekstart) === weekStart);
        });
        UI.toast(`Week now starts on ${weekStart === 1 ? 'Monday' : 'Sunday'}.`, 'success');
        return;
      }

      if (event.target.closest('[data-save-semester]')) {
        const form = root.querySelector('#semester-form');
        const values = formValues(form);
        const errors = {};
        if (values.semesterStart && !isValidDate(values.semesterStart)) errors.semesterStart = 'Enter a valid start date.';
        if (values.semesterEnd && !isValidDate(values.semesterEnd)) errors.semesterEnd = 'Enter a valid end date.';
        if (isValidDate(values.semesterStart) && isValidDate(values.semesterEnd) && values.semesterEnd < values.semesterStart) {
          errors.semesterEnd = 'The end date must be after the start date.';
        }
        if (Object.keys(errors).length) {
          setFormErrors(form, errors);
          return;
        }
        Store.updateSettings({
          displayName: values.displayName.slice(0, 60),
          semesterStart: values.semesterStart || '',
          semesterEnd: values.semesterEnd || '',
        });
        UI.toast('Semester settings saved.', 'success');
        return;
      }

      if (event.target.closest('[data-save-pomodoro]')) {
        const form = root.querySelector('#pomodoro-form');
        const values = formValues(form);
        const focus = Number(values.pfocus);
        const shortBreak = Number(values.pshort);
        const longBreak = Number(values.plong);
        const longBreakEvery = Number(values.pevery);
        const errors = {};
        if (!Number.isFinite(focus) || focus < 1 || focus > 180) errors.pfocus = 'Use 1–180 minutes.';
        if (!Number.isFinite(shortBreak) || shortBreak < 1 || shortBreak > 60) errors.pshort = 'Use 1–60 minutes.';
        if (!Number.isFinite(longBreak) || longBreak < 1 || longBreak > 90) errors.plong = 'Use 1–90 minutes.';
        if (!Number.isFinite(longBreakEvery) || longBreakEvery < 1 || longBreakEvery > 12) errors.pevery = 'Use 1–12 sessions.';
        if (Object.keys(errors).length) {
          setFormErrors(form, errors);
          return;
        }
        Store.updateSettings({
          pomodoro: {
            focus: Math.round(focus),
            shortBreak: Math.round(shortBreak),
            longBreak: Math.round(longBreak),
            longBreakEvery: Math.round(longBreakEvery),
          },
        });
        syncTimerSettings();
        UI.toast('Pomodoro defaults saved.', 'success');
        return;
      }

      if (event.target.closest('[data-add-band]')) {
        const container = root.querySelector('[data-band-rows]');
        if (container.querySelector('.scale-empty')) container.innerHTML = '';
        container.insertAdjacentHTML('beforeend', bandRow());
        const inputs = container.querySelectorAll('[data-band-row]');
        inputs[inputs.length - 1]?.querySelector('[data-band-letter]')?.focus();
        return;
      }

      const removeBtn = event.target.closest('[data-remove-band]');
      if (removeBtn) {
        removeBtn.closest('[data-band-row]')?.remove();
        const container = root.querySelector('[data-band-rows]');
        if (container && !container.querySelector('[data-band-row]')) {
          container.innerHTML = '<div class="scale-empty">No grade bands. Add at least one to enable GPA.</div>';
        }
        return;
      }

      if (event.target.closest('[data-load-example]')) {
        const existing = root.querySelectorAll('[data-band-row]').length;
        if (existing) {
          const ok = await UI.confirm({
            title: 'Replace the current rows?',
            message: 'The example 4.0 scale will replace the bands currently shown.',
            note: 'Nothing is saved until you press “Save grade scale”.',
            confirmLabel: 'Load example',
            tone: 'primary',
          });
          if (!ok) return;
        }
        const container = root.querySelector('[data-band-rows]');
        container.innerHTML = EXAMPLE_SCALE.map(bandRow).join('');
        root.querySelector('#scale-errors').innerHTML = '';
        UI.toast('Example loaded. Review the bands, then save.', 'info');
        return;
      }

      if (event.target.closest('[data-save-scale]')) {
        const { bands, errors } = collectBands(root);
        const errorEl = root.querySelector('#scale-errors');
        if (errors.length) {
          errorEl.innerHTML = `<div class="import-errors"><strong>Grade scale not saved</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
          return;
        }
        if (!bands.length) {
          errorEl.innerHTML = '<div class="import-errors"><strong>Grade scale not saved</strong><ul><li>Add at least one valid grade band, or leave GPA disabled.</li></ul></div>';
          return;
        }
        errorEl.innerHTML = '';
        Store.updateSettings({ gradeScale: bands });
        UI.toast(`Grade scale saved with ${bands.length} bands. GPA is now available.`, 'success');
        return;
      }

      if (event.target.closest('[data-export-backup]')) {
        window.dispatchEvent(new CustomEvent('semesteros:flush'));
        const text = Store.exportText();
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `semesteros-backup-${todayISO()}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        UI.toast('Backup exported as a JSON file.', 'success');
        return;
      }

      if (event.target.closest('[data-import-backup]')) {
        root.querySelector('#import-file')?.click();
        return;
      }

      if (event.target.closest('[data-restore-safety]')) {
        const copy = Store.getSafetyCopy();
        if (!copy) {
          UI.toast('No safety copy is available.', 'error');
          return;
        }
        const ok = await UI.confirm({
          title: 'Restore the safety copy?',
          message: `This will replace your current data with the copy saved ${new Date(copy.savedAt).toLocaleString()}.`,
          note: 'Your current data is snapshotted first, so this action is reversible.',
          confirmLabel: 'Restore copy',
          tone: 'primary',
        });
        if (!ok) return;
        const restored = Store.restoreSafetyCopy();
        UI.toast(restored ? 'Safety copy restored.' : 'The safety copy could not be restored.', restored ? 'success' : 'error');
        return;
      }

      if (event.target.closest('[data-clear-all]')) {
        const ok = await UI.confirm({
          title: 'Clear all data?',
          message: 'Every course, task, class, mark, study session, note and setting will be deleted from this browser.',
          note: 'This also removes safety copies and cannot be undone. Export a backup first if you might need this semester later.',
          confirmLabel: 'Clear everything',
          requireText: 'DELETE',
        });
        if (!ok) return;
        Store.clearAll();
        UI.toast('All SemesterOS data cleared.', 'success');
        window.location.hash = '#/dashboard';
        return;
      }
    };

    const fileInput = root.querySelector('#import-file');
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          fileInput.value = '';
          UI.modal({
            title: 'Backup rejected',
            subtitle: 'Nothing was changed.',
            body: '<div class="import-errors"><strong>File too large</strong><p>Backups must be smaller than 8 MB.</p></div>',
            submitLabel: 'Close',
            hideCancel: true,
          });
          return;
        }
        let text = '';
        try {
          text = await file.text();
        } catch {
          fileInput.value = '';
          UI.toast('That file could not be read. Nothing was changed.', 'error');
          return;
        }
        fileInput.value = '';
        const result = Store.validateBackup(text);
        if (!result.ok) {
          UI.modal({
            title: 'Backup rejected',
            subtitle: 'Your current data was not touched.',
            body: `<div class="import-errors"><strong>This file cannot be imported</strong><ul>${result.errors.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>
              <p class="settings-note">Fix the file or choose a backup exported by SemesterOS, then try again.</p>`,
            submitLabel: 'Close',
            hideCancel: true,
          });
          return;
        }
        const counts = result.counts;
        const ok = await UI.confirm({
          title: 'Restore this backup?',
          message: `Courses: ${counts.courses} · Tasks: ${counts.tasks} · Classes: ${counts.classes} · Marks: ${counts.grades} · Sessions: ${counts.sessions} · Notes: ${counts.notes}`,
          note: 'This replaces all current SemesterOS data. A safety copy of your current data is saved first.',
          confirmLabel: 'Restore backup',
          tone: 'primary',
        });
        if (!ok) return;
        const { persisted, safetySaved } = Store.importState(result.state);
        if (!persisted) UI.toast('Backup loaded in this tab, but it could not be written to browser storage. Export a backup now.', 'error');
        else if (!safetySaved) UI.toast('Backup restored, but the safety copy could not be saved.', 'warn');
        else UI.toast('Backup restored successfully.', 'success');
      });
    }
  },
};
