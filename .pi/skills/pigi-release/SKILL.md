---
name: pigi-release
description: Commit changes and release new versions. Use when asked to commit, release, bump version, or tag a release.
---

# pigi Release

## Commit

- Do NOT commit automatically; wait for explicit commit instruction
- When asked to commit:
  1. Review all uncommitted changes and summarize them
  2. Write a changelog entry under `## [Unreleased]` in `CHANGELOG.md` using sections `### Added`, `### Changed`, or `### Fixed`. Keep entries user-facing — describe what the user sees and experiences, not internal implementation details. Omit technical jargon like file names, package names, refactors, or tooling changes. Skip entirely for internal-only changes with no user impact.
  3. Write a conventional commit message (e.g. `fix:`, `feat:`, `refactor:`, `chore:`) with bullet points in the body for non-trivial changes
  4. Stage and commit the changelog together with the changes in a single commit

## Release

When asked to release a new version:

1. Bump `version` in `package.json` (minor by default unless user says otherwise).
2. Rename `## [Unreleased]` to `## [<version>]` in `CHANGELOG.md`, add date.
3. Commit with message `release: v<version>`.
4. Create annotated tag and push: `git tag -a v<version> -m "v<version>" && git push --follow-tags`.
   - Always use `-a` (annotated tag). `git push --follow-tags` only pushes annotated tags, lightweight tags are skipped.
