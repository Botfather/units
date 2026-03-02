# Changesets

Use Changesets to manage release notes and version bumps for workspace packages.
This repo is configured to generate package `CHANGELOG.md` entries and GitHub Releases from changesets.

## Create a changeset

```bash
pnpm changeset
```

## Apply versions locally

```bash
pnpm changeset:version
```

## Publish (usually done in CI)

```bash
pnpm release
```
