import http from "node:http";

let agentPluginMod;
try {
  agentPluginMod = await import("@botfather/units-agent-plugin");
} catch {
  // Monorepo fallback for direct node execution without workspace linking.
  agentPluginMod = await import("../units-agent-plugin/index.js");
}

const { createUnitsAgentPlugin } = agentPluginMod;

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toLower(value) {
  return String(value || "").toLowerCase();
}

function toFiniteInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function normalizePathname(url) {
  const text = String(url || "");
  const idx = text.indexOf("?");
  if (idx === -1) return text || "/";
  return text.slice(0, idx) || "/";
}

function writeJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

function readBody(req, maxBodyBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += piece.length;
      if (total > maxBodyBytes) {
        reject(new Error(`payload_too_large:${maxBodyBytes}`));
        req.destroy();
        return;
      }
      chunks.push(piece);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", reject);
  });
}

function normalizeCompressPayload(payload, defaultSourceType) {
  if (!isObject(payload)) throw new Error("invalid_payload");

  const uiTree = payload.uiTree ?? payload.tree ?? null;
  if (!uiTree || typeof uiTree !== "object") {
    throw new Error("missing_tree");
  }

  return {
    uiTree,
    sourceType: payload.sourceType || payload.source_type || defaultSourceType || "dom",
    target: payload.target,
    maxTokens: payload.maxTokens,
    taskContext: isObject(payload.taskContext) ? payload.taskContext : {},
    expectations: isObject(payload.expectations) ? payload.expectations : {},
    compilerOptions: isObject(payload.compilerOptions) ? payload.compilerOptions : {},
  };
}

export function createUnitsAgentService(config = {}) {
  const endpoint = config.endpoint || "/compress-ui";
  const healthEndpoint = config.healthEndpoint || "/healthz";
  const maxBodyBytes = toFiniteInt(config.maxBodyBytes, 1024 * 1024);

  const plugin = config.plugin || createUnitsAgentPlugin({
    libraryDir: config.libraryDir,
    gates: config.gates,
    programs: config.programs,
    target: config.target,
    compilerOptions: config.compilerOptions,
    serializerOptions: config.serializerOptions,
  });

  async function compress(payload = {}) {
    const normalized = normalizeCompressPayload(payload, config.sourceType);
    return plugin.compressUiForAgent(normalized.uiTree, {
      sourceType: normalized.sourceType,
      target: normalized.target,
      maxTokens: normalized.maxTokens,
      taskContext: normalized.taskContext,
      expectations: normalized.expectations,
      compilerOptions: normalized.compilerOptions,
    });
  }

  async function handleHttpRequest(req, res) {
    const method = toLower(req?.method || "get");
    const pathname = normalizePathname(req?.url || "/");

    if (method === "get" && pathname === healthEndpoint) {
      writeJson(res, 200, {
        ok: true,
        service: "units-agent-service",
      });
      return;
    }

    if (method === "post" && pathname === endpoint) {
      try {
        const rawBody = await readBody(req, maxBodyBytes);
        const payload = rawBody.trim() ? JSON.parse(rawBody) : {};
        const result = await compress(payload);
        writeJson(res, 200, result);
      } catch (err) {
        const message = err && err.message ? String(err.message) : String(err);
        if (message.startsWith("payload_too_large:")) {
          writeJson(res, 413, {
            ok: false,
            error: "payload_too_large",
            message: `Request body exceeded maxBodyBytes (${maxBodyBytes}).`,
          });
          return;
        }

        const isValidationError = ["invalid_payload", "missing_tree"].includes(message);
        writeJson(res, isValidationError ? 400 : 500, {
          ok: false,
          error: isValidationError ? "bad_request" : "internal_error",
          message,
        });
      }
      return;
    }

    writeJson(res, 404, {
      ok: false,
      error: "not_found",
      message: `Route not found: ${method.toUpperCase()} ${pathname}`,
    });
  }

  return {
    endpoint,
    healthEndpoint,
    plugin,
    compress,
    handleHttpRequest,
  };
}

export function createUnitsAgentHttpHandler(config = {}) {
  const service = createUnitsAgentService(config);
  return service.handleHttpRequest;
}

export async function startUnitsAgentService(config = {}) {
  const service = createUnitsAgentService(config);
  const server = http.createServer(service.handleHttpRequest);

  const host = config.host || "127.0.0.1";
  const port = Number.isFinite(Number(config.port)) ? Number(config.port) : 0;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const finalPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${finalPort}`;

  return {
    server,
    service,
    url,
    endpoint: service.endpoint,
    healthEndpoint: service.healthEndpoint,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}
