import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadStep(chapter, filename) {
  const url = new URL(`../src/content/chapter-${chapter}/${filename}`, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const contentModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: contentModule,
    exports: contentModule.exports,
  }, { filename: url.pathname });
  return contentModule.exports.default;
}

function guidedServerSnippets(step) {
  return step.blocks.filter((block) =>
    block.type === "code" && block.audience === "builder" &&
    block.file === "server.js" && block.language === "javascript"
  ).map((block) => block.code);
}

test("Chapter 5 tool request uses the schema imported by its guided steps", async () => {
  const snippets = guidedServerSnippets(loadStep(5, "step-2-define-tools.ts"));
  const requestSnippet = snippets.find((code) => code.includes("openai.chat.completions.create"));
  assert.ok(requestSnippet, "the guided request example exists");
  const importSnippets = snippets.filter((code) => code.includes('require("./tool-handlers.js")'));
  const expectedTools = [{ type: "function", function: { name: "lookup_order" } }];
  let actualRequest;

  await vm.runInNewContext(`(async () => {
    ${importSnippets.join("\n")}
    ${requestSnippet}
  })()`, {
    require: (name) => {
      assert.equal(name, "./tool-handlers.js");
      return { tools: expectedTools };
    },
    openai: { chat: { completions: { create: async (request) => {
      actualRequest = request;
      return {};
    } } } },
    process: { env: {} },
    state: { conversationHistory: [] },
    controller: { signal: new AbortController().signal },
  });
  assert.equal(actualRequest.tools, expectedTools);
});

test("Chapter 5 guided tool loop can be pasted once without duplicate declarations", () => {
  const snippets = guidedServerSnippets(loadStep(5, "step-3-handle-tools.ts"));
  assert.ok(snippets.length >= 2, "the guided stream and tool loop examples exist");
  assert.doesNotThrow(() => new vm.Script(snippets.join("\n\n")));
});

test("Chapter 6 guided error handler speaks after a Chapter 5 style callback", () => {
  const snippets = guidedServerSnippets(loadStep(6, "step-1-polish.ts"));
  const handler = snippets.find((code) => code.startsWith("function handleMessage("));
  assert.ok(handler, "the guided message handler exists");
  const spoken = [];
  const ws = {};
  vm.runInNewContext(`${handler}\nhandleMessage(ws, Buffer.from(JSON.stringify({
    type: "error", description: "Failed to synthesize speech"
  })))`, {
    ws,
    Buffer,
    console: { error() {} },
    sendText: (_ws, token, last) => spoken.push({ token, last }),
  });
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].token, /technical issue/i);
  assert.equal(spoken[0].last, true);
});

test("Chapter 6 guided AI fallback keeps the Chapter 5 per-caller state", async () => {
  const snippets = guidedServerSnippets(loadStep(6, "step-1-polish.ts"));
  const stream = snippets.find((code) => code.startsWith("async function streamResponse("));
  assert.ok(stream, "the guided stream error example exists");
  const state = { conversationHistory: [] };
  const spoken = [];
  const ws = {};
  await vm.runInNewContext(`${stream}\nstreamResponse(ws)`, {
    ws,
    process: { env: {} },
    stateFor: () => state,
    tools: [],
    openai: { chat: { completions: { create: async () => {
      throw new Error("upstream unavailable");
    } } } },
    sendText: (_ws, token, last) => spoken.push({ token, last }),
    console: { error() {} },
  });
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].token, /technical issue/i);
  assert.equal(spoken[0].last, true);
  assert.equal(state.conversationHistory.at(-1).content, spoken[0].token);
});
