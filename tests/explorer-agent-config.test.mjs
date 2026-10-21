import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const source = readFileSync(fileURLToPath(new URL("../src/components/content/AgentConfig.tsx", import.meta.url)), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const greetingSource = readFileSync(fileURLToPath(new URL("../src/lib/explorer-greeting.ts", import.meta.url)), "utf8");
const greetingCode = ts.transpileModule(greetingSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadedGreeting = { exports: {} };
vm.runInNewContext(greetingCode, { module: loadedGreeting, exports: loadedGreeting.exports });

function renderHarness() {
  const slots = [];
  let slotIndex = 0;
  let workshopState = {};
  const updates = [];
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    require(specifier) {
      if (specifier === "react/jsx-runtime") return jsxRuntime;
      if (specifier === "react") return {
        useState(initial) {
          const index = slotIndex++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (value) => { slots[index] = value; }];
        },
      };
      if (specifier === "@/components/layout/ProgressContext") return {
        useProgressContext: () => ({
          progress: { workshopState },
          updateWorkshopState(partial) { updates.push(JSON.parse(JSON.stringify(partial))); },
        }),
      };
      if (specifier === "@/lib/explorer-greeting") return loadedGreeting.exports;
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });

  function render() {
    slotIndex = 0;
    return loaded.exports.AgentConfig();
  }

  return {
    render,
    updates,
    setWorkshopState(next) { workshopState = next; },
  };
}

function elements(root, type) {
  const found = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type === type) found.push(node);
    visit(node.props?.children);
  }
  visit(root);
  return found;
}

test("Explorer persona fields hydrate on revisit and blur preserves saved values", () => {
  const ui = renderHarness();
  const first = ui.render();
  assert.equal(elements(first, "input")[0].props.value, "");

  ui.setWorkshopState({
    agentName: "Sam",
    personality: "Saved personality",
    welcomeGreeting: "Saved greeting",
  });
  const hydrated = ui.render();
  assert.equal(elements(hydrated, "input")[0].props.value, "Sam");
  assert.equal(elements(hydrated, "textarea")[0].props.value, "Saved personality");
  assert.equal(elements(hydrated, "input")[1].props.value, "Saved greeting");

  elements(hydrated, "input")[0].props.onBlur();
  assert.deepEqual(ui.updates.at(-1), {
    agentName: "Sam",
    personality: "Saved personality",
    welcomeGreeting: "Saved greeting",
  });
});

test("Explorer keeps a draft edit while saved persona data hydrates", () => {
  const ui = renderHarness();
  const first = ui.render();
  elements(first, "input")[0].props.onChange({ target: { value: "Custom Sam" } });

  ui.setWorkshopState({
    agentName: "Sam",
    personality: "Saved personality",
    welcomeGreeting: "Saved greeting",
  });
  const hydrated = ui.render();
  assert.equal(elements(hydrated, "input")[0].props.value, "Custom Sam");
  assert.equal(elements(hydrated, "textarea")[0].props.value, "Saved personality");
  elements(hydrated, "input")[0].props.onBlur();
  assert.deepEqual(ui.updates.at(-1), {
    agentName: "Custom Sam",
    personality: "Saved personality",
    welcomeGreeting: "Saved greeting",
  });
});

test("Explorer revisits a saved persona in the selected language without marking it custom", () => {
  const ui = renderHarness();
  const first = ui.render();
  elements(first, "button")[0].props.onClick();
  ui.setWorkshopState({ ...ui.updates.at(-1), language: "fr-FR" });

  const revisited = ui.render();
  assert.match(elements(revisited, "input")[1].props.value, /Bonjour ! Je suis Sam/);
  const customPanel = elements(revisited, "div").find((node) =>
    node.props.className?.includes("space-y-3 rounded-lg"));
  assert.match(customPanel.props.className, /border-transparent/);

  elements(revisited, "input")[0].props.onBlur();
  assert.match(ui.updates.at(-1).welcomeGreeting, /Bonjour ! Je suis Sam/);
});
