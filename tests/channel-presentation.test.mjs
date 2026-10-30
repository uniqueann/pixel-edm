import test from "node:test";
import assert from "node:assert/strict";
import {
  channelSetupCopy,
  testResultCopy,
  isTestPending,
  latestTestSnapshot,
} from "../src/features/channels/channel-presentation.ts";

test("通道展示尊重断开与凭据事实，不把历史验证当作当前可用", () => {
  assert.match(
    channelSetupCopy({ status: "verified", credential_configured: false })
      .title,
    /尚未完成/,
  );
  assert.match(
    channelSetupCopy({ status: "disconnected", credential_configured: false })
      .title,
    /已断开/,
  );
  assert.match(
    channelSetupCopy({ status: "configured", credential_configured: true })
      .title,
    /下一步发送测试/,
  );
  assert.match(
    channelSetupCopy({ status: "error", credential_configured: true }).detail,
    /恢复建议/,
  );
});

test("迟到刷新不覆盖新测试或退回已完成的同一请求", () => {
  const pending = {
    id: "first",
    status: "pending",
    created_at: "2026-10-30T09:00:00Z",
  };
  const accepted = { ...pending, status: "accepted" };
  const newer = {
    id: "second",
    status: "unknown",
    created_at: "2026-10-30T09:01:00Z",
  };
  assert.equal(latestTestSnapshot(accepted, pending), accepted);
  assert.equal(latestTestSnapshot(pending, accepted), accepted);
  assert.equal(latestTestSnapshot(newer, accepted), newer);
  assert.equal(latestTestSnapshot(accepted, newer), newer);
  assert.equal(latestTestSnapshot(newer, null), newer);
});

test("测试处理中不是失败；已接收与未知结果保持准确语义", () => {
  const configured = { status: "configured", credential_configured: true };
  assert.match(channelSetupCopy(configured, "pending").title, /尚未完成/);
  assert.match(channelSetupCopy(configured, "processing").title, /尚未完成/);
  assert.match(channelSetupCopy(configured, "unknown").title, /先核对/);
  assert.equal(isTestPending("pending"), true);
  assert.equal(isTestPending("processing"), true);
  for (const status of ["accepted", "failed", "unknown", undefined])
    assert.equal(isTestPending(status), false);
  assert.match(testResultCopy.accepted.detail, /不代表收件人已收到/);
  assert.match(testResultCopy.unknown.detail, /先核对/);
});
