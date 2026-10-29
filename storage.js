/**
 * storage.js — the single source of truth for SemesterOS.
 *
 * Everything lives in one localStorage key as a versioned JSON document.
 * All writes go through Store.update(), which works on a deep clone and only
 * commits when the mutation succeeds, so a thrown error can never leave the
 * app with half-written data.
 */

import {
  TASK_TYPES, TASK_STATUSES, PRIORITIES, isValidDate, isValidTime,
  uid, todayISO, addDaysISO, clamp,
} from './utils.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'SemesterOS';
const KEY = 'semesteros.v1';
const PREIMPORT_KEY = 'semesteros.preimport.v1';
const CORRUPT_KEY = 'semesteros.corrupt.v1';
const MAX_TEXT = 20000;

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

export function defaultPomodoro() {
  return { focus: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 };
}

export function defaultSettings() {
  return {
    displayName: '',
    semesterStart: '',
    semesterEnd: '',
    theme: 'dark',
    weekStart: 1,
    pomodoro: defaultPomodoro(),
    gradeScale: [],
  };
}

export function blankState() {
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(),
    courses: [],
    tasks: [],
    timetable: [],
    grades: [],
    studySessions: [],
    notes: [],
  };
}

/* ------------------------------------------------------------------ *
 * Validation / normalization
 * ------------------------------------------------------------------ */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function text(value, max = 400) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function normalizeSettings(raw, errors) {
  const settings = defaultSettings();
  if (!isObject(raw)) {
    errors.push('Settings are missing or malformed.');
    return settings;
  }
  if (typeof raw.displayName === 'string') settings.displayName = text(raw.displayName, 60).trim();
  if (raw.semesterStart) {
    if (isValidDate(raw.semesterStart)) settings.semesterStart = raw.semesterStart;
    else errors.push('Semester start date is not a valid date.');
  }
  if (raw.semesterEnd) {
    if (isValidDate(raw.semesterEnd)) settings.semesterEnd = raw.semesterEnd;
    else errors.push('Semester end date is not a valid date.');
  }
  if (settings.semesterStart && settings.semesterEnd && settings.semesterEnd < settings.semesterStart) {
    errors.push('Semester end date is before the start date.');
  }
  if (raw.theme === 'light' || raw.theme === 'dark') settings.theme = raw.theme;
  if (raw.weekStart === 0 || raw.weekStart === 1) settings.weekStart = raw.weekStart;

  if (isObject(raw.pomodoro)) {
    const p = raw.pomodoro;
    settings.pomodoro = {
      focus: isNumber(p.focus) ? clamp(Math.round(p.focus), 1, 180) : 25,
      shortBreak: isNumber(p.shortBreak) ? clamp(Math.round(p.shortBreak), 1, 60) : 5,
      longBreak: isNumber(p.longBreak) ? clamp(Math.round(p.longBreak), 1, 90) : 15,
      longBreakEvery: isNumber(p.longBreakEvery) ? clamp(Math.round(p.longBreakEvery), 1, 12) : 4,
    };
  }

  if (raw.gradeScale !== undefined) {
    if (!Array.isArray(raw.gradeScale)) {
      errors.push('Grade scale must be a list of grade bands.');
    } else {
      const seenLetters = new Set();
      const seenMins = new Set();
      for (const [index, band] of raw.gradeScale.entries()) {
        if (!isObject(band)) {
          errors.push(`Grade scale entry ${index + 1} is malformed.`);
          continue;
        }
        const letter = text(band.letter, 4).trim();
        if (!letter) {
          errors.push(`Grade scale entry ${index + 1} is missing a letter.`);
          continue;
        }
        if (seenLetters.has(letter.toUpperCase())) {
          errors.push(`Duplicate grade letter "${letter}" in grade scale.`);
          continue;
        }
        if (!isNumber(band.min) || band.min < 0 || band.min > 100) {
          errors.push(`Grade band "${letter}" needs a minimum percentage between 0 and 100.`);
          continue;
        }
        if (!isNumber(band.points) || band.points < 0 || band.points > 10) {
          errors.push(`Grade band "${letter}" needs grade points between 0 and 10.`);
          continue;
        }
        if (seenMins.has(band.min)) {
          errors.push(`Two grade bands share the same minimum (${band.min}%).`);
          continue;
        }
        seenLetters.add(letter.toUpperCase());
        seenMins.add(band.min);
        settings.gradeScale.push({ letter, min: Math.round(band.min * 10) / 10, points: Math.round(band.points * 100) / 100 });
      }
    }
  }
  return settings;
}

