import assert from "node:assert/strict";
import { test } from "node:test";
import { executeTool } from "../voice-agent/tools.mjs";

test("Explorer final weather prompt works when the model passes the spoken city name", () => {
  for (const city of [
    "San Francisco",
    "旧金山",
    "सैन फ्रांसिस्को",
    "São Francisco",
    "Сан-Франциско",
  ]) {
    const result = JSON.parse(executeTool("check_weather", { city }));
    assert.equal(result.temperature_f, 60, city);
    assert.equal(result.conditions, "Sunny", city);
  }
  for (const city of ["Seattle", "西雅图", "सिएटल", "Сиэтл", "Сиэтле"]) {
    const result = JSON.parse(executeTool("check_weather", { city }));
    assert.equal(result.temperature_f, 58, city);
    assert.equal(result.conditions, "Drizzle", city);
  }
});
