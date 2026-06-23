#!/usr/bin/env node
import { spawn } from "node:child_process";

const TOKEN_ENV_KEYS = ["NPM_TOKEN", "NODE_AUTH_TOKEN"];

function commandName(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function trustedPublishingEnv() {
  const env = { ...process.env };
  const stripped = [];

  env.UNITS_RELEASE_REQUIRE_GITHUB_ACTIONS = "true";

  for (const key of TOKEN_ENV_KEYS) {
    if (env[key]) stripped.push(key);
    delete env[key];
  }

  if (stripped.length > 0) {
    env.UNITS_RELEASE_STRIPPED_NPM_TOKEN_ENV = stripped.join(",");
  }

  return env;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName(command), args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} exited with signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });
}

async function main() {
  const env = trustedPublishingEnv();

  if (env.UNITS_RELEASE_STRIPPED_NPM_TOKEN_ENV) {
    console.log(`Ignoring npm token env vars for trusted publishing: ${env.UNITS_RELEASE_STRIPPED_NPM_TOKEN_ENV}`);
  }

  let code = await run("pnpm", ["release:guard"], env);
  if (code !== 0) {
    process.exitCode = code;
    return;
  }

  code = await run("changeset", ["publish"], env);
  process.exitCode = code;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