function normalizeCourse(raw, index, errors, newId) {
  if (!isObject(raw)) {
    errors.push(`Course ${index + 1} is malformed.`);
    return null;
  }
  const name = text(raw.name, 120).trim();
  const code = text(raw.code, 20).trim();
  if (!name) errors.push(`Course ${index + 1} is missing a name.`);
  if (!code) errors.push(`Course ${index + 1} is missing a course code.`);
  const color = /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color.toLowerCase() : '#7c6cff';
  const credits = isNumber(raw.credits) ? clamp(raw.credits, 0, 30) : 0;
  return {
    id: typeof raw.id === 'string' && raw.id && raw.id.length <= 80 ? raw.id : newId('course'),
    code,
    name,
    instructor: text(raw.instructor, 80).trim(),
    credits,
    color,
    createdAt: text(raw.createdAt, 40) || new Date().toISOString(),
  };
}

function normalizeTask(raw, index, errors, newId, courseIds) {
  if (!isObject(raw)) {
    errors.push(`Task ${index + 1} is malformed.`);
    return null;
  }
  const title = text(raw.title, 160).trim();
  if (!title) errors.push(`Task ${index + 1} is missing a title.`);
  if (!TASK_TYPES.includes(raw.type)) errors.push(`Task ${index + 1} has an unknown type.`);
  const dueDate = typeof raw.dueDate === 'string' ? raw.dueDate : '';
  if (!isValidDate(dueDate)) errors.push(`Task "${title || index + 1}" is missing a valid due date.`);
  const dueTime = raw.dueTime === '' || raw.dueTime === null || raw.dueTime === undefined
    ? ''
    : (isValidTime(raw.dueTime) ? raw.dueTime : null);
  if (dueTime === null) errors.push(`Task "${title || index + 1}" has an invalid due time.`);
  const status = TASK_STATUSES.includes(raw.status) ? raw.status : 'todo';
  const priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'medium';
  const courseId = courseIds.has(raw.courseId) ? raw.courseId : null;
  return {
    id: typeof raw.id === 'string' && raw.id && raw.id.length <= 80 ? raw.id : newId('task'),
    title,
    type: TASK_TYPES.includes(raw.type) ? raw.type : 'assignment',
    courseId,
    dueDate,
    dueTime: dueTime || '',
    priority,
    status,
    notes: text(raw.notes, MAX_TEXT),
    createdAt: text(raw.createdAt, 40) || new Date().toISOString(),
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : (status === 'done' ? new Date().toISOString() : null),
  };
}

function normalizeClass(raw, index, errors, newId, courseIds) {
  if (!isObject(raw)) {
    errors.push(`Class ${index + 1} is malformed.`);
    return null;
  }
  const day = Number(raw.day);
  if (!Number.isInteger(day) || day < 1 || day > 7) errors.push(`Class ${index + 1} has an invalid weekday.`);
  if (!isValidTime(raw.start) || !isValidTime(raw.end)) errors.push(`Class ${index + 1} needs a valid start and end time.`);
  else if (raw.start >= raw.end) errors.push(`Class ${index + 1} ends before it starts.`);
  const courseId = courseIds.has(raw.courseId) ? raw.courseId : null;
  if (!courseId) errors.push(`Class ${index + 1} is not linked to an existing course.`);
  return {
    id: typeof raw.id === 'string' && raw.id && raw.id.length <= 80 ? raw.id : newId('class'),
    courseId,
    day: Number.isInteger(day) && day >= 1 && day <= 7 ? day : 1,
    start: isValidTime(raw.start) ? raw.start : '09:00',
    end: isValidTime(raw.end) ? raw.end : '10:00',
    room: text(raw.room, 40).trim(),
    instructor: text(raw.instructor, 80).trim(),
  };
}

