"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

/** 编辑类弹窗：遮罩不关闭；Esc / 关闭按钮在 dirty 时二次确认。 */
export function useUnsavedEditDialog({
  dirty,
  onClose,
  busy = false,
}: {
  dirty: boolean;
  onClose: () => void;
  busy?: boolean;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }, [busy, dirty, onClose]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) requestClose();
    },
    [requestClose],
  );

  const editDialogContentProps = {
    onInteractOutside: (event: Event) => {
      event.preventDefault();
    },
    onPointerDownOutside: (event: Event) => {
      event.preventDefault();
    },
    onEscapeKeyDown: (event: KeyboardEvent) => {
      event.preventDefault();
      requestClose();
    },
  };

  const discardConfirm = (
    <ConfirmDialog
      open={discardOpen}
      onOpenChange={setDiscardOpen}
      title="放弃未保存的更改？"
      description="关闭后，当前编辑内容将不会保存。"
      confirmLabel="放弃更改"
      variant="destructive"
      onConfirm={() => {
        setDiscardOpen(false);
        onClose();
      }}
    />
  );

  return {
    handleOpenChange,
    editDialogContentProps,
    requestClose,
    discardConfirm,
  };
}
