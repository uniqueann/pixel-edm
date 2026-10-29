"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

/** 编辑类弹窗：关闭与主动离开共用未保存确认，遮罩不触发关闭。 */
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
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(
    null,
  );

  const requestClose = useCallback(() => {
    if (busy) return;
    setPendingLeave(null);
    if (dirty) setDiscardOpen(true);
    else onClose();
  }, [busy, dirty, onClose]);

  const requestLeave = useCallback(
    (leave: () => void) => {
      if (busy) return;
      if (dirty) {
        setPendingLeave({ run: leave });
        setDiscardOpen(true);
      } else {
        onClose();
        leave();
      }
    },
    [busy, dirty, onClose],
  );

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
      onOpenChange={(open) => {
        setDiscardOpen(open);
        if (!open) setPendingLeave(null);
      }}
      title={pendingLeave ? "离开并放弃未保存的更改？" : "放弃未保存的更改？"}
      description={
        pendingLeave
          ? "离开后，当前编辑内容将不会保存。可以继续编辑并先保存。"
          : "关闭后，当前编辑内容将不会保存。"
      }
      confirmLabel={pendingLeave ? "放弃并离开" : "放弃更改"}
      cancelLabel={pendingLeave ? "继续编辑" : "取消"}
      variant="destructive"
      onConfirm={() => {
        setDiscardOpen(false);
        setPendingLeave(null);
        onClose();
        pendingLeave?.run();
      }}
    />
  );

  return {
    handleOpenChange,
    editDialogContentProps,
    requestClose,
    requestLeave,
    discardConfirm,
  };
}
