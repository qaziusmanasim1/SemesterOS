/**
 * notes.js — course-specific notes with debounced autosave.
 * Edits are saved through a silent store update so the editor never loses
 * focus or cursor position mid-typing.
 */

import { Store } from './storage.js';
import {
  esc, uid, icon, UI, emptyState, debounce, fmtDate,
} from './utils.js';

const ui = { search: '', course: 'all', activeId: null, focusTitle: false };
let draft = null;
let dirty = false;

const autosave = debounce(() => {
  if (dirty) flushSave();
}, 700);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function allNotes() {
  return Store.get().notes.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function filteredNotes() {
  return allNotes().filter((note) => {
    if (ui.course === '__none') {
      if (note.courseId) return false;
    } else if (ui.course !== 'all' && note.courseId !== ui.course) return false;
    if (ui.search) {
      const course = Store.getCourse(note.courseId);
      const haystack = `${note.title} ${note.body} ${course?.code || ''} ${course?.name || ''}`.toLowerCase();
      if (!haystack.includes(ui.search.toLowerCase())) return false;
    }
    return true;
  });
}

function ensureDraft() {
  const notes = Store.get().notes;
  if (!notes.length) {
    ui.activeId = null;
    draft = null;
    return null;
  }
  if (!ui.activeId || !notes.some((n) => n.id === ui.activeId)) {
    ui.activeId = notes.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0].id;
  }
  const note = notes.find((n) => n.id === ui.activeId);
  if (!note) return null;
  if (!draft || draft.id !== note.id) {
    draft = { id: note.id, title: note.title, body: note.body, courseId: note.courseId };
  }
  return draft;
}

function updateSaveState(message) {
  const el = document.getElementById('note-save-state');
  if (!el) return;
  el.classList.toggle('dirty', dirty);
  el.innerHTML = `<span class="dot"></span>${dirty ? 'Unsaved changes' : esc(message || 'Saved')}`;
}

function refreshList() {
  const listEl = document.querySelector('[data-notes-list]');
  if (!listEl) return;
  const notes = filteredNotes();
  if (!notes.length) {
    listEl.innerHTML = `<div class="empty small">
      <span class="empty-icon">${icon('search')}</span>
      <h3>No notes found</h3>
      <p>${ui.search || ui.course !== 'all' ? 'Try a different search or course filter.' : 'Create your first note to capture lecture ideas.'}</p>
    </div>`;
    return;
  }
  listEl.innerHTML = notes.map((note) => {
    const course = Store.getCourse(note.courseId);
    return `<button class="note-item ${note.id === ui.activeId ? 'active' : ''}" data-note-id="${esc(note.id)}">
      <div class="note-item-top">
        <span class="dot" style="background:${esc(course?.color || '#6a7695')}"></span>
        <span class="note-item-title">${esc(note.title)}</span>
      </div>
      <div class="note-item-preview">${esc((note.body || 'No content yet.').replace(/\s+/g, ' ').slice(0, 110))}</div>
      <div class="note-item-meta">${esc(course?.code || 'General')} · ${esc(fmtDate((note.updatedAt || '').slice(0, 10), { year: false }))}</div>
    </button>`;
  }).join('');
}

