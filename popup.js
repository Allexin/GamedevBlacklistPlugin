'use strict';

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const formEl = document.getElementById('add-form');
const nickEl = document.getElementById('nick');
const tpl = document.getElementById('row-tpl');

let entries = [];

function persist() {
  chrome.storage.sync.set({ entries });
}

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

    li.querySelector('.remove').addEventListener('click', () => {
      entries.splice(index, 1);
      persist();
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

chrome.storage.sync.get({ entries: [] }, (data) => {
  entries = data.entries;
  render();
});
