import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

function loadModule(path, imports = {}, globals = {}) {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    Response,
    console,
    ...globals,
    require(specifier) {
      if (specifier in imports) return imports[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return loaded.exports;
}

function feedbackRoute(recordEvent) {
  return loadModule("../src/app/api/feedback/route.ts", {
    "../../../../analytics/db.mjs": { recordEvent },
  }).POST;
}

test("feedback POST rejects JSON values that are not objects", async () => {
  const saved = [];
  const post = feedbackRoute(async (...args) => { saved.push(args); });

  for (const body of [null, [], "hello", 5, true]) {
    const response = await post({ json: async () => body });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(saved.length, 0);
});

test("feedback POST validates and forwards a stable event ID while accepting older clients", async () => {
  const saved = [];
  const post = feedbackRoute(async (...args) => { saved.push(args); });
  const id = "02a65383-8e19-42e0-a6e7-7580551f8d4a";
  const payload = { id, nps: 8, comment: "Useful", sessionId: "feedback-session" };

  assert.equal((await post({ json: async () => payload })).status, 200);
  assert.equal((await post({ json: async () => payload })).status, 200);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.map((args) => args[3]), [id, id]);

  assert.equal((await post({ json: async () => ({ nps: 7 }) })).status, 200);
  assert.equal(saved[2][3], undefined);

  for (const invalid of [null, "", "not-a-uuid", "02a65383-8e19-12e0-a6e7-7580551f8d4a"]) {
    const response = await post({ json: async () => ({ ...payload, id: invalid }) });
    assert.equal(response.status, 400, String(invalid));
  }
  assert.equal(saved.length, 3);
});

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
  } else if (node && typeof node === "object" && "props" in node) {
    if (predicate(node)) return node;
    return findElement(node.props.children, predicate);
  }
  return null;
}

function feedbackButtonHarness(fetchResponse) {
  const slots = [];
  let hookIndex = 0;
  let nextId = 1;
  const requests = [];
  const react = {
    useState(initial) {
      const slot = hookIndex++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value) => {
        slots[slot] = typeof value === "function" ? value(slots[slot]) : value;
      }];
    },
    useRef(initial) {
      const slot = hookIndex++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useEffect() {},
  };
  const { FeedbackButton } = loadModule("../src/components/FeedbackButton.tsx", {
    react,
    "react/jsx-runtime": jsxRuntime,
    "react-dom": { createPortal: (element) => element },
    "lucide-react": { MessageSquarePlus: "svg", X: "svg", Check: "svg", Loader2: "svg" },
    "framer-motion": { motion: { div: "div" }, AnimatePresence: "div" },
    "@/lib/AnalyticsContext": {
      useAnalyticsContext: () => ({ sessionId: { current: "feedback-session" } }),
    },
  }, {
    document: { body: {} },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}` },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return fetchResponse(requests.length);
    },
    setTimeout() {},
  });

  const render = () => {
    hookIndex = 0;
    return FeedbackButton();
  };
  const element = (predicate) => {
    const found = findElement(render(), predicate);
    assert.ok(found, "Expected feedback control");
    return found;
  };
  const click = (predicate) => element(predicate).props.onClick();
  click((node) => node.props["aria-label"] === "Share feedback");
  click((node) => node.props["aria-label"] === "Rate 8 out of 10");

  return {
    requests,
    submit: () => click((node) => node.type === "button" && node.props.children === "Submit"),
    changeComment(value) {
      element((node) => node.type === "textarea" && node.props.id === "feedback-comment")
        .props.onChange({ target: { value } });
    },
  };
}

test("feedback retries the same submission with one stable ID after HTTP and network failures", async () => {
  const ui = feedbackButtonHarness(async (attempt) => {
    if (attempt === 1) return Response.json({ error: "Try again" }, { status: 503 });
    if (attempt === 2) throw new Error("Network failure");
    return Response.json({ ok: true });
  });

  await ui.submit();
  await ui.submit();
  await ui.submit();
  assert.equal(ui.requests.length, 3);
  assert.match(ui.requests[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(ui.requests.map((request) => request.id), Array(3).fill(ui.requests[0].id));
});

test("editing feedback after a failed submission creates a new event ID", async () => {
  const ui = feedbackButtonHarness(async () => Response.json({ error: "Try again" }, { status: 503 }));
  await ui.submit();
  ui.changeComment("Updated answer");
  await ui.submit();

  assert.equal(ui.requests.length, 2);
  assert.notEqual(ui.requests[0].id, ui.requests[1].id);
  assert.equal(ui.requests[1].comment, "Updated answer");
});
