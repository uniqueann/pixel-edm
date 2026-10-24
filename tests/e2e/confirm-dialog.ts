import type { Page } from "@playwright/test";

/** 点击共用 ConfirmDialog 的确认按钮（data-testid=confirm-dialog）。 */
export async function acceptConfirmDialog(
  page: Page,
  confirmLabel: string | RegExp,
) {
  const dialog = page.getByTestId("confirm-dialog");
  await dialog.getByRole("button", { name: confirmLabel }).click();
}
