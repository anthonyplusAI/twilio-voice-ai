import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoots = [];

function createFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "workshop-admin-test-"));
  for (const entry of [".next", "next.config.ts", "node_modules", "package.json", "public"]) {
    symlinkSync(join(projectRoot, entry), join(root, entry));
  }
  fixtureRoots.push(root);
  return root;
}

const fixtureRoot = createFixtureRoot();
let baseUrl;
let configuredBaseUrl;
const apps = [];

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startServer(adminEnv, cwd = fixtureRoot) {
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port) };
  delete env.ADMIN_PASSWORD;
  delete env.ADMIN_USER;
  Object.assign(env, adminEnv);
  let output = "";
  const app = spawn(process.execPath, [join(projectRoot, "server.mjs")], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apps.push(app);
  app.stdout.on("data", (chunk) => { output += chunk; });
  app.stderr.on("data", (chunk) => { output += chunk; });

  for (let i = 0; i < 80; i++) {
    if (app.exitCode !== null) break;
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return url;
    } catch { /* Wait for startup. */ }
    await delay(250);
  }
  throw new Error(`Workshop server did not start:\n${output}`);
}

before(async () => {
  baseUrl = await startServer({});
  configuredBaseUrl = await startServer({ ADMIN_PASSWORD: "test-secret-for-admin" });
});

after(() => {
  for (const app of apps) app.kill("SIGTERM");
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

test("admin dashboard stays unavailable when no organizer password is configured", async () => {
  const response = await fetch(`${baseUrl}/admin`);
  assert.equal(response.status, 503);
});

test("admin dashboard challenges visitors without organizer credentials", async () => {
  const response = await fetch(`${configuredBaseUrl}/admin`);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /^Basic /);
});

test("organizer analytics responses cannot be cached", async () => {
  const response = await fetch(`${configuredBaseUrl}/admin/data`, {
    headers: { authorization: basicAuth("presenter", "test-secret-for-admin") },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

test("admin dashboard accepts only the configured organizer credentials", async () => {
  const wrongPassword = await fetch(`${configuredBaseUrl}/admin`, {
    headers: { authorization: basicAuth("presenter", "wrong-password") },
  });
  assert.equal(wrongPassword.status, 401);

  const wrongUser = await fetch(`${configuredBaseUrl}/admin`, {
    headers: { authorization: basicAuth("someone-else", "test-secret-for-admin") },
  });
  assert.equal(wrongUser.status, 401);

  const organizer = await fetch(`${configuredBaseUrl}/admin`, {
    headers: { authorization: basicAuth("presenter", "test-secret-for-admin") },
  });
  assert.equal(organizer.status, 200);
  assert.match(await organizer.text(), /Workshop Analytics/);
});

test("a configured organizer username replaces the default presenter username", async () => {
  const url = await startServer({ ADMIN_PASSWORD: "host-secret", ADMIN_USER: "workshop-host" });

  const defaultUser = await fetch(`${url}/admin`, {
    headers: { authorization: basicAuth("presenter", "host-secret") },
  });
  assert.equal(defaultUser.status, 401);

  const configuredUser = await fetch(`${url}/admin`, {
    headers: { authorization: basicAuth("workshop-host", "host-secret") },
  });
  assert.equal(configuredUser.status, 200);
});

test("a password in .env.local is available when the organizer server starts", async () => {
  const localRoot = createFixtureRoot();
  writeFileSync(join(localRoot, ".env.local"), "ADMIN_USER=local-host\nADMIN_PASSWORD=local-file-secret\n");
  const url = await startServer({}, localRoot);

  const visitor = await fetch(`${url}/admin`);
  assert.equal(visitor.status, 401);

  const organizer = await fetch(`${url}/admin`, {
    headers: { authorization: basicAuth("local-host", "local-file-secret") },
  });
  assert.equal(organizer.status, 200);
});

test("all organizer routes reject requests without credentials", async () => {
  for (const [path, method] of [
    ["/admin/", "GET"],
    ["/admin/data", "GET"],
    ["/admin/report", "GET"],
    ["/admin/reset-all", "POST"],
    ["/admin/future-route", "GET"],
  ]) {
    const response = await fetch(`${configuredBaseUrl}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("all organizer routes stay closed when the password is unset", async () => {
  const credentials = basicAuth("presenter", "test-secret-for-admin");
  for (const [path, method] of [
    ["/admin/data", "GET"],
    ["/admin/report", "GET"],
    ["/admin/reset-all", "POST"],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: credentials },
    });
    assert.equal(response.status, 503, `${method} ${path}`);
  }
});

test("public workshop routes remain available without organizer credentials", async () => {
  const page = await fetch(configuredBaseUrl);
  assert.equal(page.status, 200);

  const events = await fetch(`${configuredBaseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "public-attendee", events: [] }),
  });
  assert.equal(events.status, 204);
});

test("only the organizer can reset analytics", async () => {
  const credentials = basicAuth("presenter", "test-secret-for-admin");
  const seed = await fetch(`${configuredBaseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "admin-access-test",
      events: [{ type: "session_started", payload: { audience: "explorer" } }],
    }),
  });
  assert.equal(seed.status, 204);

  const getSessionCount = async () => {
    const response = await fetch(`${configuredBaseUrl}/admin/data?range=all`, {
      headers: { authorization: credentials },
    });
    assert.equal(response.status, 200);
    return (await response.json()).overview.totalSessions;
  };
  assert.equal(await getSessionCount(), 1);

  const denied = await fetch(`${configuredBaseUrl}/admin/reset-all`, { method: "POST" });
  assert.equal(denied.status, 401);
  assert.equal(await getSessionCount(), 1);

  const cleared = await fetch(`${configuredBaseUrl}/admin/reset-all`, {
    method: "POST",
    headers: { authorization: credentials, origin: configuredBaseUrl },
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { ok: true, removed: 1 });
  assert.equal(await getSessionCount(), 0);
});

test("reset rejects a cross-site Origin even with organizer credentials", async () => {
  const response = await fetch(`${configuredBaseUrl}/admin/reset-all`, {
    method: "POST",
    headers: {
      authorization: basicAuth("presenter", "test-secret-for-admin"),
      origin: "https://another-site.example",
    },
  });
  assert.equal(response.status, 403);
});

test("reset rejects a missing Origin even with organizer credentials", async () => {
  const response = await fetch(`${configuredBaseUrl}/admin/reset-all`, {
    method: "POST",
    headers: { authorization: basicAuth("presenter", "test-secret-for-admin") },
  });
  assert.equal(response.status, 403);
});

test("reset accepts the external HTTPS Origin forwarded by Azure ingress", async () => {
  const externalOrigin = configuredBaseUrl.replace(/^http:/, "https:");
  const response = await fetch(`${configuredBaseUrl}/admin/reset-all`, {
    method: "POST",
    headers: {
      authorization: basicAuth("presenter", "test-secret-for-admin"),
      origin: externalOrigin,
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(response.status, 200);
});

test("an organizer can download the analytics report", async () => {
  const response = await fetch(`${configuredBaseUrl}/admin/report`, {
    headers: { authorization: basicAuth("presenter", "test-secret-for-admin") },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/pdf/);
  assert.ok((await response.arrayBuffer()).byteLength > 100);
});
