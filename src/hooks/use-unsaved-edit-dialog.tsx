"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";

/** 编辑类弹窗：关闭与主动离开共用未保存确认，遮罩不触发关闭。 */
export function useUnsavedEditDialog({
  dirty,
  onClose,
  busy = false,
  cancelLabel,
  onReturnFocus,
  confirmClassName,
}: {
  dirty: boolean;
  onClose: () => void;
  busy?: boolean;
  cancelLabel?: string;
  onReturnFocus?: () => void;
  confirmClassName?: string;
}) {
  const t = useTranslations("common");
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

  const resolvedCancelLabel = cancelLabel ?? t("actions.cancel");

  const discardConfirm = (
    <ConfirmDialog
      open={discardOpen}
      onOpenChange={(open) => {
        setDiscardOpen(open);
        if (!open) setPendingLeave(null);
      }}
      title={
        pendingLeave
          ? t("unsavedDialog.leaveTitle")
          : t("unsavedDialog.closeTitle")
      }
      description={
        pendingLeave
          ? t("unsavedDialog.leaveDescription")
          : t("unsavedDialog.closeDescription")
      }
      confirmLabel={
        pendingLeave
          ? t("unsavedDialog.leaveConfirm")
          : t("unsavedDialog.closeConfirm")
      }
      cancelLabel={
        pendingLeave ? t("unsavedDialog.continueEditing") : resolvedCancelLabel
      }
      variant="destructive"
      onReturnFocus={onReturnFocus}
      contentClassName={confirmClassName}
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
