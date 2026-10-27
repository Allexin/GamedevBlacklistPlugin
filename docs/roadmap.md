# Roadmap

## Next iteration

- **Ask for a note when blocking.** Clicking «в ЧС» on a post is the moment the reason
  is freshest. Instead of a `prompt()` dialog, show a small inline input next to the
  button: the user is added immediately, the note is optional and saved on Enter/blur
  under the same `note:*` key the popup uses.
- **Carry a note over when a user's key changes.** A user added from the popup by nick
  gets `note:n<nick>`; if they are later removed and re-added from a post (now with a
  uid), the note under the nick key is not found. Migrate `note:n<nick>` → `note:u<uid>`
  when an entry gains a uid.
