import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { environment } from "./environment.mjs";
import { instrumentReactProfile } from "./react-profile.mjs";

const phase = process.argv[2] || "before";
const samples = Number(process.env.EDM_PERF_SAMPLES || 5);
const directory = path.resolve(".impeccable/frontend-performance", phase);
const baseURL = "http://localhost:3110";
const fixtureURL = "http://127.0.0.1:54329";
const children = [];
await mkdir(directory, { recursive: true });
function start(command, args, env, name) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let log = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      log += data;
    });
  child.saveLog = () => writeFile(path.join(directory, `${name}.log`), log);
  return child;
}
async function waitForServer(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出：${url}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* 等待本地服务启动。 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`测试服务启动超时：${url}`);
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
async function sourceFingerprint() {
  const files = git("ls-files", "src", "next.config.ts").split("\n");
  return digest(
    Buffer.concat(
      await Promise.all(
        files.map(async (file) =>
          Buffer.concat([Buffer.from(file), await readFile(file)]),
        ),
      ),
    ),
  );
}
async function fixture(reset = false) {
  return (
    await fetch(`${fixtureURL}/__fixtures/performance`, {
      method: "POST",
      body: JSON.stringify({ reset }),
    })
  ).json();
}
function instrument() {
  window.__edmPerf = { lcp: 0, cls: 0, longtasks: [], inputs: [], events: [] };
  for (const type of [
    "largest-contentful-paint",
    "layout-shift",
    "longtask",
    "event",
  ]) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (type === "largest-contentful-paint")
            window.__edmPerf.lcp = entry.startTime;
          if (type === "layout-shift" && !entry.hadRecentInput)
            window.__edmPerf.cls += entry.value;
          if (type === "longtask")
            window.__edmPerf.longtasks.push({
              start: entry.startTime,
              duration: entry.duration,
            });
          if (type === "event")
            window.__edmPerf.events.push({
              name: entry.name,
              duration: entry.duration,
              interactionId: entry.interactionId,
            });
        }
      }).observe({
        type,
        buffered: true,
        ...(type === "event" ? { durationThreshold: 16 } : {}),
      });
    } catch {
      /* 不支持的观察类型不补造数据。 */
    }
  }
  document.addEventListener(
    "input",
    (event) => {
      const start = performance.now();
      const id = event.target.id;
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          window.__edmPerf.inputs.push({
            id,
            duration: performance.now() - start,
          }),
        ),
      );
    },
    true,
  );
}
async function frames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function metrics(cdp) {
  return Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map(
      ({ name, value }) => [name, value],
    ),
  );
}
function delta(before, after) {
  return Object.fromEntries(
    [
      "ScriptDuration",
      "TaskDuration",
      "LayoutDuration",
      "RecalcStyleDuration",
    ].map((key) => [key + "Ms", (after[key] - before[key]) * 1000]),
  );
}
async function observedTask(page, cdp, name, act, ready) {
  await fixture(true);
  const before = await metrics(cdp);
  const previousRequests = new Set(page.perfRequests.keys());
  const t0 = await page.evaluate((name) => {
    performance.mark(`${name}-start`);
    const start = performance.now();
    if (window.__reactProfileRows) {
      window.__reactProfileSince = start;
      window.__reactProfileRows = [];
    }
    window.__feedbackMs = null;
    let scheduled = false;
    window.__feedbackObserver = new MutationObserver((records) => {
      if (scheduled) return;
      const visible = records.some((record) => {
        const element =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        return (
          element?.closest("main,[role=dialog]")?.checkVisibility() ||
          [...record.addedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches("[role=dialog]") ||
                node.querySelector("[role=dialog]")),
          )
        );
      });
      if (visible) {
        scheduled = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.__feedbackMs = performance.now() - start;
          }),
        );
      }
    });
    window.__feedbackObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-busy"],
    });
    return start;
  }, name);
  await act();
  await ready();
  await frames(page);
  const end = await page.evaluate((name) => {
    performance.mark(`${name}-end`);
    window.__feedbackObserver.disconnect();
    return {
      now: performance.now(),
      longtasks: window.__edmPerf.longtasks,
      feedbackMs: window.__feedbackMs,
      reactProfile: window.__reactProfileRows,
      reactProfileComponents: window.__reactProfileComponents,
    };
  }, name);
  return {
    name,
    observedMs: end.now - t0,
    feedbackMs: end.feedbackMs,
    reactProfile: end.reactProfile,
    reactProfileComponents: end.reactProfileComponents,
    browserRequests: [...page.perfRequests.entries()]
      .filter(([id, value]) => !previousRequests.has(id) && value.end)
      .map(([, value]) => value),
    ...delta(before, await metrics(cdp)),
    longtasks: end.longtasks.filter((task) => task.start >= t0),
    serverRequests: (await fixture()).requests,
  };
}
async function login(browser, email) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "切换主题", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const state = await context.storageState();
  await context.close();
  return state;
}
async function openContext(browser, storageState, device) {
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport: device.viewport,
    deviceScaleFactor: device.mobile ? 2 : 1,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    colorScheme: "light",
  });
  // 浏览器使用只放行回环地址的代理配置，保留原生 HTTP 缓存。
  await context.addInitScript(instrument);
  if (process.env.EDM_PERF_REACT_PROFILE)
    await context.addInitScript(instrumentReactProfile);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
    connectionType: "cellular4g",
  });
  // 显式恢复 HTTP 缓存，并通过实际 transferBytes 验证热缓存是否生效。
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["localhost:3110", "127.0.0.1:54329"].includes(url.host))
      throw new Error(`发现非本地请求：${url.origin}`);
  });
  const requests = new Map();
  cdp.on("Network.requestWillBeSent", (entry) =>
    requests.set(entry.requestId, {
      path: new URL(entry.request.url).pathname,
      type: entry.type,
      method: entry.request.method,
      start: entry.timestamp,
      initiator: entry.initiator.type,
    }),
  );
  cdp.on("Network.responseReceived", (entry) =>
    Object.assign(requests.get(entry.requestId) || {}, {
      status: entry.response.status,
      encodedBodyBytes: entry.response.encodedDataLength,
      cache: Boolean(
        entry.response.fromDiskCache || entry.response.fromPrefetchCache,
      ),
      mime: entry.response.mimeType,
      timing: entry.response.timing,
    }),
  );
  cdp.on("Network.loadingFinished", (entry) =>
    Object.assign(requests.get(entry.requestId) || {}, {
      transferBytes: entry.encodedDataLength,
      end: entry.timestamp,
    }),
  );
  page.perfRequests = requests;
  return { context, page, cdp, requests };
}
async function load(page, cdp, requests, route, name) {
  await fixture(true);
  requests.clear();
  await page.goto(route);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "切换主题", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  await page.waitForTimeout(150);
  const navigation = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      ttfbMs: nav.responseStart,
      documentTransferMs: nav.responseEnd - nav.responseStart,
      domContentLoadedMs: nav.domContentLoadedEventEnd,
      fcpMs:
        performance.getEntriesByName("first-contentful-paint")[0]?.startTime ??
        null,
      readyMs: performance.now(),
      ...window.__edmPerf,
    };
  });
  const resources = [...requests.values()].filter((request) => request.end);
  const transfer = {};
  for (const request of resources)
    transfer[request.type] =
      (transfer[request.type] || 0) + (request.transferBytes || 0);
  return {
    name,
    route,
    ...navigation,
    ...delta(
      {
        ScriptDuration: 0,
        TaskDuration: 0,
        LayoutDuration: 0,
        RecalcStyleDuration: 0,
      },
      await metrics(cdp),
    ),
    transfer,
    requestCount: resources.length,
    resources,
    serverRequests: (await fixture()).requests,
  };
}
async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    animations: "disabled",
    caret: "hide",
  });
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    width: innerWidth,
    height: innerHeight,
    headingFont: getComputedStyle(document.querySelector("h1")).fontFamily,
    controls: [...document.querySelectorAll("button,input,textarea,select")]
      .filter((el) => el.checkVisibility())
      .map((el) => ({
        name:
          el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
  }));
}
async function campaignTasks(page, cdp) {
  const tasks = [];
  const draft = page
    .getByRole("heading", { name: "性能活动 001", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  const dialog = page.getByRole("dialog");
  for (const iteration of ["first", "again"]) {
    tasks.push(
      await observedTask(
        page,
        cdp,
        `campaign-editor-${iteration}`,
        () => draft.getByRole("button", { name: "编辑", exact: true }).click(),
        () => expect(dialog.getByLabel("活动名称")).toBeEnabled(),
      ),
    );
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  }
  for (const iteration of ["first", "again"]) {
    tasks.push(
      await observedTask(
        page,
        cdp,
        `campaign-preview-${iteration}`,
        () => draft.getByRole("button", { name: "预览", exact: true }).click(),
        () =>
          expect(
            dialog.getByText("前 3 封邮件", { exact: true }),
          ).toBeVisible(),
      ),
    );
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  const completed = page
    .getByRole("heading", { name: "性能活动 000", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  for (const iteration of ["first", "again"]) {
    tasks.push(
      await observedTask(
        page,
        cdp,
        `campaign-statistics-${iteration}`,
        () =>
          completed
            .getByRole("button", { name: "统计与明细", exact: true })
            .click(),
        () =>
          expect(
            dialog.getByText(/perf-\d+@example.test/).first(),
          ).toBeVisible(),
      ),
    );
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  return tasks;
}
async function templateTasks(page, cdp, mobile, boundary) {
  const tasks = [];
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("button", { name: "编辑", exact: true }) })
    .first();
  const dialog = page.getByRole("dialog");
  for (const iteration of ["first", "again"]) {
    tasks.push(
      await observedTask(
        page,
        cdp,
        `template-editor-${iteration}`,
        () => card.getByRole("button", { name: "编辑", exact: true }).click(),
        () =>
          expect(
            dialog.getByLabel("纯文本正文", { exact: true }),
          ).toBeVisible(),
      ),
    );
    if (iteration === "first") {
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      continue;
    }
  }
  const body = dialog.getByLabel("纯文本正文", { exact: true });
  const content = "Hello {{name}}, {{product}}.\n"
    .repeat(boundary ? 800 : 20)
    .slice(0, boundary ? 19950 : 500);
  await body.fill(content);
  await body.press("End");
  await page.evaluate(() => {
    window.__edmPerf.inputs = [];
  });
  tasks.push(
    await observedTask(
      page,
      cdp,
      "template-typing-20",
      () => body.pressSequentially("PERFORMANCE-FINAL-20", { delay: 15 }),
      () =>
        expect(dialog.locator("pre").first()).toContainText(
          "PERFORMANCE-FINAL-20",
        ),
    ),
  );
  tasks.at(-1).inputFrames = await page.evaluate(() => window.__edmPerf.inputs);
  const variable = dialog.getByRole("button", { name: /客户姓名/ }).first();
  tasks.push(
    await observedTask(
      page,
      cdp,
      "template-insert-variable",
      () => variable.click(),
      () => expect(body).toHaveValue(/PERFORMANCE-FINAL-20{{name}}/),
    ),
  );
  if (mobile) {
    tasks.push(
      await observedTask(
        page,
        cdp,
        "template-preview-tab",
        () =>
          dialog
            .getByRole("button", { name: "预览当前内容", exact: true })
            .click(),
        () => expect(dialog.locator("pre").first()).toBeVisible(),
      ),
    );
  }
  return tasks;
}
async function importTasks(page, cdp, boundary, iteration) {
  const rows = boundary ? 1000 : 20;
  const csvFlow = Boolean(process.env.EDM_PERF_IMPORT_FILE_FLOW);
  const content =
    "email,name,备注\n" +
    Array.from(
      { length: rows },
      (_, index) =>
        `import-${iteration}-${index}@example.test,测试客户 ${index},${"本地".repeat(boundary ? 300 : 5)}`,
    ).join("\n");
  const tasks = [];
  await page.getByRole("button", { name: "CSV 文件", exact: true }).click();
  const flowStart = await page.evaluate(() => performance.now());
  tasks.push(
    await observedTask(
      page,
      cdp,
      "import-file-read",
      () =>
        page.getByLabel("选择 CSV 文件", { exact: true }).setInputFiles({
          name: "performance.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(content),
        }),
      () =>
        expect(
          page.getByText("performance.csv", { exact: false }).first(),
        ).toBeVisible(),
    ),
  );
  if (!csvFlow) {
    await page.getByRole("button", { name: "粘贴", exact: true }).click();
    if (process.env.EDM_PERF_EXPERIMENT)
      await page.locator("#import-text").evaluate((element, variant) => {
        element.spellcheck = false;
        if (variant === "nowrap") element.wrap = "off";
        if (variant === "contain") element.style.contain = "strict";
      }, process.env.EDM_PERF_EXPERIMENT);
    tasks.push(
      await observedTask(
        page,
        cdp,
        "import-text-input",
        () => page.locator("#import-text").fill(content),
        () => expect(page.locator("#import-text")).toHaveValue(content),
      ),
    );
  }
  tasks.push(
    await observedTask(
      page,
      cdp,
      csvFlow ? "import-prepare-complete" : "import-prepare-result",
      () => page.getByRole("button", { name: "预检名单", exact: true }).click(),
      async () => {
        await expect(
          page.getByRole("heading", { name: "确认预检结果", exact: true }),
        ).toBeVisible();
        if (csvFlow)
          await expect(
            page
              .getByText("去重后邮箱数", { exact: true })
              .locator("..")
              .locator("dd"),
          ).toHaveText(String(rows), { timeout: 30000 });
      },
    ),
  );
  tasks.at(-1).sourceRows = rows;
  tasks.at(-1).sourceBytes = Buffer.byteLength(content);
  if (csvFlow) {
    const whole = {
      name: "import-file-to-final-result",
      observedMs: await page.evaluate(
        (start) => performance.now() - start,
        flowStart,
      ),
      feedbackMs: tasks[0].feedbackMs,
      sourceRows: rows,
      sourceBytes: Buffer.byteLength(content),
    };
    for (const key of [
      "ScriptDurationMs",
      "LayoutDurationMs",
      "RecalcStyleDurationMs",
      "TaskDurationMs",
    ])
      whole[key] = tasks.reduce((sum, task) => sum + task[key], 0);
    for (const key of ["longtasks", "serverRequests", "browserRequests"])
      whole[key] = tasks.flatMap((task) => task[key]);
    tasks.push(whole);
  }
  return tasks;
}

let browser;
const results = [];
try {
  if (!process.env.EDM_PERF_SKIP_BUILD) {
    const build = start(
      "npm",
      [
        "run",
        "build",
        ...(process.env.EDM_PERF_REACT_PROFILE ? ["--", "--profile"] : []),
      ],
      environment,
      "build",
    );
    await new Promise((resolve, reject) =>
      build.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("生产构建失败")),
      ),
    );
  }
  const fixtureProcess = start(
    "node",
    ["tests/auth-fixture.mjs"],
    { ...environment, EDM_PERFORMANCE: "1" },
    "fixture",
  );
  await waitForServer(`${fixtureURL}/health`, fixtureProcess);
  const app = start(
    "node",
    ["node_modules/next/dist/bin/next", "start", "--port", "3110"],
    environment,
    "start",
  );
  await waitForServer(`${baseURL}/login`, app);
  browser = await chromium.launch({
    channel: "chrome",
    proxy: { server: "http://127.0.0.1:9", bypass: "localhost,127.0.0.1" },
  });
  const metadata = {
    phase,
    reactProfilingBuild: Boolean(process.env.EDM_PERF_REACT_PROFILE),
    importFileFlow: Boolean(process.env.EDM_PERF_IMPORT_FILE_FLOW),
    samples,
    commit: git("rev-parse", "HEAD"),
    runtimeSourceSha256: await sourceFingerprint(),
    lockfileSha256: digest(await readFile("package-lock.json")),
    buildId: (await readFile(".next/BUILD_ID", "utf8")).trim(),
    browser: browser.version(),
    system: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      node: process.version,
    },
    conditions: {
      cpuRate: 4,
      latencyMs: 40,
      downloadBitsPerSecond: 1_600_000,
      uploadBitsPerSecond: 750_000,
      fixtureDelayMs: 20,
    },
    definitions: {
      observedMs:
        "自动化开始操作至结果断言和两帧完成，含驱动及等待开销，不等同于 INP",
      inputFrames: "input 捕获至第二个 rAF 回调的观测时长，不等同于 INP",
      readyMs:
        "文档首屏标题、主题水合、字体和两帧后，含150ms观察窗；不是可交互时间标准",
      trace: "独立诊断采样；不混入五次指标",
    },
    excludedSamples: [],
  };
  await writeFile(
    path.join(directory, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
  for (const size of (process.env.EDM_PERF_SIZES || "normal,boundary").split(
    ",",
  )) {
    const boundary = size === "boundary";
    const storageState = await login(
      browser,
      boundary ? "templates@example.test" : "owner@example.test",
    );
    for (const device of [
      {
        name: "desktop",
        viewport: { width: 1440, height: 960 },
        mobile: false,
      },
      { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
    ]) {
      if (
        process.env.EDM_PERF_DEVICES &&
        !process.env.EDM_PERF_DEVICES.split(",").includes(device.name)
      )
        continue;
      for (let index = 0; index < samples; index++) {
        const sample = {
          size,
          device: device.name,
          index,
          loads: [],
          tasks: [],
          visual: [],
        };
        for (const routeName of (
          process.env.EDM_PERF_ROUTES || "campaigns,templates,contacts/import"
        ).split(",")) {
          const route = `/${routeName}${boundary && routeName !== "contacts/import" ? `?page_size=${routeName === "templates" ? 50 : 20}` : ""}`;
          const { context, page, cdp, requests } = await openContext(
            browser,
            storageState,
            device,
          );
          console.log(
            `${phase} ${size}/${device.name} ${index + 1}/${samples} ${routeName}`,
          );
          if (process.env.EDM_PERF_DIAGNOSTIC)
            await cdp.send("Tracing.start", {
              categories:
                "devtools.timeline,blink.user_timing,disabled-by-default-v8.cpu_profiler",
              transferMode: "ReturnAsStream",
            });
          sample.loads.push(
            await load(page, cdp, requests, route, `${routeName}-cold`),
          );
          sample.loads.push(
            await load(page, cdp, requests, route, `${routeName}-warm`),
          );
          if (routeName === "campaigns") {
            sample.tasks.push(...(await campaignTasks(page, cdp)));
            if (index === 0)
              sample.visual.push({
                routeName,
                theme: "light",
                ...(await screenshot(
                  page,
                  `${size}-${device.name}-campaigns-light`,
                )),
              });
            sample.tasks.push(
              await observedTask(
                page,
                cdp,
                "soft-campaigns-to-templates",
                () =>
                  page.getByRole("link", { name: "模板", exact: true }).click(),
                () => expect(page.locator("main h1")).toContainText("模板"),
              ),
            );
            sample.tasks.push(
              await observedTask(
                page,
                cdp,
                "soft-templates-to-campaigns",
                () =>
                  page.getByRole("link", { name: "活动", exact: true }).click(),
                () => expect(page.locator("main h1")).toContainText("发信活动"),
              ),
            );
          }
          if (routeName === "templates") {
            sample.tasks.push(
              ...(await templateTasks(page, cdp, device.mobile, boundary)),
            );
            if (index === 0) {
              sample.visual.push({
                routeName,
                theme: "light",
                ...(await screenshot(
                  page,
                  `${size}-${device.name}-editor-light`,
                )),
              });
              await page.evaluate(() =>
                document.documentElement.classList.add("dark"),
              );
              sample.visual.push({
                routeName,
                theme: "dark",
                ...(await screenshot(
                  page,
                  `${size}-${device.name}-editor-dark`,
                )),
              });
            }
          }
          if (routeName === "contacts/import") {
            sample.tasks.push(
              ...(await importTasks(page, cdp, boundary, index)),
            );
            if (index === 0)
              sample.visual.push({
                routeName,
                theme: "light",
                ...(await screenshot(
                  page,
                  `${size}-${device.name}-import-light`,
                )),
              });
          }
          // 测量不提交模板草稿，关闭隔离上下文直接丢弃本次编辑。
          if (process.env.EDM_PERF_DIAGNOSTIC) {
            const complete = new Promise((resolve) =>
              cdp.once("Tracing.tracingComplete", resolve),
            );
            await cdp.send("Tracing.end");
            const { stream } = await complete;
            let trace = "";
            for (;;) {
              const chunk = await cdp.send("IO.read", { handle: stream });
              trace += chunk.data;
              if (chunk.eof) break;
            }
            await cdp.send("IO.close", { handle: stream });
            await writeFile(
              path.join(
                directory,
                `${size}-${device.name}-${routeName.replaceAll("/", "-")}-trace.json`,
              ),
              trace,
            );
            const events = JSON.parse(trace).traceEvents;
            const costs = {};
            for (const event of events)
              if (event.ph === "X" && event.dur)
                costs[event.name] = (costs[event.name] || 0) + event.dur / 1000;
            const longest = events
              .filter(
                (event) =>
                  event.ph === "X" &&
                  event.dur &&
                  [
                    "FunctionCall",
                    "Layout",
                    "UpdateLayoutTree",
                    "RunTask",
                    "EvaluateScript",
                  ].includes(event.name),
              )
              .sort((a, b) => b.dur - a.dur)
              .slice(0, 35)
              .map((event) => ({
                name: event.name,
                ms: event.dur / 1000,
                functionName: event.args?.data?.functionName,
                url: event.args?.data?.url?.replace(baseURL, ""),
              }));
            const stageCosts = {};
            for (const mark of events.filter(
              (event) =>
                event.name.endsWith("-start") &&
                event.cat?.includes("user_timing"),
            )) {
              const name = mark.name.slice(0, -6);
              const end = events.find(
                (event) => event.name === `${name}-end` && event.ts > mark.ts,
              );
              if (!end) continue;
              const stage = {};
              for (const event of events)
                if (
                  event.ph === "X" &&
                  event.dur &&
                  event.pid === mark.pid &&
                  event.tid === mark.tid &&
                  event.ts >= mark.ts &&
                  event.ts + event.dur <= end.ts
                )
                  stage[event.name] =
                    (stage[event.name] || 0) + event.dur / 1000;
              stageCosts[name] = stage;
            }
            (sample.traces ??= []).push({
              routeName,
              costs,
              longest,
              stageCosts,
            });
          }
          await writeFile(
            path.join(directory, "partial.json"),
            JSON.stringify(sample, null, 2),
          );
          page.on("dialog", (dialog) => void dialog.accept());
          await context.close();
        }
        results.push(sample);
        await writeFile(
          path.join(directory, "samples.json"),
          JSON.stringify(results, null, 2),
        );
        console.log(`${phase} ${size}/${device.name} ${index + 1}/${samples}`);
      }
    }
  }
} catch (error) {
  for (const context of browser?.contexts() || [])
    for (const page of context.pages())
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          animations: "disabled",
        })
        .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  for (const child of children) {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    await child.saveLog();
  }
}
