import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const handlerPath = fileURLToPath(new URL("../voice-agent/handler.mjs", import.meta.url));

test("a storage outage does not crash an active voice call", () => {
  const program = `
    import { EventEmitter } from "node:events";
    import { handleConversationRelayConnection } from ${JSON.stringify(handlerPath)};
    const ws = new EventEmitter();
    ws.OPEN = 1;
    ws.readyState = 1;
    ws.send = () => {};
    handleConversationRelayConnection(ws);
    ws.emit("message", Buffer.from(JSON.stringify({
      type: "setup", callSid: "CA-test", from: "+15551234567", customParameters: {}
    })));
    setTimeout(() => { ws.emit("close"); }, 25);
    setTimeout(() => { process.exit(0); }, 150);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-only-key",
      CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING: "invalid-connection-string",
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
});
