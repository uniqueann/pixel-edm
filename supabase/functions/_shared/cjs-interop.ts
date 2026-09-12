type ModuleRecord = Record<string, unknown>;

function asRecord(value: unknown): ModuleRecord | null {
  return value !== null && typeof value === "object"
    ? (value as ModuleRecord)
    : null;
}

/**
 * 阿里云 Node.js SDK 以 CommonJS 发布。Deno/ESM 加载后，构造器可能位于
 * 当前对象或一至两层 default 包装内，必须在调用前显式解包。
 */
export function resolveCjsConstructor<T>(
  moduleValue: unknown,
  exportName?: string,
): T {
  let candidate = moduleValue;

  for (let depth = 0; depth < 3; depth += 1) {
    if (!exportName && typeof candidate === "function") return candidate as T;

    const record = asRecord(candidate);
    if (!record) break;
    const named = exportName ? record[exportName] : undefined;
    if (typeof named === "function") return named as T;
    candidate = record.default;
  }

  throw new Error("ALIYUN_SDK_MODULE_INCOMPATIBLE");
}
