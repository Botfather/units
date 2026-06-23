#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const REGISTRY = "https://registry.npmjs.org";
const NPM_OIDC_AUDIENCE = "npm:registry.npmjs.org";
const POLICY_PATH = path.join(ROOT, ".github", "npm-publish-policy.json");

function log(message = "") {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function scopedPackageUrl(name) {
  return `${REGISTRY}/${encodeURIComponent(name)}`;
}

function oidcExchangeUrl(name) {
  return `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function listWorkspacePackages() {
  const packagesDir = path.join(ROOT, "packages");
  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = path.join(packagesDir, entry.name, "package.json");
    try {
      const manifest = await readJson(packagePath);
      if (manifest.private === true) continue;
      packages.push({
        dir: path.join("packages", entry.name),
        manifest,
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  packages.sort((a, b) => String(a.manifest.name).localeCompare(String(b.manifest.name)));
  return packages;
}

function isGitHubActions() {
  return process.env.GITHUB_ACTIONS === "true";
}

function releaseRequiresGitHubActions() {
  return process.env.UNITS_RELEASE_REQUIRE_GITHUB_ACTIONS === "true";
}

function expectedRepository(policy) {
  const trustedPublisher = policy.trustedPublisher || {};
  if (!trustedPublisher.owner || !trustedPublisher.repository) return null;
  return `${trustedPublisher.owner}/${trustedPublisher.repository}`;
}

function describeManifestPath(onePackage) {
  return `${onePackage.dir}/package.json`;
}

function validatePolicy(policy, packages) {
  const errors = [];
  const trustedPublisher = policy.trustedPublisher || {};
  const packageNames = new Set(packages.map((onePackage) => onePackage.manifest.name));
  const allowlist = policy.publishAllowedPackages;

  if (policy.authMode !== "trusted-publishing") {
    errors.push(`Unsupported npm publish authMode in ${path.relative(ROOT, POLICY_PATH)}: ${policy.authMode}`);
  }

  if (!trustedPublisher.owner || !trustedPublisher.repository || !trustedPublisher.workflow) {
    errors.push(`${path.relative(ROOT, POLICY_PATH)} must set trustedPublisher.owner, trustedPublisher.repository, and trustedPublisher.workflow.`);
  }

  if (!Array.isArray(allowlist)) {
    errors.push(`${path.relative(ROOT, POLICY_PATH)} publishAllowedPackages must be an array of package names.`);
  } else {
    for (const packageName of allowlist) {
      if (!packageNames.has(packageName)) {
        errors.push(`${path.relative(ROOT, POLICY_PATH)} publishAllowedPackages contains unknown package ${packageName}.`);
      }
    }
  }

  for (const onePackage of packages) {
    const { manifest } = onePackage;
    if (policy.packageScope && !String(manifest.name || "").startsWith(`${policy.packageScope}/`)) {
      errors.push(`${describeManifestPath(onePackage)} must stay under the ${policy.packageScope} npm scope.`);
    }

    if (trustedPublisher.repositoryUrl && manifest.repository?.url !== trustedPublisher.repositoryUrl) {
      errors.push(`${describeManifestPath(onePackage)} repository.url must be ${trustedPublisher.repositoryUrl} for npm trusted publishing.`);
    }

    if (String(manifest.name || "").startsWith("@") && manifest.publishConfig?.access !== "public") {
      errors.push(`${describeManifestPath(onePackage)} must set publishConfig.access to "public".`);
    }
  }

  return errors;
}

function validateGitHubContext(policy) {
  if (!isGitHubActions()) return [];

  const errors = [];
  const trustedPublisher = policy.trustedPublisher || {};
  const repo = expectedRepository(policy);
  const workflow = trustedPublisher.workflow;
  const branch = trustedPublisher.branch;

  if (repo && process.env.GITHUB_REPOSITORY !== repo) {
    errors.push(`GITHUB_REPOSITORY must be ${repo}; got ${process.env.GITHUB_REPOSITORY || "(unset)"}.`);
  }

  if (branch && process.env.GITHUB_REF_NAME !== branch) {
    errors.push(`Publishing is only allowed from ${branch}; got ${process.env.GITHUB_REF_NAME || "(unset)"}.`);
  }

  if (repo && workflow) {
    const workflowRef = process.env.GITHUB_WORKFLOW_REF || "";
    const expectedPrefix = `${repo}/.github/workflows/${workflow}@`;
    if (!workflowRef.startsWith(expectedPrefix)) {
      errors.push(`GITHUB_WORKFLOW_REF must start with ${expectedPrefix}; got ${workflowRef || "(unset)"}.`);
    }
  }

  return errors;
}

async function npmPackageInfo(name) {
  const response = await fetch(scopedPackageUrl(name), {
    headers: {
      accept: "application/vnd.npm.install-v1+json, application/json",
    },
  });

  if (response.status === 404) {
    return {
      exists: false,
      versions: new Set(),
    };
  }

  if (!response.ok) {
    throw new Error(`npm info ${name} failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  return {
    exists: true,
    versions: new Set(Object.keys(body.versions || {})),
  };
}

async function findPublishCandidates() {
  const packages = await listWorkspacePackages();
  const candidates = [];

  for (const onePackage of packages) {
    const { name, version } = onePackage.manifest;
    if (!name || !version) continue;
    const info = await npmPackageInfo(name);
    if (!info.versions.has(version)) {
      candidates.push({
        name,
        version,
        exists: info.exists,
        dir: onePackage.dir,
      });
    }
  }

  return candidates;
}

function hasTokenAuthEnv() {
  return Boolean(process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN);
}

function hasGitHubOidcEnv() {
  return Boolean(process.env.GITHUB_ACTIONS)
    ? Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN && process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
    : true;
}

async function readErrorBody(response) {
  const text = await response.text();
  if (!text) return "";

  try {
    const body = JSON.parse(text);
    return body.error || body.message || JSON.stringify(body);
  } catch {
    return text;
  }
}

function formatPackageList(packages) {
  return packages.map((onePackage) => `  - ${onePackage.name}@${onePackage.version}`).join("\n");
}

function trustedPublisherInstructions(policy, packages) {
  const trustedPublisher = policy.trustedPublisher || {};
  return [
    "Configure npm trusted publishing for every package listed above, then add those package names to .github/npm-publish-policy.json.",
    "",
    "Use these npm package settings:",
    `  Organization/user: ${trustedPublisher.owner || "(missing)"}`,
    `  Repository: ${trustedPublisher.repository || "(missing)"}`,
    `  Workflow filename: ${trustedPublisher.workflow || "(missing)"}`,
    `  Allowed action: ${trustedPublisher.allowedAction || "npm publish"}`,
    "",
    "Packages to add to publishAllowedPackages after npm is configured:",
    formatPackageList(packages),
  ].join("\n");
}

async function getGitHubOidcToken() {
  const requestUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  requestUrl.searchParams.set("audience", NPM_OIDC_AUDIENCE);

  const response = await fetch(requestUrl, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
    },
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`GitHub OIDC token request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const body = await response.json();
  if (!body.value) {
    throw new Error("GitHub OIDC token response did not include a token value.");
  }

  return body.value;
}

async function verifyNpmOidcExchange(candidates) {
  if (!isGitHubActions() || candidates.length === 0) return;

  const idToken = await getGitHubOidcToken();
  const failures = [];

  for (const onePackage of candidates) {
    const response = await fetch(oidcExchangeUrl(onePackage.name), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${idToken}`,
      },
    });

    if (response.status === 201) continue;

    const detail = await readErrorBody(response);
    failures.push(`  - ${onePackage.name}@${onePackage.version}: npm OIDC exchange returned HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
  }

  if (failures.length > 0) {
    throw new Error([
      "npm OIDC exchange preflight failed before any package was published.",
      "At least one package is missing a matching trusted publisher configuration or does not yet exist on npm.",
      "",
      ...failures,
    ].join("\n"));
  }
}

async function main() {
  const policy = await readJson(POLICY_PATH);
  const packages = await listWorkspacePackages();
  const validationErrors = [
    ...validatePolicy(policy, packages),
    ...validateGitHubContext(policy),
  ];

  if (validationErrors.length > 0) {
    fail([
      "npm publish guard found release configuration errors:",
      "",
      ...validationErrors.map((error) => `  - ${error}`),
    ].join("\n"));
    return;
  }

  if (releaseRequiresGitHubActions() && !isGitHubActions()) {
    fail([
      "Refusing to run the trusted-publishing release outside GitHub Actions.",
      "Use `pnpm release:guard` for local preflight checks; `pnpm release` is CI-only.",
    ].join("\n"));
    return;
  }

  if (hasTokenAuthEnv()) {
    fail([
      "Refusing to publish with NPM_TOKEN/NODE_AUTH_TOKEN.",
      "This repo uses npm trusted publishing. Token auth previously caused npm 2FA publish failures and partial releases.",
      "Remove NPM_TOKEN and NODE_AUTH_TOKEN from the publish job environment.",
    ].join("\n"));
    return;
  }

  if (!hasGitHubOidcEnv()) {
    fail([
      "GitHub Actions OIDC environment variables are unavailable.",
      "Ensure the release job has `permissions: id-token: write` and uses a GitHub-hosted runner.",
    ].join("\n"));
    return;
  }

  const candidates = await findPublishCandidates();
  if (candidates.length === 0) {
    log("No unpublished package versions found. npm publish guard passed.");
    return;
  }

  const allowed = new Set(policy.publishAllowedPackages || []);
  const blocked = candidates.filter((onePackage) => !allowed.has(onePackage.name));

  if (blocked.length > 0) {
    fail([
      "npm publish guard blocked this release before any package was published.",
      "",
      "The following package versions are not yet marked as trusted-publisher configured:",
      formatPackageList(blocked),
      "",
      trustedPublisherInstructions(policy, blocked),
    ].join("\n"));
    return;
  }

  if (policy.verifyOidcExchange !== false) {
    await verifyNpmOidcExchange(candidates);
  }

  log("npm publish guard passed for:");
  log(formatPackageList(candidates));
}

main().catch((error) => {
  fail(`npm publish guard failed: ${error?.stack || error?.message || String(error)}`);
});