function normalizeGrade(raw, index, errors, newId, courseIds) {
  if (!isObject(raw)) {
    errors.push(`Grade entry ${index + 1} is malformed.`);
    return null;
  }
  const title = text(raw.title, 120).trim();
  if (!title) errors.push(`Grade entry ${index + 1} is missing a title.`);
  if (!isNumber(raw.obtained) || raw.obtained < 0) errors.push(`Grade "${title || index + 1}" needs marks obtained (0 or more).`);
  if (!isNumber(raw.max) || raw.max <= 0) errors.push(`Grade "${title || index + 1}" needs a maximum greater than 0.`);
  if (raw.weight !== undefined && (!isNumber(raw.weight) || raw.weight < 0 || raw.weight > 100)) {
    errors.push(`Grade "${title || index + 1}" has an invalid weight.`);
  }
  return {
    id: typeof raw.id === 'string' && raw.id && raw.id.length <= 80 ? raw.id : newId('grade'),
    courseId: courseIds.has(raw.courseId) ? raw.courseId : null,
    title,
    obtained: isNumber(raw.obtained) ? Math.max(0, raw.obtained) : 0,
    max: isNumber(raw.max) && raw.max > 0 ? raw.max : 100,
    weight: isNumber(raw.weight) ? clamp(raw.weight, 0, 100) : 0,
    date: typeof raw.date === 'string' && raw.date ? (isValidDate(raw.date) ? raw.date : '') : '',
  };
}

function normalizeSession(raw, index, errors, newId, courseIds) {
  if (!isObject(raw)) {
    errors.push(`Study session ${index + 1} is malformed.`);
    return null;
  }
  if (!isValidDate(raw.date)) errors.push(`Study session ${index + 1} has an invalid date.`);
  const minutes = Number(raw.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    errors.push(`Study session ${index + 1} needs a duration between 1 and 1440 minutes.`);
  }
  return {
    id: typeof raw.id === 'string' && raw.id && raw.id.length <= 80 ? raw.id : newId('session'),
    courseId: courseIds.has(raw.courseId) ? raw.courseId : null,
    title: text(raw.title, 120).trim() || 'Study session',
    date: isValidDate(raw.date) ? raw.date : todayISO(),
    start: isValidTime(raw.start) ? raw.start : '',
    minutes: Number.isFinite(minutes) ? clamp(Math.round(minutes), 1, 1440) : 25,
    status: raw.status === 'completed' ? 'completed' : 'planned',
    source: raw.source === 'pomodoro' ? 'pomodoro' : 'planner',
    createdAt: text(raw.createdAt, 40) || new Date().toISOString(),
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
  };
}

function normalizeNote(raw, index, errors, newId, courseIds) {
  if (!isObject(raw)) {
    errors.push(`Note ${index + 1} is malformed.`);
    return null;
  }
  return {
    id: typeof raw.id === 'string' && raw.id && raw.id.length <= 80 ? raw.id : newId('note'),
    courseId: courseIds.has(raw.courseId) ? raw.courseId : null,
    title: text(raw.title, 160).trim() || 'Untitled note',
    body: text(raw.body, MAX_TEXT),
    createdAt: text(raw.createdAt, 40) || new Date().toISOString(),
    updatedAt: text(raw.updatedAt, 40) || new Date().toISOString(),
  };
}

/**
 * Validate and normalize a state-like object.
 * Returns { state, errors } — callers decide whether errors are fatal.
 */
