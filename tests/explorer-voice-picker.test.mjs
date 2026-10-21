import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function loadModule(path, imports = {}) {
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
    require(specifier) {
      if (specifier in imports) return imports[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return loaded.exports;
}

test("Explorer highlights a saved Polly voice and keeps its familiar display name", () => {
  const catalog = loadModule("../src/lib/voice-catalog.ts");
  const greeting = loadModule("../src/lib/explorer-greeting.ts");
  const { VoicePicker } = loadModule("../src/components/content/VoicePicker.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "@/lib/voice-catalog": catalog,
    "@/lib/explorer-greeting": greeting,
    "@/components/layout/ProgressContext": {
      useProgressContext: () => ({
        progress: {
          workshopState: {
            voice: "Joanna-Neural",
            voiceLabel: "Joanna",
            ttsProvider: "Amazon Polly",
            language: "en-US",
          },
        },
        updateWorkshopState() {},
      }),
    },
  });

  const html = renderToStaticMarkup(createElement(VoicePicker));
  const joannaButton = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(([button]) => button)
    .find((button) => button.includes("Joanna"));
  assert.ok(joannaButton, "Joanna should be an available voice");
  assert.match(joannaButton, /border-twilio-red bg-twilio-red\/15/,
    "a saved Amazon Polly choice should still appear selected");
  assert.match(html, /tracking-wider mb-2">Amazon Polly<\/div>/,
    "the provider heading should use the familiar name");
  assert.match(html, /Active: Joanna \(Amazon Polly\)/);
});
