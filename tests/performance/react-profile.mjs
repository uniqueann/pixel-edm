// 仅在独立 next build --profile 诊断中安装；不进入产品或五次性能测量。
// 读取当前锁定 React 19.2.8 的提交信息，记录已提交的组件执行，忽略旧子树。
export function instrumentReactProfile() {
  const labels = new WeakMap();
  const seen = new WeakMap();
  window.__reactProfileSince = Infinity;
  window.__reactProfileRows = [];
  window.__reactProfileComponents = [];
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id, root) {
      const visit = (fiber) => {
        if (!fiber) return;
        const type = fiber.type;
        if (typeof type === "function") {
          if (!labels.has(type)) {
            const source = Function.prototype.toString.call(type);
            const label = source.includes("邮件模板库")
              ? "Templates"
              : source.includes("调整预览示例值")
                ? "TemplatePreview"
                : source.includes("onDuplicate") && source.includes("onArchive")
                  ? "TemplateGrid"
                  : source.includes("card-content")
                    ? "CardContent"
                    : /["']card["']/.test(source) &&
                        source.includes("data-slot")
                      ? "Card"
                      : source.includes("导入步骤")
                        ? "ContactImporter"
                        : source.includes("确认预检结果")
                          ? "ContactImportResults"
                          : source.includes("campaign-search")
                            ? "Campaigns"
                            : null;
            labels.set(type, label);
          }
          const label = labels.get(type);
          if (label && !window.__reactProfileComponents.includes(label))
            window.__reactProfileComponents.push(label);
          if (
            label &&
            fiber.actualStartTime >= window.__reactProfileSince &&
            seen.get(fiber) !== fiber.actualStartTime &&
            fiber.flags & 1
          ) {
            seen.set(fiber, fiber.actualStartTime);
            window.__reactProfileRows.push({
              component: label,
              durationMs: fiber.actualDuration,
            });
          }
        }
        visit(fiber.child);
        visit(fiber.sibling);
      };
      visit(root.current);
    },
    onCommitFiberUnmount() {},
  };
}