function wordCount(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function updateCounters() {
  const countEl = document.getElementById('note-word-count');
  if (countEl && draft) countEl.textContent = `${wordCount(draft.body)} words`;
}

function flushSave() {
  autosave.cancel();
  if (!dirty || !draft) return false;
  const { id } = draft;
  const title = (draft.title || '').trim() || 'Untitled note';
  const body = draft.body || '';
  const courseId = draft.courseId || null;
  const ok = Store.update((state) => {
    const note = state.notes.find((n) => n.id === id);
    if (!note) return false;
    note.title = title;
    note.body = body;
    note.courseId = courseId;
    note.updatedAt = new Date().toISOString();
  }, { silent: true });
  dirty = false;
  updateSaveState(ok ? 'Saved' : 'Could not save');
  refreshList();
  return ok;
}

function markDirty() {
  dirty = true;
  updateSaveState();
  updateCounters();
  autosave();
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export function createNote() {
  if (!Store.get().courses.length) {
    UI.toast('Notes work best with a course — add one first.', 'warn');
  }
  const now = new Date().toISOString();
  const note = {
    id: uid('note'),
    courseId: ui.course !== 'all' && ui.course !== '__none' ? ui.course : null,
    title: '',
    body: '',
    createdAt: now,
    updatedAt: now,
  };
  ui.activeId = note.id;
  draft = { id: note.id, title: '', body: '', courseId: note.courseId };
  dirty = false;
  ui.focusTitle = true;
  Store.update((state) => { state.notes.push(note); });
  UI.toast('New note created.', 'success');
}

async function deleteActiveNote() {
  const note = Store.get().notes.find((n) => n.id === ui.activeId);
  if (!note) return;
  const ok = await UI.confirm({
    title: 'Delete this note?',
    message: `"${note.title || 'Untitled note'}" will be permanently deleted.`,
    confirmLabel: 'Delete note',
  });
  if (!ok) return;
  autosave.cancel();
  dirty = false;
  draft = null;
  ui.activeId = null;
  Store.update((state) => { state.notes = state.notes.filter((n) => n.id !== note.id); });
  UI.toast('Note deleted.', 'success');
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

export const NotesView = {
  render(root) {
    // Never lose pending edits when another view triggers a re-render.
    if (dirty) flushSave();

    const notes = allNotes();
    const filtered = filteredNotes();
    const active = ensureDraft();
    const courses = Store.get().courses;

    if (ui.course !== 'all' && ui.course !== '__none' && !Store.getCourse(ui.course)) ui.course = 'all';

    const courseSelectOptions = [
      `<option value="">General note</option>`,
      ...courses.map((c) => `<option value="${esc(c.id)}" ${active?.courseId === c.id ? 'selected' : ''}>${esc(c.code)} — ${esc(c.name)}</option>`),
    ].join('');

    const listPanel = `<div class="notes-panel">
      <div class="notes-panel-head">
        <div class="search-box">
          ${icon('search')}
          <input type="search" id="notes-search" placeholder="Search notes…" value="${esc(ui.search)}" aria-label="Search notes">
        </div>
        <div class="row">
          <select id="notes-course-filter" aria-label="Filter notes by course">
            <option value="all">All courses</option>
            ${courses.map((c) => `<option value="${esc(c.id)}" ${ui.course === c.id ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}
            ${notes.some((n) => !n.courseId) ? `<option value="__none" ${ui.course === '__none' ? 'selected' : ''}>General</option>` : ''}
          </select>
          <button class="icon-btn" data-new-note title="New note" aria-label="New note" style="border:1px solid var(--border)">${icon('plus')}</button>
        </div>
      </div>
      <div class="notes-list" data-notes-list></div>
    </div>`;

    const editor = active
      ? `<div class="notes-editor">
          <div class="editor-head">
            <select class="course-select" id="note-course-select" aria-label="Note course">
              ${courseSelectOptions}
            </select>
            <span class="badge-soft" style="margin-left:auto">${esc(fmtDate((Store.get().notes.find((n) => n.id === active.id)?.updatedAt || '').slice(0, 10), { year: false }) || 'New note')}</span>
            <button class="icon-btn danger" data-delete-note title="Delete note" aria-label="Delete note">${icon('trash')}</button>
            <button class="btn small" data-save-note>${icon('check')} Save</button>
          </div>
          <input class="editor-title" id="note-title" placeholder="Note title" maxlength="160" value="${esc(active.title)}" aria-label="Note title">
          <div class="editor-body-wrap">
            <textarea class="editor-textarea" id="note-body" placeholder="Start writing… lecture ideas, formulas, questions to ask." aria-label="Note content">${esc(active.body)}</textarea>
          </div>
          <div class="editor-foot">
            <span id="note-word-count">${wordCount(active.body)} words</span>
            <span class="save-state" id="note-save-state"><span class="dot"></span>Saved</span>
          </div>
        </div>`
      : `<div class="notes-editor notes-empty">${emptyState({
        iconName: 'note',
        title: notes.length ? 'No notes in this filter' : 'No notes yet',
        body: notes.length
          ? 'Clear the filter or create a new note.'
          : 'Write down lecture insights, formulas and questions. Notes can belong to a specific course.',
        action: '<button class="btn primary" data-new-note>' + icon('plus') + ' Create a note</button>',
      })}</div>`;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${icon('note')} Notes</p>
          <h2>Your second brain, per course</h2>
          <p class="lede">${notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} · autosaved on this device.` : 'Capture lecture notes and keep them attached to the right course.'}</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" data-new-note>${icon('plus')} New note</button>
        </div>
      </div>
      <div class="notes-layout">${listPanel}${editor}</div>`;

    refreshList();

    if (ui.focusTitle) {
      ui.focusTitle = false;
      requestAnimationFrame(() => {
        const titleEl = document.getElementById('note-title');
        if (titleEl) {
          titleEl.focus();
          titleEl.select();
        }
      });
    }

    root.oninput = (event) => {
      const target = event.target;
      if (target.id === 'notes-search') {
        ui.search = target.value;
        refreshList();
        return;
      }
      if (!draft) return;
      if (target.id === 'note-title') {
        draft.title = target.value;
        markDirty();
      } else if (target.id === 'note-body') {
        draft.body = target.value;
        markDirty();
      }
    };

    root.onchange = (event) => {
      const target = event.target;
      if (target.id === 'notes-course-filter') {
        ui.course = target.value;
        refreshList();
        return;
      }
      if (target.id === 'note-course-select' && draft) {
        draft.courseId = target.value || null;
        markDirty();
      }
    };

    root.onclick = (event) => {
      const noteBtn = event.target.closest('[data-note-id]');
      if (noteBtn) {
        if (noteBtn.dataset.noteId === ui.activeId) return;
        flushSave();
        ui.activeId = noteBtn.dataset.noteId;
        draft = null;
        NotesView.render(root);
        return;
      }
      if (event.target.closest('[data-new-note]')) {
        flushSave();
        createNote();
        return;
      }
      if (event.target.closest('[data-delete-note]')) {
        deleteActiveNote();
        return;
      }
      if (event.target.closest('[data-save-note]')) {
        const ok = flushSave();
        UI.toast(ok ? 'Note saved.' : 'Note could not be saved.', ok ? 'success' : 'error');
      }
    };

    updateSaveState();
  },
};

window.addEventListener('beforeunload', () => {
  if (dirty) flushSave();
});

// Let data export capture a note that is still inside the autosave window.
window.addEventListener('semesteros:flush', () => {
  if (dirty) flushSave();
});
