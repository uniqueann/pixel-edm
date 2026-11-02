import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleCampaignListPage,
  chunkItems,
  DELIVERY_SUMMARY_BATCH_SIZE,
  parseCampaignListQuery,
} from "../src/features/campaigns/list-page.ts";

function campaigns(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `campaign-${String(index + 1).padStart(3, "0")}`,
  }));
}

/** 模拟生产 list_campaigns：忽略请求的 page_size，固定每页 20 条。 */
function cappedRpc(all) {
  return (page, _pageSize) => {
    const size = 20;
    const pageCount = Math.max(1, Math.ceil(all.length / size) || 1);
    const resolved = Math.min(Math.max(page, 1), pageCount);
    return Promise.resolve({
      items: all.slice((resolved - 1) * size, resolved * size),
      total: all.length,
      page: resolved,
      page_size: size,
    });
  };
}

/** 模拟已支持动态 page_size 的 RPC（本地迁移，最大 100）。 */
function honoringRpc(all) {
  return (page, pageSize) => {
    const size = Math.min(100, Math.max(1, pageSize));
    const pageCount = Math.max(1, Math.ceil(all.length / size) || 1);
    const resolved = Math.min(Math.max(page, 1), pageCount);
    return Promise.resolve({
      items: all.slice((resolved - 1) * size, resolved * size),
      total: all.length,
      page: resolved,
      page_size: size,
    });
  };
}

test("活动列表 page 与 page_size 解析保持在 20/50/100 可用范围内", () => {
  assert.deepEqual(parseCampaignListQuery({}), { page: 1, pageSize: 20 });
  assert.deepEqual(parseCampaignListQuery({ page: "2", page_size: "50" }), {
    page: 2,
    pageSize: 50,
  });
  assert.deepEqual(parseCampaignListQuery({ page_size: "100" }), {
    page: 1,
    pageSize: 100,
  });
  assert.deepEqual(parseCampaignListQuery({ page: "0", page_size: "0" }), {
    page: 1,
    pageSize: 20,
  });
  assert.equal(parseCampaignListQuery({ page_size: "1000" }).pageSize, 100);
});

test("RPC 固定 20 条时，page_size 50 与 100 仍能拼出对应页", async () => {
  const all = campaigns(55);

  const page50 = await assembleCampaignListPage(
    { page: 1, pageSize: 50 },
    cappedRpc(all),
  );
  assert.equal(page50.page_size, 50);
  assert.equal(page50.page, 1);
  assert.equal(page50.total, 55);
  assert.equal(page50.items.length, 50);
  assert.equal(page50.items[0].id, "campaign-001");
  assert.equal(page50.items.at(-1).id, "campaign-050");

  const page50Next = await assembleCampaignListPage(
    { page: 2, pageSize: 50 },
    cappedRpc(all),
  );
  assert.equal(page50Next.page_size, 50);
  assert.equal(page50Next.page, 2);
  assert.deepEqual(
    page50Next.items.map((item) => item.id),
    [
      "campaign-051",
      "campaign-052",
      "campaign-053",
      "campaign-054",
      "campaign-055",
    ],
  );

  const page100 = await assembleCampaignListPage(
    { page: 1, pageSize: 100 },
    cappedRpc(all),
  );
  assert.equal(page100.page_size, 100);
  assert.equal(page100.page, 1);
  assert.equal(page100.items.length, 55);
  assert.equal(page100.items.at(-1).id, "campaign-055");

  const beyond = await assembleCampaignListPage(
    { page: 4, pageSize: 50 },
    cappedRpc(all),
  );
  assert.equal(beyond.page, 2);
  assert.equal(beyond.page_size, 50);
  assert.equal(beyond.items.length, 5);
});

test("RPC 已按请求返回 page_size 时不再拆页重拉", async () => {
  const all = campaigns(60);
  const calls = [];
  const page = await assembleCampaignListPage(
    { page: 2, pageSize: 50 },
    async (pageNumber, pageSize) => {
      calls.push([pageNumber, pageSize]);
      return honoringRpc(all)(pageNumber, pageSize);
    },
  );
  assert.deepEqual(calls, [[2, 50]]);
  assert.equal(page.page_size, 50);
  assert.equal(page.page, 2);
  assert.equal(page.items.length, 10);
  assert.equal(page.items[0].id, "campaign-051");
});

test("固定 20 条的 RPC 在只有少量活动时仍回显请求的 page_size", async () => {
  const page = await assembleCampaignListPage(
    { page: 1, pageSize: 50 },
    cappedRpc(campaigns(4)),
  );
  assert.equal(page.total, 4);
  assert.equal(page.items.length, 4);
  assert.equal(page.page_size, 50);
  assert.equal(page.page, 1);
});

test("50 与 100 条活动的发送摘要按最多 20 个 ID 分批", () => {
  for (const count of [50, 100]) {
    const batches = chunkItems(campaigns(count), DELIVERY_SUMMARY_BATCH_SIZE);
    assert.equal(
      batches.reduce((sum, batch) => sum + batch.length, 0),
      count,
    );
    assert.ok(batches.every((batch) => batch.length <= 20));
    assert.ok(batches.every((batch) => batch.length > 0));
  }
  assert.deepEqual(
    chunkItems(campaigns(50), 20).map((batch) => batch.length),
    [20, 20, 10],
  );
  assert.deepEqual(
    chunkItems(campaigns(100), 20).map((batch) => batch.length),
    [20, 20, 20, 20, 20],
  );
});