export function normalizeState(raw, { strict = true } = {}) {
  const errors = [];
  if (!isObject(raw)) {
    return { state: blankState(), errors: ['This file does not contain a SemesterOS backup object.'] };
  }
  if (raw.version !== undefined && (!Number.isInteger(raw.version) || raw.version > SCHEMA_VERSION)) {
    errors.push(`Backup version ${raw.version} is newer than this app supports (version ${SCHEMA_VERSION}).`);
  }

  const settings = normalizeSettings(raw.settings || {}, errors);
  const newId = (prefix) => uid(prefix);

  const collection = (key, label, normalizer) => {
    const value = raw[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      errors.push(`${label} must be a list.`);
      return [];
    }
    const seen = new Set();
    return value.map((item, index) => {
      const record = normalizer(item, index, errors, newId, courseIds);
      if (record) {
        if (seen.has(record.id)) record.id = newId(key);
        seen.add(record.id);
      }
      return record;
    });
  };

  // Courses drive reference checks for every other collection.
  const coursesRaw = Array.isArray(raw.courses) ? raw.courses : (raw.courses === undefined ? [] : null);
  if (coursesRaw === null) errors.push('Courses must be a list.');
  const courseIds = new Set();
  const courses = (coursesRaw || [])
    .map((item, index) => {
      const course = normalizeCourse(item, index, errors, newId);
      if (course) {
        if (courseIds.has(course.id)) course.id = newId('course');
        courseIds.add(course.id);
      }
      return course;
    })
    .filter(Boolean);

  const tasks = collection('tasks', 'Tasks', (item, index) => normalizeTask(item, index, errors, newId, courseIds));
  const timetable = collection('timetable', 'Timetable', (item, index) => normalizeClass(item, index, errors, newId, courseIds));
  const grades = collection('grades', 'Grades', (item, index) => normalizeGrade(item, index, errors, newId, courseIds));
  const studySessions = collection('studySessions', 'Study sessions', (item, index) => normalizeSession(item, index, errors, newId, courseIds));
  const notes = collection('notes', 'Notes', (item, index) => normalizeNote(item, index, errors, newId, courseIds));

  const state = {
    version: SCHEMA_VERSION,
    settings,
    courses,
    tasks: tasks.filter(Boolean),
    timetable: timetable.filter(Boolean),
    grades: grades.filter(Boolean),
    studySessions: studySessions.filter(Boolean),
    notes: notes.filter(Boolean),
  };

  if (strict && errors.length) {
    return { state, errors };
  }
  return { state, errors };
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

class SemesterStore {
  constructor() {
    this.state = blankState();
    this.listeners = new Set();
    this.storageError = null;
    this.corruptBackupFound = false;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('Saved data is not valid JSON.');
        }
        const { state, errors } = normalizeState(parsed, { strict: true });
        if (errors.length) throw new Error(errors.join(' '));
        this.state = state;
      }
    } catch (error) {
      console.error('SemesterOS storage load failed:', error);
      this.storageError = 'SemesterOS could not read your saved data. Your original data was kept as a safety copy.';
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          localStorage.setItem(CORRUPT_KEY, raw);
          this.corruptBackupFound = true;
        }
      } catch { /* storage unavailable */ }
      this.state = blankState();
    }

    // Probe write access separately so a full quota never discards data that
    // was read successfully.
    try {
      localStorage.setItem(`${KEY}.probe`, '1');
      localStorage.removeItem(`${KEY}.probe`);
    } catch {
      this.storageError = 'Browser storage is unavailable or full. Changes can only live in this tab — export a backup now.';
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== KEY || !event.newValue) return;
      try {
        const { state, errors } = normalizeState(JSON.parse(event.newValue), { strict: true });
        if (!errors.length) {
          this.state = state;
          this.notify({ external: true });
        }
      } catch { /* ignore malformed writes from other tabs */ }
    });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(meta = {}) {
    for (const fn of this.listeners) {
      try { fn(this.state, meta); } catch (error) { console.error('Render error:', error); }
    }
  }

  get() {
    return this.state;
  }

  get settings() {
    return this.state.settings;
  }

  getCourse(id) {
    return this.state.courses.find((c) => c.id === id) || null;
  }

  courseMap() {
    return new Map(this.state.courses.map((c) => [c.id, c]));
  }

  persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
      if (this.storageError && !this.corruptBackupFound) this.storageError = null;
      return true;
    } catch (error) {
      console.error('SemesterOS save failed:', error);
      const quota = error && (error.name === 'QuotaExceededError' || error.code === 22);
      this.storageError = quota
        ? 'Browser storage is full. Your latest change is only in this tab — export a backup and remove old data.'
        : 'Browser storage is unavailable. Your latest change is only in this tab — export a backup before closing.';
      return false;
    }
  }

  /**
   * Atomically mutate state. The mutator receives a deep clone; throwing or
   * returning false aborts the write and leaves the store untouched.
   */
  update(mutator, { silent = false } = {}) {
    let draft;
    try {
      draft = clone(this.state);
    } catch {
      draft = this.state;
    }
    let result;
    try {
      result = mutator(draft);
    } catch (error) {
      console.error('Mutation failed:', error);
      return false;
    }
    if (result === false) return false;
    this.state = draft;
    this.persist();
    if (!silent) this.notify();
    return true;
  }

  updateSettings(patch, options = {}) {
    return this.update((state) => {
      state.settings = { ...state.settings, ...patch };
    }, options);
  }

  /** Delete a course and everything attached to it. Returns what was removed. */
  deleteCourse(id) {
    const counts = {
      tasks: this.state.tasks.filter((t) => t.courseId === id).length,
      classes: this.state.timetable.filter((c) => c.courseId === id).length,
      grades: this.state.grades.filter((g) => g.courseId === id).length,
      sessions: this.state.studySessions.filter((s) => s.courseId === id).length,
      notes: this.state.notes.filter((n) => n.courseId === id).length,
    };
    this.update((state) => {
      state.courses = state.courses.filter((c) => c.id !== id);
      state.tasks = state.tasks.filter((t) => t.courseId !== id);
      state.timetable = state.timetable.filter((c) => c.courseId !== id);
      state.grades = state.grades.filter((g) => g.courseId !== id);
      state.studySessions = state.studySessions.filter((s) => s.courseId !== id);
      state.notes = state.notes.filter((n) => n.courseId !== id);
    });
    return counts;
  }

  /* ---------------- Backup / restore ---------------- */

  buildExport() {
    return {
      app: APP_ID,
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: clone(this.state.settings),
      courses: clone(this.state.courses),
      tasks: clone(this.state.tasks),
      timetable: clone(this.state.timetable),
      grades: clone(this.state.grades),
      studySessions: clone(this.state.studySessions),
      notes: clone(this.state.notes),
    };
  }

  exportText() {
    return JSON.stringify(this.buildExport(), null, 2);
  }

  /** Validate backup text without touching current data. */
  validateBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, errors: ['That file is not valid JSON. Nothing was changed.'], counts: null };
    }
    if (!isObject(parsed)) {
      return { ok: false, errors: ['That file does not contain a SemesterOS backup. Nothing was changed.'], counts: null };
    }
    if (parsed.app !== undefined && parsed.app !== APP_ID) {
      return { ok: false, errors: ['That backup was not created by SemesterOS. Nothing was changed.'], counts: null };
    }
    const { state, errors } = normalizeState(parsed, { strict: true });
    if (errors.length) {
      return { ok: false, errors, counts: null };
    }
    const counts = {
      courses: state.courses.length,
      tasks: state.tasks.length,
      classes: state.timetable.length,
      grades: state.grades.length,
      sessions: state.studySessions.length,
      notes: state.notes.length,
    };
    return { ok: true, errors: [], state, counts, exportedAt: parsed.exportedAt || null };
  }

  /**
   * Replace all data with a validated backup. Current data is snapshotted to a
   * safety key first; a failed import never reaches this method.
   */
  importState(state) {
    let safetySaved = false;
    try {
      localStorage.setItem(PREIMPORT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        data: this.buildExport(),
      }));
      safetySaved = true;
    } catch {
      safetySaved = false;
    }
    this.state = state;
    const persisted = this.persist();
    this.notify();
    return { persisted, safetySaved };
  }

  getSafetyCopy() {
    try {
      const raw = localStorage.getItem(PREIMPORT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!isObject(parsed) || !parsed.savedAt) return null;
      const { state, errors } = normalizeState(parsed.data, { strict: false });
      if (errors.length) return null;
      return {
        savedAt: parsed.savedAt,
        counts: {
          courses: state.courses.length,
          tasks: state.tasks.length,
          classes: state.timetable.length,
          grades: state.grades.length,
          sessions: state.studySessions.length,
          notes: state.notes.length,
        },
        state,
      };
    } catch {
      return null;
    }
  }

  restoreSafetyCopy() {
    const copy = this.getSafetyCopy();
    if (!copy) return false;
    // Snapshot current state too, so restoring is itself reversible.
    try {
      localStorage.setItem(PREIMPORT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: this.buildExport() }));
    } catch { /* best effort */ }
    this.state = copy.state;
    this.persist();
    this.notify();
    return true;
  }

  clearAll() {
    this.state = blankState();
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(PREIMPORT_KEY);
      localStorage.removeItem(CORRUPT_KEY);
    } catch { /* ignore */ }
    this.corruptBackupFound = false;
    this.storageError = null;
    this.notify();
  }

  storageInfo() {
    let bytes = 0;
    try {
      bytes = new Blob([JSON.stringify(this.state)]).size;
    } catch { /* ignore */ }
    let available = true;
    try {
      localStorage.setItem(`${KEY}.probe`, '1');
      localStorage.removeItem(`${KEY}.probe`);
    } catch {
      available = false;
    }
    return { bytes, available, error: this.storageError };
  }

  /* ---------------- Optional sample data ---------------- */

  /**
   * Build a realistic sample semester, dated relative to today.
   * Only ever applied when the user explicitly asks for it.
   */
  static buildSampleState() {
    const today = new Date();
    const iso = (offset) => addDaysISO(todayISO(), offset);
    const termStart = iso(-49);
    const termEnd = iso(63);
    const state = blankState();
    state.settings = {
      ...state.settings,
      semesterStart: termStart,
      semesterEnd: termEnd,
      gradeScale: [
        { letter: 'A', min: 90, points: 4 },
        { letter: 'A-', min: 85, points: 3.7 },
        { letter: 'B+', min: 80, points: 3.3 },
        { letter: 'B', min: 75, points: 3 },
        { letter: 'B-', min: 70, points: 2.7 },
        { letter: 'C+', min: 65, points: 2.3 },
        { letter: 'C', min: 60, points: 2 },
        { letter: 'D', min: 50, points: 1 },
        { letter: 'F', min: 0, points: 0 },
      ],
    };

    const cs = { id: uid('course'), code: 'BSAI-201', name: 'Data Structures & Algorithms', instructor: 'Dr. A. Rahman', credits: 4, color: '#7c6cff', createdAt: new Date().toISOString() };
    const ai = { id: uid('course'), code: 'BSAI-210', name: 'Foundations of Artificial Intelligence', instructor: 'Ms. S. Khan', credits: 3, color: '#35d3b0', createdAt: new Date().toISOString() };
    const la = { id: uid('course'), code: 'MATH-204', name: 'Linear Algebra', instructor: 'Dr. M. Iqbal', credits: 3, color: '#4f9dff', createdAt: new Date().toISOString() };
    const eng = { id: uid('course'), code: 'ENG-112', name: 'Technical Writing', instructor: 'Mr. H. Ali', credits: 2, color: '#f5b53f', createdAt: new Date().toISOString() };
    state.courses = [cs, ai, la, eng];

    const task = (overrides) => ({
      id: uid('task'), courseId: cs.id, type: 'assignment', priority: 'medium', status: 'todo',
      notes: '', createdAt: new Date().toISOString(), completedAt: null, dueTime: '',
      ...overrides,
    });
    state.tasks = [
      task({ title: 'Graph traversal problem set', courseId: cs.id, type: 'assignment', dueDate: iso(-2), priority: 'high' }),
      task({ title: 'Neural networks reading response', courseId: ai.id, type: 'assignment', dueDate: iso(0), dueTime: '23:00', priority: 'high' }),
      task({ title: 'Quiz 3 — Sorting & hashing', courseId: cs.id, type: 'quiz', dueDate: iso(2), dueTime: '09:30', priority: 'medium' }),
      task({ title: 'Eigenvalues lab report', courseId: la.id, type: 'lab', dueDate: iso(4), priority: 'medium' }),
      task({ title: 'Search algorithm project proposal', courseId: ai.id, type: 'project', dueDate: iso(9), priority: 'high' }),
      task({ title: 'Technical memo rewrite', courseId: eng.id, type: 'assignment', dueDate: iso(-6), priority: 'low', status: 'done', completedAt: new Date().toISOString() }),
      task({ title: 'Midterm exam', courseId: la.id, type: 'midterm', dueDate: iso(13), dueTime: '11:00', priority: 'high' }),
      task({ title: 'Linked lists worksheet', courseId: cs.id, type: 'assignment', dueDate: iso(-12), priority: 'low', status: 'done', completedAt: new Date().toISOString() }),
    ];

    const session = (courseId, day, start, end) => ({ id: uid('class'), courseId, day, start, end, room: '', instructor: '' });
    state.timetable = [
      { ...session(cs.id, 1, '09:00', '10:30'), room: 'CS-104', instructor: cs.instructor },
      { ...session(la.id, 1, '11:00', '12:30'), room: 'M-211', instructor: la.instructor },
      { ...session(ai.id, 2, '10:00', '11:30'), room: 'AI-Lab 2', instructor: ai.instructor },
      { ...session(eng.id, 2, '14:00', '15:00'), room: 'H-105', instructor: eng.instructor },
      { ...session(cs.id, 2, '14:30', '16:00'), room: 'CS-LAB 1', instructor: 'Lab instructor' },
      { ...session(cs.id, 3, '09:00', '10:30'), room: 'CS-104', instructor: cs.instructor },
      { ...session(ai.id, 4, '11:00', '12:30'), room: 'AI-Lab 2', instructor: ai.instructor },
      { ...session(la.id, 5, '09:00', '10:30'), room: 'M-211', instructor: la.instructor },
    ];

    state.grades = [
      { id: uid('grade'), courseId: cs.id, title: 'Quiz 1', obtained: 18, max: 20, weight: 10, date: iso(-30) },
      { id: uid('grade'), courseId: cs.id, title: 'Assignment 1', obtained: 42, max: 50, weight: 15, date: iso(-21) },
      { id: uid('grade'), courseId: cs.id, title: 'Midterm', obtained: 78, max: 100, weight: 25, date: iso(-10) },
      { id: uid('grade'), courseId: ai.id, title: 'Reading quiz', obtained: 9, max: 10, weight: 10, date: iso(-14) },
      { id: uid('grade'), courseId: la.id, title: 'Problem set 1', obtained: 24, max: 25, weight: 20, date: iso(-18) },
      { id: uid('grade'), courseId: eng.id, title: 'Technical memo', obtained: 38, max: 40, weight: 30, date: iso(-7) },
    ];

    const completedStudy = (courseId, daysAgo, minutes) => ({
      id: uid('session'), courseId, title: 'Pomodoro focus', date: iso(-daysAgo), start: '', minutes,
      status: 'completed', source: 'pomodoro', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    });
    state.studySessions = [
      completedStudy(cs.id, 1, 50), completedStudy(ai.id, 1, 25), completedStudy(la.id, 2, 75),
      completedStudy(cs.id, 3, 50), completedStudy(eng.id, 4, 25), completedStudy(ai.id, 5, 50),
      { id: uid('session'), courseId: cs.id, title: 'Review graph algorithms', date: iso(1), start: '17:00', minutes: 45, status: 'planned', source: 'planner', createdAt: new Date().toISOString(), completedAt: null },
      { id: uid('session'), courseId: la.id, title: 'Practice eigenvalue problems', date: iso(2), start: '16:00', minutes: 60, status: 'planned', source: 'planner', createdAt: new Date().toISOString(), completedAt: null },
    ];

    state.notes = [
      { id: uid('note'), courseId: cs.id, title: 'Big-O cheat sheet', body: 'O(1) — constant\nO(log n) — binary search\nO(n) — linear scan\nO(n log n) — merge sort\nO(n²) — nested loops\n\nRemember: drop constants and lower-order terms.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: uid('note'), courseId: ai.id, title: 'Project ideas', body: '1. Heuristic search for campus navigation\n2. Simple recommendation model for study resources\n\nDiscuss scope with Ms. Khan before the proposal deadline.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];

    return state;
  }

  seedSample() {
    const sample = SemesterStore.buildSampleState();
    this.state = sample;
    this.persist();
    this.notify();
  }
}

export const Store = new SemesterStore();
