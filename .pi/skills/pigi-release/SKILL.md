---
name: pigi-release
description: Commit changes and release new versions. Use when asked to commit, release, bump version, or tag a release.
---

# pigi Release

## Commit

- Do NOT commit automatically; wait for explicit commit instruction
- When asked to commit:
  1. Review all uncommitted changes and summarize them
  2. Write a changelog entry under `## [Unreleased]` in `CHANGELOG.md` using sections `### Added`, `### Changed`, or `### Fixed`. Skip for internal-only changes (docs, tooling, refactors with no user impact).
  3. Write a conventional commit message (e.g. `fix:`, `feat:`, `refactor:`, `chore:`) with bullet points in the body for non-trivial changes
  4. Stage and commit the changelog together with the changes in a single commit

## Release

When asked to release a new version:

1. Bump `version` in `package.json` (minor by default unless user says otherwise).
2. Rename `## [Unreleased]` to `## [<version>]` in `CHANGELOG.md`, add date.
3. Commit with message `release: v<version>`.
4. Tag `v<version>`, push code and tag: `git push --follow-tags`.
