import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALL_NAMESPACES,
  LOCALES,
  normalizeLocale,
  parseAcceptLanguage,
  resolveUnsubscribeLanguage,
} from "../src/i18n/config.ts";
import { DEFAULT_ZH_ERROR_MESSAGES } from "../src/lib/errors.ts";
import { DEFAULT_ZH_VALIDATION_MESSAGES } from "../src/lib/validation-messages.ts";

const MESSAGES_ROOT = path.resolve(process.cwd(), "messages");

function flattenKeys(node, prefix = "", out = new Map()) {
  if (typeof node === "string") {
    out.set(prefix, node);
    return out;
  }
  assert.ok(
    node && typeof node === "object" && !Array.isArray(node),
    `节点 ${prefix} 必须是对象或字符串`,
  );
  for (const [key, value] of Object.entries(node)) {
    flattenKeys(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/** 提取 ICU 占位符变量名（忽略被单引号转义的字面量花括号）。 */
function extractIcuPlaceholders(template) {
  // 去掉 ICU 单引号转义段（如 '{' 或 '}'），再提取 {name} 或 {name, plural, ...} 中的顶层变量名。
  const unquoted = template.replace(/'[^']*'/g, "");
  const vars = new Set();
  const matches = unquoted.matchAll(/\{([a-zA-Z0-9_]+)(?:\s*,|\s*\})/g);
  for (const match of matches) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

test("i18n 语言协商与退订页三态解析规则正确", () => {
  assert.equal(normalizeLocale("zh"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr-FR"), null);

  assert.equal(
    parseAcceptLanguage("fr-FR,fr;q=0.9,en-US;q=0.8,zh-CN;q=0.7"),
    "en",
  );
  assert.equal(parseAcceptLanguage("en;q=0.5,zh-CN;q=0.9"), "zh-CN");
  assert.equal(parseAcceptLanguage("ja-JP,ko-KR;q=0.8"), null);

  // 退订页优先级：?lang > Accept-Language > 双语兜底
  assert.equal(
    resolveUnsubscribeLanguage({ langParam: "en", acceptLanguage: "zh-CN" }),
    "en",
  );
  assert.equal(
    resolveUnsubscribeLanguage({ langParam: null, acceptLanguage: "en-GB" }),
    "en",
  );
  assert.equal(
    resolveUnsubscribeLanguage({ langParam: null, acceptLanguage: "ja-JP" }),
    "bilingual",
  );
});

test("messages/zh-CN 与 messages/en 16 个命名空间、key 集合、ICU 占位符 100% 对称且无空串", async () => {
  const expectedFiles = [...ALL_NAMESPACES].map((ns) => `${ns}.json`).sort();

  for (const locale of LOCALES) {
    const dir = path.join(MESSAGES_ROOT, locale);
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .sort();
    assert.deepEqual(
      files,
      expectedFiles,
      `${locale} 目录下的 namespace 文件列表必须与 ALL_NAMESPACES 一致`,
    );
  }

  for (const ns of ALL_NAMESPACES) {
    const zhJson = JSON.parse(
      await readFile(path.join(MESSAGES_ROOT, "zh-CN", `${ns}.json`), "utf8"),
    );
    const enJson = JSON.parse(
      await readFile(path.join(MESSAGES_ROOT, "en", `${ns}.json`), "utf8"),
    );

    const zhKeys = flattenKeys(zhJson);
    const enKeys = flattenKeys(enJson);

    assert.deepEqual(
      [...zhKeys.keys()].sort(),
      [...enKeys.keys()].sort(),
      `namespace "${ns}" 的中英文 key 集合不一致`,
    );

    for (const [key, zhValue] of zhKeys.entries()) {
      const enValue = enKeys.get(key) ?? "";
      assert.ok(
        zhValue.trim().length > 0,
        `zh-CN/${ns}.json 中的 "${key}" 不能为空字符串`,
      );
      assert.ok(
        enValue.trim().length > 0,
        `en/${ns}.json 中的 "${key}" 不能为空字符串`,
      );
      assert.deepEqual(
        extractIcuPlaceholders(zhValue),
        extractIcuPlaceholders(enValue),
        `namespace "${ns}" key "${key}" 的 ICU 占位符不一致`,
      );
    }
  }
});

test("errors.json 与 validation.json 完整覆盖底座错误码与校验码", async () => {
  const zhErrors = flattenKeys(
    JSON.parse(
      await readFile(path.join(MESSAGES_ROOT, "zh-CN", "errors.json"), "utf8"),
    ),
    "errors",
  );
  for (const code of Object.keys(DEFAULT_ZH_ERROR_MESSAGES)) {
    assert.ok(
      zhErrors.has(code),
      `messages/zh-CN/errors.json 缺少底座错误码 "${code}"`,
    );
  }

  const zhValidation = flattenKeys(
    JSON.parse(
      await readFile(
        path.join(MESSAGES_ROOT, "zh-CN", "validation.json"),
        "utf8",
      ),
    ),
    "validation",
  );
  for (const code of Object.keys(DEFAULT_ZH_VALIDATION_MESSAGES)) {
    assert.ok(
      zhValidation.has(code),
      `messages/zh-CN/validation.json 缺少底座校验码 "${code}"`,
    );
  }
});
