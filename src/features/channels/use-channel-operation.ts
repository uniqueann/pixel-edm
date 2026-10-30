"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChannelOperation = {
  isCurrent: () => boolean;
  finish: () => void;
};

/** 同一设置列表中的编辑与请求共用互斥锁；卸载后忽略迟到响应。 */
export function useChannelOperation() {
  const active = useRef<symbol | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = null;
    };
  }, []);

  const acquire = useCallback((): ChannelOperation | null => {
    if (!mounted.current || active.current) return null;
    const token = Symbol();
    active.current = token;
    setBusy(true);
    return {
      isCurrent: () => mounted.current && active.current === token,
      finish: () => {
        if (active.current !== token) return;
        active.current = null;
        if (mounted.current) setBusy(false);
      },
    };
  }, []);

  return { busy, acquire };
}

export type ChannelOperationGate = ReturnType<typeof useChannelOperation>;
