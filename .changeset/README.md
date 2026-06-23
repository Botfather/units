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

`pnpm release` is CI-only for trusted publishing. It strips `NPM_TOKEN` and
`NODE_AUTH_TOKEN` from the publish process, then runs `pnpm release:guard`.
The guard blocks before
`changeset publish` if token auth is still present, if GitHub OIDC is missing,
or if an unpublished package is not listed in `.github/npm-publish-policy.json`
after its npm trusted publisher has been configured.

For each blocked package, configure npm trusted publishing with:

- Organization/user: `Botfather`
- Repository: `units`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

Then add the package name to `publishAllowedPackages`. In CI, the guard also
performs an npm OIDC token-exchange preflight for every allowlisted publish
candidate before any package is published.
