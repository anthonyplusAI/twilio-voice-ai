import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBuilderActionToken,
  readBuilderActionToken,
} from "../src/lib/builder-action-token.mjs";

const secret = "test-twilio-auth-token";
const details = {
  actionUrl: "https://attendee.trycloudflare.com/call-ended",
  phoneNumber: "+12065550101",
  reservationId: "reservation-test",
};

test("a Builder action token binds the permitted tunnel, number, and reservation", () => {
  const token = createBuilderActionToken(details, secret, () => 1_000);
  assert.deepEqual(readBuilderActionToken(token, secret, () => 2_000), {
    v: 1,
    ...details,
    expiresAt: 1_801_000,
  });
  assert.equal(readBuilderActionToken(token, secret, () => 1_801_001), null);
  assert.equal(readBuilderActionToken(token, "wrong-secret", () => 2_000), null);
  assert.equal(readBuilderActionToken(`${token}x`, secret, () => 2_000), null);
});

test("a token may safely end a call without a Builder handoff route", () => {
  const token = createBuilderActionToken({ ...details, actionUrl: null }, secret, () => 1_000);
  assert.equal(readBuilderActionToken(token, secret, () => 1_000)?.actionUrl, null);
});

test("tokens reject external action URLs and unexpected destinations", () => {
  for (const actionUrl of [
    "https://attacker.example/call-ended",
    "http://attendee.trycloudflare.com/call-ended",
    "https://attendee.trycloudflare.com/other",
    "https://attendee.trycloudflare.com/call-ended?next=/x",
    "https://attendee.trycloudflare.com:8443/call-ended",
  ]) {
    assert.throws(() => createBuilderActionToken({ ...details, actionUrl }, secret));
  }
  assert.throws(() => createBuilderActionToken({ ...details, phoneNumber: "+442079460000" }, ""));
});
