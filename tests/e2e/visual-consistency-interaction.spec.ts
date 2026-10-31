import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("列表工具栏保持紧凑、可辨识且不压缩手机点击区", async ({
  page,
  request,
}, info) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing", visualSnapshot: true },
  });
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const measurements = [];
  for (const route of ["/contacts", "/templates", "/campaigns", "/logs"]) {
    await page.goto(route);
    const toolbar = page.locator(".list-toolbar:visible");
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      const height = await toolbar.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      // 限制搜索区占用的首屏高度，同时给窄屏自然换行留下空间。
      const budget =
        width >= 1024 ? 48 : width >= 640 ? 96 : width >= 390 ? 160 : 208;
      expect(height, `${route} / ${width}px`).toBeLessThanOrEqual(budget);
      measurements.push({ route, width, height });
      for (const control of await toolbar.locator("input, select").all()) {
        await expect(control).toHaveAccessibleName(/\S/);
        const box = await control.boundingBox();
        if (width <= 640) {
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    const controls = toolbar.locator("input, select");
    await controls.first().focus();
    await page.keyboard.press("Tab");
    await expect(controls.nth(1)).toBeFocused();
  }
  await mkdir(info.outputPath("measurements"), { recursive: true });
  await writeFile(
    info.outputPath("measurements", "toolbar-density.json"),
    JSON.stringify(measurements, null, 2),
  );
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: {},
  });
});

test("窄屏更多导航的键盘高亮、焦点与跳转保持可见", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const more = page.getByRole("button", { name: "更多导航" });
  await more.focus();
  await page.keyboard.press("ArrowDown");
  const item = page.getByRole("menuitem", { name: "日志", exact: true });
  await expect(item).toBeFocused();
  const metrics = await item.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      width: box.width,
      height: box.height,
    };
  });
  expect(metrics.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(metrics.width).toBeGreaterThanOrEqual(44);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/logs$/);
  await expect(
    page.getByRole("heading", { name: "操作记录", exact: true }),
  ).toBeVisible();
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: {},
  });
});

test("认证与设置表单错误关联保留校验及失败输入", async ({ page }) => {
  await page.goto("/login");
  const email = page.getByLabel("邮箱", { exact: true });
  const password = page.getByLabel("密码", { exact: true });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAttribute("aria-describedby", "email-error");
  await expect(page.locator("#email-error")).not.toBeEmpty();
  await expect(password).toHaveAttribute("aria-describedby", "password-error");
  await email.fill("onboarding@example.test");
  await password.fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings");
  const address = page.getByLabel("邮件页脚实体地址", { exact: true });
  await address.fill("联系方式");
  await address.blur();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(address).toHaveValue("联系方式");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(address).toHaveAttribute(
    "aria-describedby",
    /mailing-address-help mailing-address-error/,
  );
  await expect(page.locator("#mailing-address-error")).not.toBeEmpty();
  const signature = page.getByLabel(/我的对外署名/);
  await signature.fill("店主");
  await signature.blur();
  await page.getByRole("button", { name: "保存署名", exact: true }).click();
  await expect(signature).toHaveValue("店主");
  await expect(signature).toHaveAttribute(
    "aria-describedby",
    /member-display-name-error/,
  );
});

test("页面筛选与编辑弹窗的字段标签独立关联", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing" },
  });
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/contacts");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  await expect(
    page.getByRole("dialog").getByLabel("标签", { exact: true }),
  ).toHaveAttribute("id", "contact-tag");
  await expect(page.locator('[id="contact-tag"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.goto("/templates");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("分类", { exact: true }),
  ).toHaveValue("自定义");
  await expect(page.locator('[id="template-category"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: {},
  });
});

test("共同文字、状态和字段边界在明暗主题下保持可辨识对比度", async ({
  page,
  request,
}, info) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing" },
  });
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const measurements = [];
  for (const route of [
    "/contacts",
    "/templates",
    "/campaigns",
    "/settings",
    "/help",
    "/team",
    "/logs",
  ]) {
    await page.goto(route);
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "切换主题", exact: true }).click();
      await page
        .getByRole("menuitem", {
          name: theme === "light" ? "浅色模式" : "深色模式",
          exact: true,
        })
        .click();
      // 在主题和菜单的短过渡结束后采样，避免把切换中间帧当成静态配色。
      await page.waitForTimeout(250);
      const result = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const luminance = (rgb: ArrayLike<number>) => {
          const linear = Array.from(rgb)
            .slice(0, 3)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const ratio = (a: ArrayLike<number>, b: ArrayLike<number>) => {
          const values = [luminance(a), luminance(b)].sort((a, b) => a - b);
          return (values[1] + 0.05) / (values[0] + 0.05);
        };
        const background = (element: Element) => {
          const ancestors = [];
          for (
            let parent: Element | null = element;
            parent;
            parent = parent.parentElement
          )
            ancestors.unshift(parent);
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 1, 1);
          for (const parent of ancestors) {
            ctx.fillStyle = getComputedStyle(parent).backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
          }
          return ctx.getImageData(0, 0, 1, 1).data;
        };
        const paint = (color: string) => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return ctx.getImageData(0, 0, 1, 1).data;
        };
        const visible = (element: Element) =>
          element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          !element.closest(
            '[disabled],[aria-disabled="true"],[aria-hidden="true"]',
          );
        const text = Array.from(
          document.querySelectorAll(
            '.page-title-line h1,.page-meta,.page-description,.filter-field label,.notice,[data-slot="badge"],.field-error',
          ),
        )
          .filter(visible)
          .filter((element) => element.textContent?.trim())
          .map((element) => {
            const style = getComputedStyle(element);
            const bg = background(element);
            const contrast = ratio(bg, paint(style.color));
            const large =
              parseFloat(style.fontSize) >= 24 ||
              (parseFloat(style.fontSize) >= 18.66 &&
                parseFloat(style.fontWeight) >= 700);
            return {
              selector: element.tagName + "." + element.classList[0],
              label: element.textContent?.trim().slice(0, 60),
              foreground: style.color,
              background: Array.from(bg),
              contrast,
              minimum: large ? 3 : 4.5,
            };
          });
        const fields = Array.from(
          document.querySelectorAll('[data-slot="input"], .list-filter'),
        )
          .filter(visible)
          .map((element) => {
            const style = getComputedStyle(element);
            const bg = background(element);
            return ratio(bg, paint(style.borderTopColor));
          });
        return {
          textCount: text.length,
          minimumText: Math.min(...text.map((item) => item.contrast)),
          minimumField: fields.length ? Math.min(...fields) : null,
          failures: text.filter((item) => item.contrast + 0.01 < item.minimum),
        };
      });
      measurements.push({ route, theme, ...result });
      expect(result.failures, `${route} ${theme}`).toEqual([]);
      if (result.minimumField !== null)
        expect(result.minimumField, `${route} ${theme}`).toBeGreaterThanOrEqual(
          3,
        );
    }
  }
  await info.attach("共同语义对比度.json", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(
    info.outputPath("semantic-contrast.json"),
    JSON.stringify(measurements, null, 2),
  );
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: {},
  });
});
