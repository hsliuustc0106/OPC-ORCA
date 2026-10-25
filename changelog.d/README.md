# Changelog fragments

One file per user-visible change, so two pull requests do not edit the same changelog lines. v0 has no `CHANGELOG.md` and no release script. A fragment is the note; nothing here assembles a release or tags.

**Name:** `changelog.d/<issue-or-slug>.<kind>.md`

**Kind** is one of `added`, `changed`, `deprecated`, `removed`, `fixed`, `security`.

Example: `changelog.d/12-human-pr-gate.added.md`.

**Body:** the entry only, one short paragraph. No leading `- ` and no heading. A change a user cannot see needs no fragment.

Do not add a fragment for this scaffold’s own stub files unless a later pull request changes behavior a user can observe. The scaffold is described in the repository README.
