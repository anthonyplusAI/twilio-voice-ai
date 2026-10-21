import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import next from "next";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import { handleConversationRelayConnection } from "./voice-agent/handler.mjs";
import { recordEvent, syncFromDurableStore, wipeAllEvents } from "./analytics/db.mjs";
import { getAllMetrics } from "./analytics/queries.mjs";
import { renderAdminPage } from "./analytics/admin-html.mjs";
import { generateReport } from "./analytics/report-pdf.mjs";

const port = parseInt(process.env.PORT || "8080", 10);
const dev = process.env.NODE_ENV !== "production";
const MAX_EVENT_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_REQUEST = 100;

const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

function safeParseUrl(req) {
  try {
    const host = req.headers.host || "localhost";
    return new URL(req.url || "/", `http://${host}`);
  } catch {
    return new URL("/", "http://localhost");
  }
}

function hasOrganizerCredentials(authorization, adminCredentialDigest) {
  if (!adminCredentialDigest || typeof authorization !== "string") return false;
  const match = /^Basic[ \t]+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return false;
  const suppliedCredentials = Buffer.from(match[1], "base64");
  const suppliedDigest = createHash("sha256").update(suppliedCredentials).digest();
  return timingSafeEqual(suppliedDigest, adminCredentialDigest);
}

function hasSameOrigin(req) {
  // Azure Container Apps terminates external HTTPS and overwrites this header
  // with the visitor's scheme; direct local requests use the socket scheme.
  const forwardedProto = req.headers["x-forwarded-proto"];
  const scheme = forwardedProto ?? (req.socket.encrypted ? "https" : "http");
  if ((scheme !== "http" && scheme !== "https") || !req.headers.host) return false;
  return req.headers.origin === `${scheme}://${req.headers.host}`;
}

function hasExactlyKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isShortText(value, maxLength = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isAudience(value) {
  return value === "builder" || value === "explorer";
}

function isClientEvent(event) {
  const hasId = typeof event?.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id);
  const occurredAt = event?.occurredAt;
  const hasValidOccurrence = typeof occurredAt === "string" &&
    occurredAt.length === 24 &&
    !Number.isNaN(Date.parse(occurredAt)) &&
    new Date(occurredAt).toISOString() === occurredAt;
  if (!hasExactlyKeys(event, ["type", "payload"]) &&
      !(hasExactlyKeys(event, ["id", "type", "payload"]) && hasId) &&
      !(hasExactlyKeys(event, ["id", "type", "payload", "occurredAt"]) &&
        hasId && hasValidOccurrence)) return false;
  const payload = event.payload;
  switch (event.type) {
    case "session_started":
      return hasExactlyKeys(payload, ["audience"]) && isAudience(payload.audience);
    case "audience_changed":
      return hasExactlyKeys(payload, ["from", "to"]) &&
        isAudience(payload.from) && isAudience(payload.to);
    case "step_viewed":
    case "step_completed":
      return hasExactlyKeys(payload, ["chapterId", "stepId", "chapterSlug", "stepSlug"]) &&
        Number.isSafeInteger(payload.chapterId) && payload.chapterId > 0 &&
        Number.isSafeInteger(payload.stepId) && payload.stepId > 0 &&
        isShortText(payload.chapterSlug) && isShortText(payload.stepSlug);
    case "badge_earned":
      return hasExactlyKeys(payload, ["badgeId"]) && isShortText(payload.badgeId);
    case "agent_configured":
      return hasExactlyKeys(payload, ["field", "value"]) &&
        isShortText(payload.field, 64) &&
        typeof payload.value === "string" && payload.value.length <= 8192;
    case "skip_ahead":
      return hasExactlyKeys(payload, ["fromStep", "toStep"]) &&
        isShortText(payload.fromStep, 256) && isShortText(payload.toStep, 256);
    case "share_clicked":
      return hasExactlyKeys(payload, ["platform"]) &&
        (payload.platform === "x" || payload.platform === "linkedin");
    case "progress_reset":
      return hasExactlyKeys(payload, []);
    default:
      return false;
  }
}

function eventError(res, status, error, closeConnection = false) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...(closeConnection ? { Connection: "close" } : {}),
  });
  res.end(JSON.stringify({ error }));
}

