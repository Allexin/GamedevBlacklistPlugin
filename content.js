/* GameDev.ru Blacklist — content script.

   Per-user settings (each entry):
     - topic: 'show' | 'hide' | 'replace'  — what to do with topics they started.
     - post:  'show' | 'hide' | 'replace'  — what to do with their posts.
     - del:   boolean                       — also auto-delete their posts in your
                                              own topics (independent of `post`).

   Deletion only ever clicks the delete control the site itself rendered
   (button[data-url*="delmes="]) — so it works exactly where the site allows it
   (own topic, deletable author) and nowhere else. Where deletion is off or not
   possible, the `post` action applies instead. */

(() => {
  'use strict';

  const TOPIC_LABEL = 'Автор темы в ЧС';
  const POST_LABEL = 'Пост автора в ЧС';
  const NICK_LABEL = 'Автор в ЧС';

  const DEFAULTS = { entries: [] };

  const topicActionOf = (e) => e.topic || 'replace';
  const postActionOf = (e) => e.post || 'replace';

  let state = { ...DEFAULTS };
  let notes = {};
  let byNick = new Map();
  let byUid = new Map();

  // Confirmation / topic-delete pages: never run filtering there.
  const isServicePage = /[?&](delmes|deltopic)\b/i.test(location.search) || /a=del/i.test(location.search);

  const normNick = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function rebuildIndex() {
    byNick = new Map();
    byUid = new Map();
    for (const e of state.entries) {
      if (e.nick) byNick.set(normNick(e.nick), e);
      if (e.uid) byUid.set(String(e.uid), e);
    }
  }

  // Notes are stored per user under their own keys. Must match noteKey() in popup.js.
  const noteKey = (e) => (e.uid ? `note:u${e.uid}` : `note:n${normNick(e.nick)}`);
  const noteOf = (e) => (e && notes[noteKey(e)]) || '';

  function getEntry(nick, uid) {
    if (uid != null && byUid.has(String(uid))) return byUid.get(String(uid));
    if (nick != null && byNick.has(normNick(nick))) return byNick.get(normNick(nick));
    return null;
  }

  /* ---------------- Topic lists ---------------- */

  function processTopicList() {
    for (const span of document.querySelectorAll('span.q.small')) {
      const row = span.closest('div.row');
      if (!row || row.dataset.gdblChecked) continue;
      row.dataset.gdblChecked = '1';

      const raw = span.textContent || '';
      const author = raw.split('…')[0].split('[')[0].trim();
      if (!author) continue;
      const entry = getEntry(author, null);
      if (!entry) continue;

      const act = topicActionOf(entry);
      if (act === 'show') continue;

      const link = row.querySelector('a[href*="forum/?id="]');
      if (!link) continue;
      const container = row.parentElement || row;

      if (act === 'hide') {
        container.classList.add('gdbl-hidden');
        continue;
      }
      container.classList.add('gdbl-topic');
      link.textContent = TOPIC_LABEL;
      link.removeAttribute('title');
      row.querySelector('span.nobr')?.remove();
      span.classList.add('gdbl-hidden');
    }
  }

  /* ---------------- Topic page ---------------- */

  const delQueue = [];
  let draining = false;

  function processPosts() {
    for (const head of document.querySelectorAll('div.head[id^="m"]')) {
      if (head.dataset.gdblChecked) continue;
      head.dataset.gdblChecked = '1';

      const link = head.querySelector('li.bold a[href*="/users/?id="]');
      const nick = link ? link.textContent.trim()
                        : (head.querySelector('li.bold')?.textContent || '').trim();
      const uid = link ? new URL(link.href, location.href).searchParams.get('id') : null;
      if (!nick && !uid) continue;

      const entry = getEntry(nick, uid);
      addBlockButton(head, nick, uid, entry);
      if (!entry) continue;

      const parts = postParts(head);
      if (!parts.length || !parts[0].classList.contains('overflow')) continue;

      // The opening post carries the topic title — apply the topic action to it.
      if (head.id === 'm0') applyTopicOnPage(topicActionOf(entry));

      // Delete has priority when enabled for this user and actually available.
      if (entry.del && !head.dataset.gdblDelete) {
        const delBtn = head.querySelector('button[data-url*="delmes="]');
        if (delBtn) {
          head.dataset.gdblDelete = '1';
          enqueueDelete(delBtn.getAttribute('data-url'), head, parts);
          // hide while deletion runs
          for (const el of [head, ...parts]) el.classList.add('gdbl-hidden');
          continue;
        }
      }

      applyPost(head, parts, postActionOf(entry), noteOf(entry));
    }

    if (delQueue.length) drainDeleteQueue();
  }

  // A post body is not always a single block: a full-width image (div.full) or a
  // spoiler (div#spoilerN) closes the first div.overflow, and the rest of the post
  // continues as sibling blocks up to the next head.
  function postParts(head) {
    const parts = [];
    for (let el = head.nextElementSibling;
         el && el.matches('.overflow, .full, [id^="spoiler"]');
         el = el.nextElementSibling) {
      parts.push(el);
    }
    return parts;
  }

  function applyPost(head, parts, act, note) {
    if (act === 'show') return;
    if (act === 'hide') {
      for (const el of [head, ...parts]) el.classList.add('gdbl-hidden');
      return;
    }
    head.classList.add('gdbl-post-head');
    maskNick(head);
    collapseBody(parts, note);
  }

  // Topic title (h1) + tab title on an open topic page, per the topic action.
  function applyTopicOnPage(act) {
    if (act === 'show') return;
    const h1 = document.querySelector('h1');
    if (act === 'hide') {
      h1?.classList.add('gdbl-hidden');
      return;
    }
    if (h1) h1.textContent = TOPIC_LABEL;
    document.title = TOPIC_LABEL;
  }

  // Nickname, real name (title) and avatar all reveal the author — strip them all.
  function maskNick(head) {
    const nickItem = head.querySelector('li.bold');
    if (nickItem) {
      nickItem.textContent = NICK_LABEL;
      nickItem.classList.add('gdbl-nick');
    }
    head.querySelector('div.pic')?.remove();
  }

  // The first part becomes the stub; everything else moves under it into the
  // hidden original, so the whole post reveals and hides as one.
  function collapseBody(parts, note) {
    const [body, ...rest] = parts;
    if (body.dataset.gdblCollapsed) return;
    body.dataset.gdblCollapsed = '1';
    body.classList.add('gdbl-post');

    const original = document.createElement('div');
    original.className = 'gdbl-original';
    while (body.firstChild) original.appendChild(body.firstChild);
    for (const el of rest) original.appendChild(el);

    const stub = document.createElement('div');
    stub.className = 'gdbl-stub';
    stub.textContent = POST_LABEL;
    stub.title = note ? `${note}\n\nНажмите, чтобы показать / скрыть` : 'Показать / скрыть';
    stub.addEventListener('click', () => body.classList.toggle('gdbl-revealed'));

    body.appendChild(stub);
    body.appendChild(original);
  }

  function addBlockButton(head, nick, uid, entry) {
    const right = head.querySelector('div.right');
    if (!right || right.querySelector('.gdbl-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'gdbl-btn';
    btn.type = 'button';
    btn.textContent = entry ? 'из ЧС' : 'в ЧС';
    const note = noteOf(entry);
    btn.title = entry ? `Убрать автора из чёрного списка${note ? `\n\nЗаметка: ${note}` : ''}`
                      : `Добавить ${nick} в чёрный список`;
    btn.addEventListener('click', () => (entry ? removeEntry(nick, uid) : addEntry(nick, uid)));
    right.insertBefore(btn, right.firstChild);
  }

  /* ---------------- Deletion ---------------- */

  function enqueueDelete(url, head, parts) {
    if (url) delQueue.push({ url, head, parts });
  }

  async function drainDeleteQueue() {
    if (draining) return;
    draining = true;
    try {
      while (delQueue.length) {
        const job = delQueue.shift();
        try {
          if (await performDelete(job.url)) {
            job.head.remove();
            for (const el of job.parts) el.remove();
          }
          // On failure the post stays hidden (already gdbl-hidden) — safe default.
        } catch (err) {
          console.warn('[gdbl] delete failed:', job.url, err);
        }
      }
    } finally {
      draining = false;
    }
  }

  // Two-step: GET the confirmation page ("Удалить сообщение"), then POST its form.
  // The confirm form is <form name="postform"> with hidden action=autopost + a
  // per-page CSRF token (huyita). We deliberately DROP the "issendmes" checkbox
  // (no "message deleted" PM to the author) and the notification text (also spares
  // us Windows-1251 re-encoding). Conservative: no token found → abort, delete nothing.
  async function performDelete(delUrl) {
    const absUrl = new URL(delUrl, location.href).href;
    const resp = await fetch(absUrl, { credentials: 'include' });
    if (!resp.ok) return false;

    const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
    const form = doc.querySelector('form[name="postform"]')
              || [...doc.querySelectorAll('form')].find((f) => f.querySelector('input[name="huyita"]'));
    if (!form) return false;

    const token = form.querySelector('input[name="huyita"]')?.value;
    if (!token) return false; // not the confirmation page → do nothing

    const body = new URLSearchParams();
    for (const el of form.querySelectorAll('input, textarea, select')) {
      if (!el.name || el.disabled) continue;
      if (el.name === 'issendmes') continue;          // leave "notify author" unchecked
      if (el.name === 'text') { body.append('text', ''); continue; } // skip Cyrillic body
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
      body.append(el.name, el.value);
    }

    // action="" posts back to the delmes URL itself.
    const action = new URL(form.getAttribute('action') || absUrl, absUrl).href;
    const post = await fetch(action.split('#')[0], {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return post.ok;
  }

  /* ---------------- Storage ---------------- */

  function save() {
    chrome.storage.sync.set({ entries: state.entries });
  }

  function addEntry(nick, uid) {
    if (getEntry(nick, uid)) return;
    state.entries.push({ nick, uid: uid || null, topic: 'replace', post: 'replace', del: false });
    save();
  }

  function removeEntry(nick, uid) {
    const n = normNick(nick);
    state.entries = state.entries.filter(
      (e) => !((uid && String(e.uid) === String(uid)) || (!uid && normNick(e.nick) === n))
    );
    save();
  }

  /* ---------------- Apply ---------------- */

  function apply() {
    rebuildIndex();
    processTopicList();
    processPosts();
  }

  if (!isServicePage) {
    chrome.storage.sync.get(null, (data) => {
      state = { ...DEFAULTS, entries: data.entries || [] };
      for (const [k, v] of Object.entries(data)) if (k.startsWith('note:')) notes[k] = v;
      apply();
      new MutationObserver(() => apply()).observe(document.body, { childList: true, subtree: true });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      // A full re-apply after list edits is simpler than reverting DOM changes.
      if (changes.entries) location.reload();
      // Note edits only refresh the tooltips' source; they show on the next render.
      for (const [k, c] of Object.entries(changes)) {
        if (!k.startsWith('note:')) continue;
        if (c.newValue) notes[k] = c.newValue; else delete notes[k];
      }
    });
  }
})();
