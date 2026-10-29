import { expect, test, type Locator, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("templates@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/templates");
}

async function fillTemplate(editor: Locator, name: string) {
  await editor.getByLabel("模板名称", { exact: true }).fill(name);
  await editor.getByLabel("邮件主题", { exact: true }).fill("Hello {{name}}");
  await editor
    .getByLabel("纯文本正文", { exact: true })
    .fill("Save {{discount}} on {{product}}.\nBest, {{sender_name}}");
}

async function hasUnloadProtection(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function textContrast(locator: Locator) {
  const styles = await locator.evaluate((element) => {
    const text = getComputedStyle(element);
    let parent: Element | null = element;
    let background = "rgb(255, 255, 255)";
    while (parent) {
      const color = getComputedStyle(parent).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
        background = color;
        break;
      }
      parent = parent.parentElement;
    }
    return { foreground: text.color, background, fontSize: text.fontSize };
  });
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const foreground = luminance(styles.foreground);
  const background = luminance(styles.background);
  return {
    ...styles,
    ratio:
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05),
  };
}

test("模板设置导航与关闭共用未保存保护，刷新可取消", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建模板", exact: true });
  await fillTemplate(editor, "离开保护回归");
  expect(await hasUnloadProtection(page)).toBe(true);

  const unloadPrompt = page.waitForEvent("dialog");
  // 用户取消刷新时不会产生 load；限制导航等待，另行断言草稿仍在。
  const reloadAttempt = page.reload({ timeout: 2000 }).catch(() => null);
  const unloadDialog = await unloadPrompt;
  expect(unloadDialog.type()).toBe("beforeunload");
  await unloadDialog.dismiss();
  await expect(editor.getByLabel("模板名称", { exact: true })).toHaveValue(
    "离开保护回归",
  );
  await reloadAttempt;

  const confirm = page.getByTestId("confirm-dialog");
  for (const label of ["前往发信通道", "前往店铺信息", "前往设置真实署名"]) {
    await editor.getByRole("link", { name: label, exact: true }).click();
    await expect(
      confirm.getByRole("heading", { name: "离开并放弃未保存的更改？" }),
    ).toBeVisible();
    if (label === "前往发信通道")
      await page.screenshot({
        path: testInfo.outputPath("leave-confirm.png"),
        animations: "disabled",
        caret: "hide",
      });
    if (label === "前往店铺信息") await page.keyboard.press("Escape");
    else
      await confirm
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
    await expect(page).toHaveURL(/\/templates$/);
    await expect(editor.getByLabel("模板名称", { exact: true })).toHaveValue(
      "离开保护回归",
    );
  }

  // 取消过导航后，普通关闭不能残留之前的跳转动作。
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    confirm.getByRole("heading", { name: "放弃未保存的更改？", exact: true }),
  ).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await editor.getByRole("link", { name: "前往发信通道", exact: true }).click();
  await confirm
    .getByRole("button", { name: "放弃并离开", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(await hasUnloadProtection(page)).toBe(false);

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "离开保护回归" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  // 未改模板时，配置链接直接前往设置。
  await editor.getByRole("link", { name: "前往发信通道", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(confirm).toBeHidden();
});

test("预览示例不进入保存表单，也不触发模板的未保存状态", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  const editor = page.getByRole("dialog");
  const templateName = "示例值保存边界回归";
  await fillTemplate(editor, templateName);
  const subject = await editor
    .getByLabel("邮件主题", { exact: true })
    .inputValue();
  const body = await editor
    .getByLabel("纯文本正文", { exact: true })
    .inputValue();
  await expect(
    editor.getByText(/示例值仅用于本次预览，不会保存到模板/),
  ).toBeVisible();
  await editor.locator("summary").filter({ hasText: "调整预览示例值" }).click();
  await editor.getByLabel("客户姓名", { exact: false }).fill("Beatrice");
  await editor.getByLabel("优惠信息", { exact: false }).fill("25%");
  await editor.getByLabel("正文署名", { exact: false }).fill("Anna Chen");
  await expect(
    editor.getByText("Hello Beatrice", { exact: true }),
  ).toBeVisible();
  expect(
    await editor
      .getByLabel("优惠信息", { exact: false })
      .evaluate((element) => (element as HTMLInputElement).form === null),
  ).toBe(true);
  await editor.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(page.getByText("模板已保存", { exact: true })).toBeVisible();

  const card = page
    .getByRole("heading", { name: templateName, exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(editor.getByLabel("邮件主题", { exact: true })).toHaveValue(
    subject,
  );
  await expect(editor.getByLabel("纯文本正文", { exact: true })).toHaveValue(
    body,
  );
  await editor.locator("summary").filter({ hasText: "调整预览示例值" }).click();
  await expect(editor.getByLabel("客户姓名", { exact: false })).toHaveValue(
    "Anna",
  );
  await expect(editor.getByLabel("优惠信息", { exact: false })).toHaveValue(
    "10%",
  );
  await editor.getByLabel("优惠信息", { exact: false }).fill("50%");
  expect(await hasUnloadProtection(page)).toBe(false);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();

  await card.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    editor.getByText(/示例值仅用于本次预览，不会保存到模板/),
  ).toBeVisible();
  await editor
    .getByRole("link", { name: "前往设置真实署名", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
});

test("手机预览切换保留示例，保存先定位必填项，保存失败保留正文", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor
    .getByRole("button", { name: "预览当前内容", exact: true })
    .click();
  await editor.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(editor.getByLabel("模板名称", { exact: true })).toBeFocused();
  await fillTemplate(editor, "手机保存失败回归");
  await editor
    .getByRole("button", { name: "预览当前内容", exact: true })
    .click();
  await editor.locator("summary").filter({ hasText: "调整预览示例值" }).click();
  await editor.getByLabel("优惠信息", { exact: false }).fill("30%");
  await editor.getByRole("button", { name: "编辑内容", exact: true }).click();
  await expect(editor.getByLabel("邮件主题", { exact: true })).toHaveValue(
    "Hello {{name}}",
  );
  await editor
    .getByRole("button", { name: "预览当前内容", exact: true })
    .click();
  await expect(editor.getByLabel("优惠信息", { exact: false })).toHaveValue(
    "30%",
  );
  await page.route("**/templates", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().headers()["next-action"]
    )
      await route.abort("failed");
    else await route.continue();
  });
  await editor.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "保存失败，输入已保留，请重试。",
  );
  await expect(editor.getByRole("alert")).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("save-error-mobile.png"),
    animations: "disabled",
    caret: "hide",
  });
  await expect(editor.getByLabel("纯文本正文", { exact: true })).toHaveValue(
    "Save {{discount}} on {{product}}.\nBest, {{sender_name}}",
  );
  await page.unroute("**/templates");
  await editor.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(page.getByText("模板已保存", { exact: true })).toBeVisible();
});

