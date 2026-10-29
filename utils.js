/**
 * utils.js — shared helpers for SemesterOS.
 * No dependencies. Everything here is pure except the small UI toolkit
 * (toasts, modals, confirm dialogs) at the bottom of the file.
 */

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const TASK_TYPES = ['assignment', 'quiz', 'midterm', 'final', 'project', 'lab'];
export const TASK_STATUSES = ['todo', 'in-progress', 'done'];
export const PRIORITIES = ['low', 'medium', 'high'];

export const TASK_TYPE_LABELS = {
  assignment: 'Assignment',
  quiz: 'Quiz',
  midterm: 'Midterm',
  final: 'Final',
  project: 'Project',
  lab: 'Lab',
};

export const STATUS_LABELS = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
};

export const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

export const COURSE_COLORS = [
  '#7c6cff', '#4f9dff', '#35d3b0', '#f5b53f', '#ff6b8a',
  '#b085ff', '#ff9f57', '#3dd6e8', '#a3e635', '#f472b6',
];

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ------------------------------------------------------------------ *
 * Escaping & ids
 * ------------------------------------------------------------------ */

/** Escape text for safe interpolation into HTML or attributes. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function round(n, places = 1) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function debounce(fn, wait = 400) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/* ------------------------------------------------------------------ *
 * Dates — all calendar dates are ISO "YYYY-MM-DD" strings, parsed as
 * local midnight so timezone offsets never shift a deadline by a day.
 * ------------------------------------------------------------------ */

export function isoOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return isoOf(new Date());
}

