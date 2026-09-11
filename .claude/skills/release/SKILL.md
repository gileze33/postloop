---
name: release
description: Cut a new postloop release. Bumps the version in package.json, commits, tags vX.Y.Z, and pushes — which triggers the GitHub Actions release workflow to publish to npm with provenance via OIDC trusted publishing. Use when the user says "release", "cut a release", "publish a new version", "ship a version", "bump version", or any phrasing that means producing a new published version of postloop.
---

# Release a new postloop version

This skill drives a clean release: pick a semver bump, run pre-publish checks, tag, push, then watch the release workflow on GitHub.

## Preconditions

Before doing anything, verify all of:

1. Working directory is the postloop repo root (look for `package.json` with `"name": "postloop"`).
2. Current branch is `main`.
3. Working tree is clean (`git status --porcelain` is empty).
4. Local `main` is up to date with `origin/main` (`git fetch && git rev-parse HEAD == origin/main`).
5. The release workflow exists at `.github/workflows/release.yml`.

If any precondition fails, stop and tell the user what's wrong. Do not try to "fix" by stashing, committing, or rebasing on the user's behalf.

## Picking the bump

Ask the user which bump to apply unless they've already specified one:

- `patch` (`0.1.0 -> 0.1.1`): bugfixes, doc tweaks, internal refactors with no behavioural change.
- `minor` (`0.1.0 -> 0.2.0`): new features, new config options, new routes or CLI behaviour. Also use for **breaking changes** while still on `0.x` (semver carves out `0.x` as "anything goes").
- `major` (`0.1.0 -> 1.0.0`): only when the user wants to commit to backwards compatibility going forward.

Default discipline: stay on `0.x` until the config surface and behaviour are stable. Do not cut `1.0.0` without an explicit, considered ask.

If the user gives a vague intent ("ship the changes I just made"), look at the diff vs the previous tag (`git log $(git describe --tags --abbrev=0)..HEAD`) and propose a bump with reasoning. Confirm before proceeding.

## Pre-publish checks (locally)

Run these in sequence. Stop on the first failure and report it to the user; do not paper over.

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

`pnpm test` builds the app and then runs the full Playwright e2e suite, so it exercises the same gate the release workflow runs in CI. Running it now means we fail fast before tagging, instead of failing inside the workflow after the tag is already pushed.

Sanity check the built artifact reflects what will ship:

```
npm pack --dry-run
```

The tarball should list `bin/postloop.js`, the `dist/` output, `package.json`, `README.md`, and `LICENSE` — nothing from `data/`, `.e2e-data/`, or `test-results/`. The version shown should still be the *current* version at this point (the bump hasn't happened yet).

## Bump, commit, tag, push

```
pnpm version <patch|minor|major>
```

`pnpm version` bumps `package.json`, commits it, and creates a matching `vX.Y.Z` git tag. postloop has no changelog tooling, so nothing else is staged; if the user wants release notes, they can write them on the GitHub Release page.

Push the commit and the tag together:

```
git push --follow-tags
```

This is what fires the release workflow on the tag. The publish job re-runs typecheck, build, and the Playwright e2e before publishing, so the tag push is self-gating regardless of whether the parallel `ci` run has finished.

## Watch the workflow

Use the GitHub CLI to surface workflow status to the user:

```
gh run watch --exit-status
```

Or, if a fresh run hasn't appeared yet:

```
gh run list --workflow=release.yml --limit 3
```

If the workflow fails, fetch the logs (`gh run view --log-failed`) and report the failure to the user. Do **not** retag or force-push the existing tag — fix the underlying issue on `main` with a new patch release.

## Verify the publish

Once the workflow succeeds, confirm the new version is live:

```
npm view postloop version
```

Should match the just-released `X.Y.Z`. Optionally check provenance:

```
npm view postloop --json | jq '.dist.attestations'
```

## Report to the user

End with a short summary: the new version, the workflow run URL, and the npm package URL (`https://www.npmjs.com/package/postloop`). Do not narrate the steps you took.

## What this skill does not do

- It does not write release notes. The tag and published tarball are enough for npm consumers; the user can add notes on the GitHub Release page if they want.
- It does not amend, rebase, or force-push. Releases are append-only.
- It does not auto-resolve preconditions. If `main` is dirty or out of date, stop and surface it.
- It does not publish from a local machine. Publishing happens only in the release workflow via OIDC; there is no npm token stored anywhere.
