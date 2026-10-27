'use strict';

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const formEl = document.getElementById('add-form');
const nickEl = document.getElementById('nick');
const tpl = document.getElementById('row-tpl');

let entries = [];
let notes = {};

// Each note lives under its own key: storage.sync caps a single item at 8 KB,
// and keeping notes out of `entries` means editing one doesn't reload the tabs.
// Must match noteKey() in content.js.
const normNick = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const noteKey = (e) => (e.uid ? `note:u${e.uid}` : `note:n${normNick(e.nick)}`);

function persist() {
  chrome.storage.sync.set({ entries });
}

// Typing is debounced: storage.sync limits writes to 120 per minute.
const noteTimers = new Map();

function saveNote(key, text) {
  if (text.trim()) notes[key] = text;
  else delete notes[key];

  clearTimeout(noteTimers.get(key));
  noteTimers.set(key, setTimeout(() => {
    noteTimers.delete(key);
    if (notes[key]) chrome.storage.sync.set({ [key]: notes[key] });
    else chrome.storage.sync.remove(key);
  }, 400));
}

// The popup closes on any outside click — flush notes still waiting on the debounce.
window.addEventListener('pagehide', () => {
  for (const [key, timer] of noteTimers) {
    clearTimeout(timer);
    if (notes[key]) chrome.storage.sync.set({ [key]: notes[key] });
    else chrome.storage.sync.remove(key);
  }
  noteTimers.clear();
});

function render() {
  listEl.textContent = '';
  emptyEl.style.display = entries.length ? 'none' : 'block';

  entries.forEach((entry, index) => {
    const li = tpl.content.firstElementChild.cloneNode(true);

    const name = li.querySelector('.name');
    name.textContent = entry.nick || `id ${entry.uid}`;
    if (entry.nick && entry.uid) {
      const uid = document.createElement('small');
      uid.textContent = `id ${entry.uid}`;
      name.appendChild(uid);
    }

    const topic = li.querySelector('.topic');
    topic.value = entry.topic || 'replace';
    topic.addEventListener('change', () => {
      entry.topic = topic.value;
      persist();
    });

    const post = li.querySelector('.post');
    post.value = entry.post || 'replace';
    post.addEventListener('change', () => {
      entry.post = post.value;
      persist();
    });

    const delToggle = li.querySelector('.del-toggle');
    const del = li.querySelector('.del');
    del.checked = !!entry.del;
    delToggle.classList.toggle('on', !!entry.del);
    del.addEventListener('change', () => {
      entry.del = del.checked;
      delToggle.classList.toggle('on', del.checked);
      persist();
    });

    const key = noteKey(entry);
    const note = li.querySelector('.note');
    note.value = notes[key] || '';
    note.addEventListener('input', () => saveNote(key, note.value));

    li.querySelector('.remove').addEventListener('click', () => {
      entries.splice(index, 1);
      persist();
      clearTimeout(noteTimers.get(key));
      delete notes[key];
      chrome.storage.sync.remove(key);
      render();
    });

    listEl.appendChild(li);
  });
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = nickEl.value.trim();
  if (!nick) return;
  const exists = entries.some((x) => (x.nick || '').toLowerCase() === nick.toLowerCase());
  if (!exists) {
    entries.push({ nick, uid: null, topic: 'replace', post: 'replace', del: false });
    persist();
    render();
  }
  nickEl.value = '';
});

chrome.storage.sync.get(null, (data) => {
  entries = data.entries || [];
  notes = {};
  for (const [k, v] of Object.entries(data)) if (k.startsWith('note:')) notes[k] = v;
  render();
});