export function parseISO(iso) {
  if (typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return date;
}

export function isValidDate(iso) {
  return parseISO(iso) !== null;
}

export function isValidTime(time) {
  return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function addDaysISO(iso, days) {
  const date = parseISO(iso);
  if (!date) return iso;
  return isoOf(addDays(date, days));
}

export function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole calendar days from a to b (b - a). */
export function daysBetween(a, b) {
  const start = startOfDay(a).getTime();
  const end = startOfDay(b).getTime();
  return Math.round((end - start) / 86400000);
}

/** Combine a due date and optional time into a local Date. */
export function dueMoment(dateISO, time) {
  const date = parseISO(dateISO);
  if (!date) return null;
  const safeTime = isValidTime(time) ? time : '23:59';
  const [h, m] = safeTime.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
}

export function timeToMinutes(time) {
  if (!isValidTime(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes) {
  const clamped = clamp(Math.round(minutes), 0, 1439);
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function fmtTime12(time) {
  if (!isValidTime(time)) return '';
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function fmtDate(iso, opts = {}) {
  const date = parseISO(iso);
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: opts.year === false ? undefined : 'numeric',
  });
}

export function fmtDateLong(iso) {
  const date = parseISO(iso);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtDateShort(iso) {
  const date = parseISO(iso);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** ISO weekday index: Monday = 1 … Sunday = 7. */
export function isoWeekday(date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/** Start of the week containing `date`, honoring weekStart (0 = Sunday, 1 = Monday). */
export function startOfWeek(date, weekStart = 1) {
  const day = date.getDay();
  let diff;
  if (weekStart === 0) diff = day;
  else diff = (day + 6) % 7;
  return addDays(startOfDay(date), -diff);
}

export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Human-friendly gap for countdown labels. */
function gapLabel(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Classify a deadline: done | overdue | today | soon (<= 7 days) | later.
 * Returns { tone, label, days } where days is the calendar-day difference.
 */
export function deadlineInfo(dateISO, time, status = 'todo', now = new Date()) {
  if (status === 'done') return { tone: 'done', label: 'Completed', days: null };
  const due = dueMoment(dateISO, time);
  if (!due) return { tone: 'later', label: 'No date', days: null };
  const diff = due.getTime() - now.getTime();
  const days = daysBetween(now, due);
  if (diff < 0) {
    return { tone: 'overdue', label: `Overdue by ${gapLabel(-diff)}`, days };
  }
  if (days === 0) {
    return { tone: 'today', label: isValidTime(time) ? `Due today · ${fmtTime12(time)}` : 'Due today', days: 0 };
  }
  if (days === 1) return { tone: 'soon', label: 'Due tomorrow', days: 1 };
  if (days <= 7) return { tone: 'soon', label: `Due in ${days} days`, days };
  return { tone: 'later', label: `Due ${fmtDate(dateISO, { year: false })}`, days };
}

export function isOverdue(task, now = new Date()) {
  if (!task || task.status === 'done') return false;
  const due = dueMoment(task.dueDate, task.dueTime);
  return Boolean(due && due.getTime() < now.getTime());
}

export function semesterContext(settings, now = new Date()) {
  const start = parseISO(settings?.semesterStart || '');
  const end = parseISO(settings?.semesterEnd || '');
  const totalDays = start && end ? Math.max(1, daysBetween(start, end) + 1) : null;
  const elapsed = start ? clamp(daysBetween(start, now) + 1, 0, totalDays || Infinity) : null;
  const daysLeft = end ? daysBetween(now, end) : null;
  const week = start ? Math.floor(daysBetween(start, now) / 7) + 1 : null;
  const totalWeeks = start && end ? Math.ceil(totalDays / 7) : null;
  return { start, end, totalDays, elapsed, daysLeft, week, totalWeeks };
}

/* ------------------------------------------------------------------ *
 * Form building blocks
 * ------------------------------------------------------------------ */

export function field({
  label, name, type = 'text', value = '', placeholder = '', required = false,
  min, max, step, hint = '', attrs = '', inputmode,
}) {
  const extras = [
    min !== undefined ? `min="${esc(min)}"` : '',
    max !== undefined ? `max="${esc(max)}"` : '',
    step !== undefined ? `step="${esc(step)}"` : '',
    inputmode ? `inputmode="${esc(inputmode)}"` : '',
    attrs,
  ].filter(Boolean).join(' ');
  return `<label class="field">
    <span class="field-label">${esc(label)}${required ? '<em aria-hidden="true">*</em>' : ''}</span>
    <input type="${esc(type)}" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}"
      ${required ? 'required' : ''} autocomplete="off" spellcheck="false" ${extras}>
    ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    <span class="field-error" data-error-for="${esc(name)}"></span>
  </label>`;
}

export function selectField({ label, name, options, value = '', required = false, hint = '', placeholder = '' }) {
  const opts = [
    placeholder ? `<option value="">${esc(placeholder)}</option>` : '',
    ...options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`),
  ].join('');
  return `<label class="field">
    <span class="field-label">${esc(label)}${required ? '<em aria-hidden="true">*</em>' : ''}</span>
    <select name="${esc(name)}" ${required ? 'required' : ''}>${opts}</select>
    ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    <span class="field-error" data-error-for="${esc(name)}"></span>
  </label>`;
}

export function textareaField({ label, name, value = '', rows = 4, placeholder = '', hint = '', required = false }) {
  return `<label class="field">
    <span class="field-label">${esc(label)}${required ? '<em aria-hidden="true">*</em>' : ''}</span>
    <textarea name="${esc(name)}" rows="${Number(rows) || 4}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''}>${esc(value)}</textarea>
    ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    <span class="field-error" data-error-for="${esc(name)}"></span>
  </label>`;
}

export function colorField({ label = 'Color', name = 'color', value = COURSE_COLORS[0] }) {
  const current = /^#[0-9a-fA-F]{6}$/.test(value) ? value : COURSE_COLORS[0];
  return `<fieldset class="field color-field">
    <legend class="field-label">${esc(label)}</legend>
    <div class="color-options">
      ${COURSE_COLORS.map((c) => `<label class="color-option" style="--swatch:${c}" title="${c}">
        <input type="radio" name="${esc(name)}" value="${c}" ${c === current ? 'checked' : ''}>
        <span></span>
      </label>`).join('')}
    </div>
  </fieldset>`;
}

export function formValues(form) {
  const values = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) values[key] = typeof value === 'string' ? value.trim() : value;
  return values;
}

export function setFormErrors(form, errors = {}) {
  if (!form) return;
  form.querySelectorAll('[data-error-for]').forEach((el) => {
    const message = errors[el.dataset.errorFor] || '';
    el.textContent = message;
    const fieldEl = el.closest('.field');
    if (fieldEl) fieldEl.classList.toggle('invalid', Boolean(message));
  });
  const firstKey = Object.keys(errors)[0];
  if (firstKey) {
    const target = form.querySelector(`[name="${firstKey}"]`);
    if (target && typeof target.focus === 'function') target.focus();
  }
}

export function clearFormErrors(form) {
  setFormErrors(form, {});
}

/* ------------------------------------------------------------------ *
 * Icons — inline SVG so the app needs zero network requests.
 * ------------------------------------------------------------------ */

const ICON_PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 4.7"/><path d="m3.5 12 1.2 1.2L7 10.7"/><path d="m3.5 18 1.2 1.2L7 16.7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h2M14 14h2M8 17.5h2"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="M8.2 13.6 7 22l5-2.6L17 22l-1.2-8.4"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.4 1.6"/><path d="M9 2.5h6"/><path d="M18.5 5.5 20 7"/>',
  note: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  settings: '<path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h9M17 18h3"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6.5 7 7.5 21h9l1-14"/><path d="M10 11v6M14 11v6"/>',
  pencil: '<path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14.5 5.5 4 4"/>',
  chevronDown: '<path d="m7 10 5 5 5-5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.2v.1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
  arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  sparkles: '<path d="m12 3 1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  inbox: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M5 4h14l1 9v6H4v-6z"/>',
  logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
};

export function icon(name, className = '') {
  const path = ICON_PATHS[name] || ICON_PATHS.grid;
  return `<svg class="ic ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

/* ------------------------------------------------------------------ *
 * UI toolkit — toasts, modals, confirmations
 * ------------------------------------------------------------------ */

let activeOverlay = null;
let lastFocusedElement = null;

function toastRoot() {
  return document.getElementById('toast-root');
}

export const UI = {
  toast(message, tone = 'info', { duration } = {}) {
    const root = toastRoot();
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-dot"></span><span class="toast-msg"></span>`;
    el.querySelector('.toast-msg').textContent = message;
    root.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const ttl = duration ?? (tone === 'error' ? 6500 : 3600);
    const remove = () => {
      el.classList.remove('show');
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
    };
    el.addEventListener('click', remove);
    setTimeout(remove, ttl);
  },

  closeModal() {
    if (!activeOverlay) return;
    activeOverlay.remove();
    activeOverlay = null;
    document.body.classList.remove('modal-open');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      try { lastFocusedElement.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    lastFocusedElement = null;
  },

  /**
   * Open a modal. `body` is trusted HTML built by our own modules (escape user
   * values with esc()). Return false from onSubmit to keep the dialog open.
   */
  modal({ title, subtitle = '', body = '', submitLabel = 'Save', cancelLabel = 'Cancel', onSubmit, size = '', submitTone = 'primary', hideCancel = false }) {
    UI.closeModal();
    lastFocusedElement = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${size ? `modal-${size}` : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <div>
            <h2>${esc(title)}</h2>
            ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
          </div>
          <button type="button" class="icon-btn" data-close aria-label="Close dialog">${icon('x')}</button>
        </div>
        <form class="modal-form" novalidate>
          <div class="modal-body">${body}</div>
          <div class="modal-foot">
            ${hideCancel ? '' : `<button type="button" class="btn ghost" data-close>${esc(cancelLabel)}</button>`}
            <button type="submit" class="btn ${submitTone}">${esc(submitLabel)}</button>
          </div>
        </form>
      </div>`;
    document.body.append(overlay);
    document.body.classList.add('modal-open');
    activeOverlay = overlay;

    const form = overlay.querySelector('form');
    overlay.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => UI.closeModal()));
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) UI.closeModal();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!onSubmit) { UI.closeModal(); return; }
      let result;
      try {
        result = onSubmit(formValues(form), form);
      } catch (error) {
        console.error(error);
        UI.toast('Something went wrong while saving. Please try again.', 'error');
        return;
      }
      if (result === false) return;
      UI.closeModal();
    });

    const focusTarget = overlay.querySelector('.modal-body input:not([type="radio"]):not([type="hidden"]), .modal-body select, .modal-body textarea');
    requestAnimationFrame(() => {
      if (focusTarget) focusTarget.focus();
      else overlay.querySelector('button[type="submit"]')?.focus();
    });
    return { overlay, form };
  },

  /** Promise-based confirmation dialog. */
  confirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger', requireText = null, note = '' }) {
    return new Promise((resolve) => {
      UI.closeModal();
      lastFocusedElement = document.activeElement;
      let settled = false;
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head">
            <div><h2>${esc(title)}</h2></div>
            <button type="button" class="icon-btn" data-cancel aria-label="Close dialog">${icon('x')}</button>
          </div>
          <form class="modal-form" novalidate>
            <div class="modal-body">
              ${message ? `<p class="confirm-message">${esc(message)}</p>` : ''}
              ${note ? `<p class="confirm-note">${esc(note)}</p>` : ''}
              ${requireText ? `<label class="field">
                <span class="field-label">Type <strong>${esc(requireText)}</strong> to confirm</span>
                <input name="confirmText" autocomplete="off" spellcheck="false" placeholder="${esc(requireText)}">
              </label>` : ''}
            </div>
            <div class="modal-foot">
              <button type="button" class="btn ghost" data-cancel>${esc(cancelLabel)}</button>
              <button type="submit" class="btn ${tone}" ${requireText ? 'disabled' : ''}>${esc(confirmLabel)}</button>
            </div>
          </form>
        </div>`;
      document.body.append(overlay);
      document.body.classList.add('modal-open');
      activeOverlay = overlay;

      const form = overlay.querySelector('form');
      const confirmBtn = form.querySelector('button[type="submit"]');
      const input = form.querySelector('input[name="confirmText"]');

      const finish = (value) => {
        if (settled) return;
        settled = true;
        overlay.remove();
        activeOverlay = null;
        document.body.classList.remove('modal-open');
        if (lastFocusedElement?.focus) {
          try { lastFocusedElement.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
        lastFocusedElement = null;
        resolve(value);
      };

      overlay.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => finish(false)));
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) finish(false);
      });
      if (input) {
        input.addEventListener('input', () => {
          confirmBtn.disabled = input.value.trim() !== requireText;
        });
        requestAnimationFrame(() => input.focus());
      } else {
        requestAnimationFrame(() => confirmBtn.focus());
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (requireText && input.value.trim() !== requireText) return;
        finish(true);
      });
    });
  },
};

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeOverlay) UI.closeModal();
});

/** Simple empty-state block used across views. */
export function emptyState({ iconName = 'sparkles', title, body = '', action = '' }) {
  return `<div class="empty">
    <span class="empty-icon">${icon(iconName)}</span>
    <h3>${esc(title)}</h3>
    ${body ? `<p>${esc(body)}</p>` : ''}
    ${action ? `<div class="empty-action">${action}</div>` : ''}
  </div>`;
}