test("模板编辑器在桌面、手机、长内容及键盘收缩时保持操作可达", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const contrast: {
    theme: string;
    note: Awaited<ReturnType<typeof textContrast>>;
    body: Awaited<ReturnType<typeof textContrast>>;
  }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  // 此账号只用于模板回归；通过现有设置流程准备可核对的正常邮件。
  await page.goto("/settings");
  await page.getByLabel("邮件页脚实体地址").fill("上海市测试路 3 号");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("工作区已保存", { exact: true })).toBeVisible();
  await page.getByLabel(/我的对外署名/).fill("Anna Chen");
  await page.getByRole("button", { name: "保存署名", exact: true }).click();
  await expect(page.getByText("对外署名已保存", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "添加 阿里云邮件推送", exact: true })
    .click();
  const channel = page.getByRole("dialog");
  await channel
    .getByLabel("发件域名", { exact: true })
    .fill("send.example.test");
  await channel
    .getByLabel("发件地址", { exact: true })
    .fill("hello@send.example.test");
  await channel
    .getByLabel("发件人名称", { exact: true })
    .fill("Everyday Goods");
  await channel
    .getByLabel("AccessKey ID", { exact: true })
    .fill("LTAI5tTemplate1234");
  await channel
    .getByLabel("AccessKey Secret", { exact: true })
    .fill("template-fixture-only-secret");
  await channel.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "更新发信通道", exact: true }),
  ).toBeVisible();
  await page.goto("/templates");
  for (const width of [1440, 820, 390, 320]) {
    const height = width === 1440 ? 1000 : 844;
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "新建模板", exact: true }).click();
    const editor = page.getByRole("dialog");
    await fillTemplate(editor, "春季上新 · 客户专属优惠");
    await editor
      .getByRole("heading", { name: "新建模板", exact: true })
      .click();
    await editor.getByTestId("template-editor-scroll").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath(`editor-${width}-normal-edit.png`),
      animations: "disabled",
      caret: "hide",
    });
    if (width < 960) {
      await editor
        .getByRole("button", { name: "预览当前内容", exact: true })
        .click();
    }
    await page.screenshot({
      path: testInfo.outputPath(`editor-${width}-normal-preview.png`),
      animations: "disabled",
      caret: "hide",
    });
    if (width === 1440) {
      const note = await textContrast(
        editor.getByText("示例值仅用于本次预览，不会保存到模板。", {
          exact: true,
        }),
      );
      const body = await textContrast(editor.locator("pre"));
      expect(note.ratio).toBeGreaterThanOrEqual(4.5);
      expect(body.ratio).toBeGreaterThanOrEqual(4.5);
      contrast.push({ theme: "light", note, body });
    }
    if (width < 960) {
      await editor
        .getByRole("button", { name: "编辑内容", exact: true })
        .click();
    }
    const longBody =
      "Hi {{name}},\n\nDiscover {{product}} and enjoy {{discount}}.\n\n" +
      "https://shop.example.test/" +
      "new-collection-".repeat(70) +
      "\n\n" +
      "Thoughtfully made for your everyday moments.\n".repeat(18) +
      "\nBest, {{sender_name}}";
    await editor.getByLabel("纯文本正文", { exact: true }).fill(longBody);
    const scroll = editor.getByTestId("template-editor-scroll");
    const footer = editor.getByTestId("template-editor-footer");
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath(`editor-${width}-edit.png`),
      animations: "disabled",
      caret: "hide",
    });
    if (width < 960) {
      await editor
        .getByRole("button", { name: "预览当前内容", exact: true })
        .click();
      await expect(editor.getByRole("form", { name: "模板内容" })).toBeHidden();
    } else {
      const formBox = await editor
        .getByRole("form", { name: "模板内容" })
        .boundingBox();
      const previewBox = await editor
        .getByRole("region", { name: "邮件预览" })
        .boundingBox();
      expect(previewBox!.x).toBeGreaterThan(formBox!.x + formBox!.width - 1);
    }
    await expect(
      editor.getByRole("heading", { name: "邮件预览", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`editor-${width}-preview.png`),
      animations: "disabled",
      caret: "hide",
    });
    await editor
      .locator("summary")
      .filter({ hasText: "调整预览示例值" })
      .click();
    await editor
      .getByLabel("商品名称", { exact: false })
      .fill("Long product name ".repeat(11));
    await editor.getByLabel("正文署名", { exact: false }).fill("Anna Chen");
    await page.screenshot({
      path: testInfo.outputPath(`editor-${width}-samples.png`),
      animations: "disabled",
      caret: "hide",
    });
    expect(
      await editor.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await scroll.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    const footerBefore = await footer.boundingBox();
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const footerAfter = await footer.boundingBox();
    expect(Math.abs(footerBefore!.y - footerAfter!.y)).toBeLessThan(1);
    const saveBounds = await editor
      .getByRole("button", { name: "保存模板", exact: true })
      .boundingBox();
    expect(saveBounds!.height).toBeGreaterThanOrEqual(44);
    expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(height);

    if (width === 390) {
      await editor.getByLabel("优惠信息", { exact: false }).focus();
      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("浏览器未提供 VisualViewport");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          value: 420,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const field = document.activeElement?.getBoundingClientRect();
            const scroll = document
              .querySelector("[data-testid='template-editor-scroll']")
              ?.getBoundingClientRect();
            const footer = document
              .querySelector("[data-testid='template-editor-footer']")
              ?.getBoundingClientRect();
            return Boolean(
              field &&
              scroll &&
              footer &&
              field.top >= scroll.top &&
              field.bottom <= footer.top &&
              footer.bottom <= 421,
            );
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("editor-390-keyboard.png"),
        animations: "disabled",
        caret: "hide",
      });
      await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Reflect.deleteProperty(viewport, "height");
        viewport.dispatchEvent(new Event("resize"));
      });
    }
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByTestId("confirm-dialog")
      .getByRole("button", { name: "放弃更改", exact: true })
      .click();
    await expect(editor).toBeHidden();
    await expect(
      page.getByRole("button", { name: "新建模板", exact: true }),
    ).toBeFocused();
  }

  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.getByRole("menuitem", { name: "深色模式", exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.getByRole("button", { name: "新建模板", exact: true }).click();
    const editor = page.getByRole("dialog");
    await fillTemplate(editor, "春季上新 · 深色核对");
    if (width < 960)
      await editor
        .getByRole("button", { name: "预览当前内容", exact: true })
        .click();
    await page.screenshot({
      path: testInfo.outputPath(`editor-${width}-dark.png`),
      animations: "disabled",
      caret: "hide",
    });
    if (width === 1440) {
      const note = await textContrast(
        editor.getByText("示例值仅用于本次预览，不会保存到模板。", {
          exact: true,
        }),
      );
      const body = await textContrast(editor.locator("pre"));
      expect(note.ratio).toBeGreaterThanOrEqual(4.5);
      expect(body.ratio).toBeGreaterThanOrEqual(4.5);
      contrast.push({ theme: "dark", note, body });
    }
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByTestId("confirm-dialog")
      .getByRole("button", { name: "放弃更改", exact: true })
      .click();
    await expect(editor).toBeHidden();
  }
  await testInfo.attach("contrast.json", {
    body: JSON.stringify(contrast, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
