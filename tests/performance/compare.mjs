import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".impeccable/frontend-performance");
const output = path.resolve("docs/images/frontend-performance");
const round = (value, precision = 2) =>
  Math.round(value * 10 ** precision) / 10 ** precision;
function distribution(values, precision = 2) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    median: round(
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
      precision,
    ),
    min: round(sorted[0], precision),
    max: round(sorted.at(-1), precision),
    samples: values.map((value) =>
      Number.isFinite(value) ? round(value, precision) : null,
    ),
  };
}
const phases = {};
const rows = new Map();
const waterfalls = {};
const traces = {};
const supplemental = {};
const reactProfiles = {};
function group(key, phase, value) {
  if (!rows.has(key)) rows.set(key, {});
  (rows.get(key)[phase] ??= []).push(value);
}
for (const scope of ["focused-template", "complete-import"]) {
  const groups = new Map();
  const runs = {};
  for (const phase of ["before", "after"]) {
    try {
      const directory = path.join(root, `${phase}-${scope}`);
      const metadata = JSON.parse(
        await readFile(path.join(directory, "metadata.json"), "utf8"),
      );
      const samples = JSON.parse(
        await readFile(path.join(directory, "samples.json"), "utf8"),
      );
      runs[phase] = {
        metadata,
        samples: samples.map(({ size, device, index, tasks }) => ({
          size,
          device,
          index,
          tasks: tasks.map(
            ({
              name,
              observedMs,
              ScriptDurationMs,
              LayoutDurationMs,
              sourceRows,
              sourceBytes,
              serverRequests,
              browserRequests,
            }) => ({
              name,
              observedMs,
              ScriptDurationMs,
              LayoutDurationMs,
              sourceRows,
              sourceBytes,
              serverRequests: serverRequests.map(({ path, durationMs }) => ({
                path,
                durationMs,
              })),
              actionPosts: browserRequests.filter(
                (request) => request.method === "POST",
              ).length,
            }),
          ),
        })),
      };
      for (const sample of samples)
        for (const task of sample.tasks)
          for (const metric of [
            "observedMs",
            "ScriptDurationMs",
            "LayoutDurationMs",
          ]) {
            const key = `${sample.size}/${sample.device}/${task.name}/${metric}`;
            if (!groups.has(key)) groups.set(key, {});
            (groups.get(key)[phase] ??= []).push(task[metric]);
          }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (runs.before && runs.after) {
    const comparisons = [...groups].map(([key, values]) => ({
      key,
      before: distribution(values.before ?? []),
      after: distribution(values.after ?? []),
    }));
    if (comparisons.some((row) => row.before?.n !== 5 || row.after?.n !== 5))
      throw new Error(`补充实验 ${scope} 不满五次`);
    supplemental[scope] = { runs, comparisons };
  }
}
for (const phase of ["before", "after"]) {
  try {
    const directory = path.join(root, `${phase}-react-profile`);
    const metadata = JSON.parse(
      await readFile(path.join(directory, "metadata.json"), "utf8"),
    );
    const samples = JSON.parse(
      await readFile(path.join(directory, "samples.json"), "utf8"),
    );
    reactProfiles[phase] = {
      metadata,
      samples: samples.map((sample) => ({
        size: sample.size,
        device: sample.device,
        tasks: sample.tasks.map((task) => {
          const components = {};
          for (const label of task.reactProfileComponents ?? [])
            components[label] = {
              committedExecutions: 0,
              inclusiveDurationMs: 0,
            };
          for (const row of task.reactProfile ?? []) {
            components[row.component] ??= {
              committedExecutions: 0,
              inclusiveDurationMs: 0,
            };
            components[row.component].committedExecutions++;
            components[row.component].inclusiveDurationMs = round(
              components[row.component].inclusiveDurationMs + row.durationMs,
            );
          }
          return { name: task.name, components };
        }),
      })),
    };
    if (samples.some((sample) => sample.traces))
      traces[phase] = samples.map(({ size, device, traces }) => ({
        size,
        device,
        traces,
      }));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
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
    // 阶段预算相加用于核对成本转移，不作为连续用户任务的实测耗时。
    const editingTasks = sample.tasks.filter((task) =>
      [
        "template-typing-20",
        "template-insert-variable",
        "template-preview-tab",
      ].includes(task.name),
    );
    group(
      `${prefix}/budget/template-typing-plus-insert-and-tab/observedMs`,
      phase,
      editingTasks.reduce((sum, task) => sum + task.observedMs, 0),
    );
    group(
      `${prefix}/budget/campaign-cold-plus-preview/observedMs`,
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
    traces[phase] ??= diagnostic.map(({ size, device, traces }) => ({
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
for (const [scope, experiment] of Object.entries(supplemental))
  for (const phase of ["before", "after"]) {
    const metadata = experiment.runs[phase].metadata;
    const original = phases[phase].metadata;
    if (
      metadata.runtimeSourceSha256 !== original.runtimeSourceSha256 ||
      metadata.lockfileSha256 !== original.lockfileSha256 ||
      metadata.browser !== original.browser ||
      JSON.stringify(metadata.conditions) !==
        JSON.stringify(original.conditions) ||
      metadata.reactProfilingBuild
    )
      throw new Error(`补充实验 ${scope} 与对应生产源码或条件不一致`);
  }
const comparison = [...rows].map(([key, values]) => ({
  key,
  before: distribution(values.before ?? [], key.endsWith("/cls") ? 6 : 2),
  after: distribution(values.after ?? [], key.endsWith("/cls") ? 6 : 2),
}));
if (
  comparison.some(
    (row) =>
      !row.key.endsWith("/feedbackMs") &&
      ((row.before?.n !== 5 && row.before !== null) ||
        (row.after?.n !== 5 && row.after !== null)),
  )
)
  throw new Error("关键条件没有完整的五次采样");
await mkdir(output, { recursive: true });
for (const [name, value] of Object.entries({
  measurements: phases,
  comparison,
  waterfalls,
  "trace-summary": traces,
  supplemental,
  "react-profile-summary": reactProfiles,
}))
  await writeFile(
    path.join(output, `${name}.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
for (const phase of ["before", "after"])
  for (const name of [
    "normal-desktop-campaigns-light",
    "normal-desktop-editor-dark",
    "normal-mobile-editor-dark",
    "boundary-desktop-editor-light",
  ])
    await copyFile(
      path.join(root, phase, `${name}.png`),
      path.join(output, `${name}-${phase}.png`),
    );
if (supplemental["complete-import"])
  for (const phase of ["before", "after"])
    await copyFile(
      path.join(
        root,
        `${phase}-complete-import`,
        "boundary-mobile-import-light.png",
      ),
      path.join(output, `complete-boundary-mobile-import-light-${phase}.png`),
    );
await copyFile(
  path.join(root, "after", "boundary-mobile-import-light.png"),
  path.join(output, "import-count-loading-after.png"),
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
