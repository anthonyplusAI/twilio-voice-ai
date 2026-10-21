import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parseBuilderTwiml, renderBuilderTwiml } from "../src/lib/builder-twiml.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createProxyServer } = require("../workshop/secure-proxy.js");
const publicHost = "learner.trycloudflare.com";

function finalBuilderFiles() {
  const source = readFileSync(join(repoRoot, "src/content/chapter-6/step-1-polish.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports });
  const solution = loadedModule.exports.default.blocks.find((block) =>
    block.type === "solution" && block.audience === "builder" && block.files
  );
  assert.ok(solution, "final Builder solution exists");
  return Object.fromEntries(solution.files.map((file) => [file.file, file.code]));
}

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function waitForResponse(url, expected, processOutput, child, headers = {}) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(url, { method: "POST", headers });
      const body = await response.text();
      if (response.ok && body.includes(expected)) return body;
    } catch { /* The watcher may be restarting the server. */ }
    await delay(250);
  }
  throw new Error(`Builder server did not respond with ${expected}:\n${processOutput()}`);
}

test("saving final Builder server.js changes the next Call Me preflight through the public proxy", async () => {
  const files = finalBuilderFiles();
  const dir = mkdtempSync(join(repoRoot, ".builder-watch-"));
  const port = await unusedPort();
  let output = "";
  let child;
  let proxy;

  try {
    writeFileSync(join(dir, "package.json"), readFileSync(join(repoRoot, "workshop/package.json")));
    writeFileSync(join(dir, "package-lock.json"), readFileSync(join(repoRoot, "workshop/package-lock.json")));
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: dir,
      timeout: 120000,
      stdio: "pipe",
    });
    for (const [name, code] of Object.entries(files)) {
      writeFileSync(join(dir, name), code);
    }

    child = spawn("npm", ["run", "dev"], {
      cwd: dir,
      detached: true,
      env: {
        ...process.env,
        PORT: String(port),
        OPENAI_API_KEY: "sk-test",
        TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
        TWILIO_AUTH_TOKEN: "0".repeat(32),
        TWILIO_PHONE_NUMBER: "+12065550100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    proxy = createProxyServer({ upstreamPort: port, resolveHost: () => publicHost });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const twimlUrl = `http://127.0.0.1:${proxy.address().port}/twiml`;
    const headers = { Host: publicHost };
    const originalXml = await waitForResponse(twimlUrl, "Hello! How can I help you today?", () => output, child, headers);
    assert.match(originalXml, /url="wss:\/\/learner\.trycloudflare\.com\/ws"/);
    parseBuilderTwiml(originalXml, `https://${publicHost}/twiml`);

    const serverPath = join(dir, "server.js");
    const original = readFileSync(serverPath, "utf8");
    const updated = original.replace(
      'welcomeGreeting="Hello! How can I help you today?"',
      'welcomeGreeting="Hello from the updated Codespace!"'
    );
    assert.notEqual(updated, original, "the final solution exposes an editable TwiML greeting");
    writeFileSync(serverPath, updated);

    const editedXml = await waitForResponse(twimlUrl, "Hello from the updated Codespace!", () => output, child, headers);
    const parsed = parseBuilderTwiml(editedXml, `https://${publicHost}/twiml`);
    const inline = renderBuilderTwiml(parsed, "https://workshop.example/api/builder-action");
    assert.match(inline, /welcomeGreeting="Hello from the updated Codespace!"/);
  } finally {
    if (proxy?.listening) {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    }
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
      await delay(250);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
