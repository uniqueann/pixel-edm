import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("test-results/frontend-performance");
const output = path.resolve("docs/images/frontend-performance");
const round = (value) => Math.round(value * 100) / 100;
function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    median: round(
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    ),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
    samples: values.map((value) =>
      Number.isFinite(value) ? round(value) : null,
    ),
  };
}
const phases = {};
const rows = new Map();
const waterfalls = {};
const traces = {};
function group(key, phase, value) {
  if (!rows.has(key)) rows.set(key, {});
  (rows.get(key)[phase] ??= []).push(value);
}
function summarizeRequests(requests) {
  const counts = {};
  for (const request of requests) {
    const name = request.path.split("/").at(-1);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}
for (const phase of ["before", "after"]) {
  const directory = path.join(root, phase);
  const metadata = JSON.parse(
    await readFile(path.join(directory, "metadata.json"), "utf8"),
  );
  const samples = JSON.parse(
    await readFile(path.join(directory, "samples.json"), "utf8"),
  );
  phases[phase] = {
    metadata,
    samples: samples.map((sample) => ({
      size: sample.size,
      device: sample.device,
      index: sample.index,
      loads: sample.loads.map(
        ({
          name,
          route,
          ttfbMs,
          fcpMs,
          lcp,
          cls,
          readyMs,
          ScriptDurationMs,
          TaskDurationMs,
          LayoutDurationMs,
          RecalcStyleDurationMs,
          transfer,
          longtasks,
          requestCount,
          serverRequests,
        }) => ({
          name,
          route,
          ttfbMs,
          fcpMs,
          lcpMs: lcp,
          cls,
          readyMs,
          ScriptDurationMs,
          TaskDurationMs,
          LayoutDurationMs,
          RecalcStyleDurationMs,
          transfer,
          longtasks,
          requestCount,
          serverRequests: summarizeRequests(serverRequests),
        }),
      ),
      tasks: sample.tasks.map(
        ({
          name,
          observedMs,
          feedbackMs,
          ScriptDurationMs,
          LayoutDurationMs,
          RecalcStyleDurationMs,
          TaskDurationMs,
          longtasks,
          inputFrames,
          browserRequests,
          serverRequests,
          sourceRows,
          sourceBytes,
        }) => ({
          name,
          observedMs,
          feedbackMs,
          ScriptDurationMs,
          LayoutDurationMs,
          RecalcStyleDurationMs,
          TaskDurationMs,
          longtasks,
          inputFrames,
          actionPosts: browserRequests?.filter(
            (request) => request.method === "POST",
          ).length,
          serverRequests: summarizeRequests(serverRequests),
          sourceRows,
          sourceBytes,
        }),
      ),
      visual: sample.visual,
    })),
  };
  for (const sample of samples) {
    const prefix = `${sample.size}/${sample.device}`;
    for (const load of sample.loads) {
      for (const key of [
        "ttfbMs",
        "documentTransferMs",
        "fcpMs",
        "lcp",
        "cls",
        "readyMs",
        "ScriptDurationMs",
        "TaskDurationMs",
        "LayoutDurationMs",
        "RecalcStyleDurationMs",
        "requestCount",
      ])
        group(`${prefix}/load/${load.name}/${key}`, phase, load[key]);
      for (const key of [
        "Document",
        "Script",
        "Stylesheet",
        "Font",
        "Image",
        "Fetch",
        "Other",
      ])
        group(
          `${prefix}/load/${load.name}/${key}Bytes`,
          phase,
          load.transfer[key] || 0,
        );
      group(
        `${prefix}/load/${load.name}/longtaskBlockingMs`,
        phase,
        load.longtasks.reduce(
          (sum, task) => sum + Math.max(task.duration - 50, 0),
          0,
        ),
      );
      if (sample.index === 0)
        waterfalls[`${phase}/${prefix}/${load.name}`] = load.resources.map(
          ({
            path,
            type,
            method,
            start,
            end,
            transferBytes,
            status,
            timing,
            initiator,
          }) => ({
            path,
            type,
            method,
            startMs: round((start - load.resources[0].start) * 1000),
            durationMs: round((end - start) * 1000),
            transferBytes,
            status,
            initiator,
            waitHeadersMs: timing?.receiveHeadersStart,
            connectMs:
              timing?.connectEnd >= 0
                ? round(timing.connectEnd - timing.connectStart)
                : null,
          }),
        );
    }
    for (const task of sample.tasks) {
      for (const key of [
        "observedMs",
        "feedbackMs",
        "ScriptDurationMs",
        "TaskDurationMs",
        "LayoutDurationMs",
        "RecalcStyleDurationMs",
      ])
        group(`${prefix}/task/${task.name}/${key}`, phase, task[key]);
      group(
        `${prefix}/task/${task.name}/longtaskBlockingMs`,
        phase,
        task.longtasks.reduce(
          (sum, entry) => sum + Math.max(entry.duration - 50, 0),
          0,
        ),
      );
      if (task.inputFrames?.length) {
        group(
          `${prefix}/task/${task.name}/inputFrameMedianMs`,
          phase,
          distribution(task.inputFrames.map((frame) => frame.duration)).median,
        );
        group(
          `${prefix}/task/${task.name}/inputFrameMaxMs`,
          phase,
          Math.max(...task.inputFrames.map((frame) => frame.duration)),
        );
      }
      if (sample.index === 0)
        waterfalls[`${phase}/${prefix}/${task.name}`] = {
          server: task.serverRequests.map(
            ({ path, startMs, durationMs, status }) => ({
              path,
              startMs: round(startMs - task.serverRequests[0].startMs),
              durationMs: round(durationMs),
              status,
            }),
          ),
          browser: task.browserRequests?.map(
            ({ path, type, method, start, end, transferBytes, timing }) => ({
              path,
              type,
              method,
              durationMs: round((end - start) * 1000),
              transferBytes,
              waitHeadersMs: timing?.receiveHeadersStart,
            }),
          ),
        };
    }
    // 完整操作区间由固定内容准备后的输入、变量插入和可见预览组成。
    const editingTasks = sample.tasks.filter((task) =>
      [
        "template-typing-20",
        "template-insert-variable",
        "template-preview-tab",
      ].includes(task.name),
    );
    group(
      `${prefix}/task/template-input-to-preview/observedMs`,
      phase,
      editingTasks.reduce((sum, task) => sum + task.observedMs, 0),
    );
    group(
      `${prefix}/task/campaign-cold-to-preview/observedMs`,
      phase,
      sample.loads.find((load) => load.name === "campaigns-cold").readyMs +
        sample.tasks.find((task) => task.name === "campaign-preview-first")
          .observedMs,
    );
  }
  try {
    const diagnostic = JSON.parse(
      await readFile(
        path.join(root, `${phase}-diagnostic`, "samples.json"),
        "utf8",
      ),
    );
    traces[phase] = diagnostic.map(({ size, device, traces }) => ({
      size,
      device,
      traces,
    }));
  } catch {
    /* 独立轨迹可单独补录，正式五次数据不引用诊断样本。 */
  }
}
if (
  phases.before.metadata.runtimeSourceSha256 ===
  phases.after.metadata.runtimeSourceSha256
)
  console.warn("两组运行时源码相同：只能作为基线复测。");
if (
  phases.before.metadata.lockfileSha256 !==
    phases.after.metadata.lockfileSha256 ||
  JSON.stringify(phases.before.metadata.conditions) !==
    JSON.stringify(phases.after.metadata.conditions)
)
  throw new Error("前后依赖或测量条件不一致");
const comparison = [...rows].map(([key, values]) => ({
  key,
  before: distribution(values.before ?? []),
  after: distribution(values.after ?? []),
}));
if (
  comparison.some(
    (row) =>
      (row.before?.n !== 5 && row.before !== null) ||
      (row.after?.n !== 5 && row.after !== null),
  )
)
  throw new Error("关键条件没有完整的五次采样");
await mkdir(output, { recursive: true });
for (const [name, value] of Object.entries({
  measurements: phases,
  comparison,
  waterfalls,
  "trace-summary": traces,
}))
  await writeFile(
    path.join(output, `${name}.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
for (const phase of ["before", "after"])
  for (const name of [
    "normal-desktop-campaigns-light",
    "normal-mobile-editor-dark",
    "boundary-desktop-editor-light",
    "boundary-mobile-import-light",
  ])
    await copyFile(
      path.join(root, phase, `${name}.png`),
      path.join(output, `${name}-${phase}.png`),
    );
const selected = comparison.filter((row) =>
  /task\/(campaign-preview-(first|again)|template-typing-20|template-input-to-preview|import-text-input|import-prepare-result)\/observedMs$/.test(
    row.key,
  ),
);
console.log(
  selected
    .map(
      (row) =>
        `${row.key}: ${row.before.median} [${row.before.min}, ${row.before.max}] → ${row.after.median} [${row.after.min}, ${row.after.max}]`,
    )
    .join("\n"),
);
