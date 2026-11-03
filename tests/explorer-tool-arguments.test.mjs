import assert from "node:assert/strict";
import { test } from "node:test";
import { executeTool } from "../voice-agent/tools.mjs";

test("numeric order numbers reach the matching demo order", () => {
  assert.deepEqual(JSON.parse(executeTool("lookup_order", { order_number: 123 })), {
    order_number: "123",
    status: "Shipped",
    items: "SIGNAL Shirt",
    estimated_delivery: "Tomorrow",
  });
});

test("malformed tool arguments return a useful error instead of throwing", () => {
  const order = JSON.parse(executeTool("lookup_order", null));
  const weather = JSON.parse(executeTool("check_weather", null));
  const malformedCity = JSON.parse(executeTool(
    "check_weather", JSON.parse('{"city":{"toString":null}}'),
  ));
  assert.match(order.error, /Supported order numbers/);
  assert.match(weather.error, /Supported cities/);
  assert.match(malformedCity.error, /Supported cities/);
});

test("inherited object keys are never treated as demo records", () => {
  for (const key of ["__proto__", "constructor", "toString"]) {
    assert.match(JSON.parse(executeTool("lookup_order", { order_number: key })).error,
      /Supported order numbers/);
    assert.match(JSON.parse(executeTool("check_weather", { city: key })).error,
      /Supported cities/);
  }
});