app.prepare().then(() => {
  // Next loads .env.local during prepare(), so resolve the organizer secret
  // after that step. Basic credentials require HTTPS at the public ingress.
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminUser = process.env.ADMIN_USER || "presenter";
  const adminCredentialDigest = adminPassword
    ? createHash("sha256").update(`${adminUser}:${adminPassword}`).digest()
    : null;

  const server = createServer(async (req, res) => {
    const { pathname } = safeParseUrl(req);

    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      res.setHeader("Cache-Control", "no-store");
      if (!adminCredentialDigest) {
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Organizer access is not configured");
        return;
      }
      if (!hasOrganizerCredentials(req.headers.authorization, adminCredentialDigest)) {
        res.writeHead(401, {
          "Content-Type": "text/plain; charset=utf-8",
          "WWW-Authenticate": 'Basic realm="Workshop Admin", charset="UTF-8"',
        });
        res.end("Organizer sign-in required");
        return;
      }
      if (pathname === "/admin/reset-all" && req.method === "POST" && !hasSameOrigin(req)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Reset request must come from this site");
        return;
      }
    }

    // Liveness probe for the deploy smoke test + ACA health checks. Matches the
    // /health route taught in chapter-6 (status + uptime). Unauthenticated, no
    // dependency — just confirms the server is alive.
    if (pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    // Deployment readiness also exercises the durable analytics read path.
    // Report only availability; workshop counts remain organizer-only.
    if (pathname === "/health/analytics" && req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      try {
        await syncFromDurableStore();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (error) {
        console.error("[health] Analytics storage unavailable:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unavailable" }));
      }
      return;
    }

    if (pathname === "/api/events" && req.method === "POST") {
      const declaredLength = Number(req.headers["content-length"]);
      if (declaredLength > MAX_EVENT_BODY_BYTES) {
        req.pause();
        eventError(res, 413, "Analytics batch is too large", true);
        return;
      }

      let receivedBytes = 0;
      let rejected = false;
      const chunks = [];
      req.on("data", (chunk) => {
        if (rejected) return;
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_EVENT_BODY_BYTES) {
          rejected = true;
          req.pause();
          eventError(res, 413, "Analytics batch is too large", true);
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", async () => {
        if (rejected) return;
        let batch;
        try {
          batch = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          eventError(res, 400, "Invalid analytics JSON");
          return;
        }
        if (!hasExactlyKeys(batch, ["sessionId", "events"]) ||
            typeof batch.sessionId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(batch.sessionId) ||
            !Array.isArray(batch.events) ||
            batch.events.length > MAX_EVENTS_PER_REQUEST ||
            !batch.events.every(isClientEvent)) {
          eventError(res, 400, "Invalid analytics events batch");
          return;
        }

        try {
          for (const event of batch.events) {
            await recordEvent(batch.sessionId, event.type, event.payload,
              event.id, undefined, undefined, event.occurredAt ?? null);
          }
        } catch (err) {
          console.error("[analytics] Event batch write failed:", err);
          eventError(res, 503, "Analytics storage is temporarily unavailable");
          return;
        }
        res.writeHead(204).end();
      });
      req.on("error", () => {
        if (!rejected && !res.headersSent) eventError(res, 400, "Invalid analytics request");
      });
      return;
    }

    // Organizer-only: start a fresh analytics generation. Authentication and
    // same-origin checks above protect this action; the UI double-confirms it.
    if (pathname === "/admin/reset-all" && req.method === "POST") {
      try {
        const removed = await wipeAllEvents();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, removed }));
      } catch (err) {
        console.error("[admin] reset-all error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
      }
      return;
    }

    if (pathname === "/admin/report") {
      try {
        await syncFromDurableStore();
        const url = safeParseUrl(req);
        const range = url.searchParams.get("range") === "today" ? "today" : "all";
        const data = getAllMetrics(range);
        const doc = generateReport(data);
        const filename = `workshop-analytics-${new Date().toISOString().slice(0, 10)}.pdf`;
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        });
        doc.pipe(res);
      } catch (err) {
        console.error("[admin] PDF report error:", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Failed to generate report");
      }
      return;
    }

    const cleanPath = pathname.replace(/\/+$/, "");
    if (cleanPath === "/admin" || cleanPath === "/admin/data") {
      try {
        await syncFromDurableStore();
        const url = safeParseUrl(req);
        const range = url.searchParams.get("range") === "all" ? "all" : "today";
        const data = getAllMetrics(range);
        if (cleanPath === "/admin/data") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        } else {
          const html = renderAdminPage(data);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        }
      } catch (err) {
        console.error("[admin] Analytics error:", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal analytics error");
      }
      return;
    }

    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    handleConversationRelayConnection(ws);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = safeParseUrl(req);
    if (pathname === "/ws") {
      const rejectUpgrade = (status, reason) => {
        socket.end(
          `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          () => socket.destroy()
        );
      };

      const authToken = process.env.TWILIO_AUTH_TOKEN;
      let signedUrl;
      try {
        const configured = process.env.PUBLIC_BASE_URL;
        if (!authToken || (!configured && !dev)) {
          throw new Error("Missing WebSocket authentication configuration");
        }
        // Twilio signs the public WSS URL, while Azure terminates TLS before
        // forwarding the handshake. Only local development may use Host here.
        const localHost = req.headers.host;
        if (!configured && (typeof localHost !== "string" || !localHost)) {
          throw new Error("Missing public host");
        }
        const origin = new URL(configured || `https://${localHost}`);
        if (origin.protocol !== "https:" || origin.pathname !== "/" ||
            origin.search || origin.hash || origin.username || origin.password) {
          throw new Error("Invalid public WebSocket origin");
        }
        signedUrl = `wss://${origin.host}/ws`;
      } catch {
        rejectUpgrade(503, "Service Unavailable");
        return;
      }

      const signature = req.headers["x-twilio-signature"];
      let verified = false;
      if (req.url === "/ws" && typeof signature === "string" && signature) {
        try {
          // Twilio can sign the same upgrade URL with or without a trailing slash.
          verified = twilio.validateRequest(authToken, signature, signedUrl, {}) ||
            twilio.validateRequest(authToken, signature, `${signedUrl}/`, {});
        } catch { /* A malformed signature is unauthorized. */ }
      }
      if (!verified) {
        rejectUpgrade(403, "Forbidden");
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else if (!dev) {
      socket.destroy();
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `> Server listening on http://0.0.0.0:${port} (${dev ? "development" : "production"})`
    );
    console.log(`> WebSocket endpoint: ws://0.0.0.0:${port}/ws`);
  });
});
