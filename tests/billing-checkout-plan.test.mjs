import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCheckoutTargetAllowed,
  normalizeWorkspacePlan,
} from "../src/lib/billing/checkout-plan.ts";

test("Checkout 档位校验", async (t) => {
  await t.test("normalizeWorkspacePlan", () => {
    assert.equal(normalizeWorkspacePlan("pro"), "pro");
    assert.equal(normalizeWorkspacePlan("team"), "team");
    assert.equal(normalizeWorkspacePlan("unknown"), "free");
  });

  await t.test("free 可购 pro 与 team", () => {
    assert.deepEqual(assertCheckoutTargetAllowed("free", "pro"), { ok: true });
    assert.deepEqual(assertCheckoutTargetAllowed("free", "team"), { ok: true });
  });

  await t.test("pro 不可再购 pro，可购 team", () => {
    const blocked = assertCheckoutTargetAllowed("pro", "pro");
    assert.equal(blocked.ok, false);
    assert.deepEqual(assertCheckoutTargetAllowed("pro", "team"), { ok: true });
  });

  await t.test("team 不可再购", () => {
    const proAttempt = assertCheckoutTargetAllowed("team", "pro");
    assert.equal(proAttempt.ok, false);
    const teamAttempt = assertCheckoutTargetAllowed("team", "team");
    assert.equal(teamAttempt.ok, false);
  });
});
