/** 活动列表允许的最大每页条数，与分页控件的 20/50/100 对齐。 */
export const CAMPAIGN_LIST_MAX_PAGE_SIZE = 100;

/**
 * 正式发送摘要 RPC 单次最多接受 20 个活动 ID。
 * 生产库的 list_campaigns 目前也固定按 20 条分页；本地迁移已能直接返回 50/100。
 */
export const DELIVERY_SUMMARY_BATCH_SIZE = 20;

export type CampaignPageQuery = {
  page: number;
  pageSize: number;
};

export type CampaignPageChunk<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

function countOf(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function itemsOf<T>(chunk: CampaignPageChunk<T>) {
  return Array.isArray(chunk.items) ? chunk.items : [];
}

/** 把地址栏里的 page / page_size 收成 1…1000000 页、1…100 条。 */
export function parseCampaignListQuery(input: {
  page?: string;
  page_size?: string;
}): CampaignPageQuery {
  return {
    page: Math.min(
      1_000_000,
      Math.max(1, Number.parseInt(input.page ?? "1", 10) || 1),
    ),
    pageSize: Math.min(
      CAMPAIGN_LIST_MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(input.page_size ?? "20", 10) || 20),
    ),
  };
}

/**
 * 按请求的页码和每页条数取活动列表。
 * 若 RPC 原样返回所请求的 page_size，直接使用这一页。
 * 若 RPC 把 page_size 压回更小的固定页（生产环境目前固定 20），则按该固定页拼出 50/100。
 */
export async function assembleCampaignListPage<T>(
  query: CampaignPageQuery,
  fetchPage: (page: number, pageSize: number) => Promise<CampaignPageChunk<T>>,
): Promise<CampaignPageChunk<T>> {
  const probe = await fetchPage(query.page, query.pageSize);
  const total = Math.max(0, countOf(probe.total, 0));
  const returnedSize = countOf(probe.page_size, 0);
  if (returnedSize === query.pageSize) {
    return {
      ...probe,
      items: itemsOf(probe),
      total,
      page: Math.max(1, countOf(probe.page, query.page)),
      page_size: returnedSize,
    };
  }

  const chunkSize = Math.max(1, returnedSize || DELIVERY_SUMMARY_BATCH_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize) || 1);
  const page = Math.min(query.page, pageCount);
  const start = (page - 1) * query.pageSize;
  const chunkCount = Math.max(1, Math.ceil(total / chunkSize) || 1);
  const firstChunk = Math.min(Math.floor(start / chunkSize) + 1, chunkCount);
  const lastChunk =
    total === 0
      ? firstChunk
      : Math.min(
          Math.floor((start + query.pageSize - 1) / chunkSize) + 1,
          chunkCount,
        );

  const chunks = new Map<number, CampaignPageChunk<T>>();
  const probePage = countOf(probe.page, 0);
  if (
    probePage >= firstChunk &&
    probePage <= lastChunk &&
    returnedSize === chunkSize
  ) {
    chunks.set(probePage, probe);
  }

  const missing: number[] = [];
  for (let chunkPage = firstChunk; chunkPage <= lastChunk; chunkPage += 1) {
    if (!chunks.has(chunkPage)) missing.push(chunkPage);
  }
  const loaded = await Promise.all(
    missing.map(async (chunkPage) => {
      const chunk = await fetchPage(chunkPage, chunkSize);
      return [chunkPage, chunk] as const;
    }),
  );
  for (const [chunkPage, chunk] of loaded) {
    if (countOf(chunk.page, 0) !== chunkPage) {
      throw new Error("活动加载失败，请重试。");
    }
    chunks.set(chunkPage, chunk);
  }

  const ordered: T[] = [];
  for (let chunkPage = firstChunk; chunkPage <= lastChunk; chunkPage += 1) {
    const chunk = chunks.get(chunkPage);
    if (chunk) ordered.push(...itemsOf(chunk));
  }
  const offset = start - (firstChunk - 1) * chunkSize;
  return {
    items: ordered.slice(offset, offset + query.pageSize),
    total,
    page,
    page_size: query.pageSize,
  };
}

/** 把活动 ID 分成摘要 RPC 能接受的批次，每批不超过 size。 */
export function chunkItems<T>(items: T[], size: number) {
  if (size < 1) throw new Error("批次大小无效");
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    batches.push(items.slice(offset, offset + size));
  }
  return batches;
}
