export function resolveVisibilityExtensionSeconds(
  fnTimeoutSeconds: number,
  queueVisibilitySeconds = 30,
): number {
  const target = Math.max(fnTimeoutSeconds + 30, queueVisibilitySeconds);
  return Math.min(Math.max(target, 30), 43200);
}

export type VisibilityHeartbeat = {
  start(receiptHandles: string[]): Promise<void>;
  stop(): void;
};

export function createVisibilityHeartbeat(options: {
  visibilitySeconds: number;
  extendVisibility: (receiptHandles: string[], visibilitySeconds: number) => Promise<void>;
}): VisibilityHeartbeat {
  let timer: ReturnType<typeof setInterval> | undefined;
  let handles: string[] = [];

  return {
    async start(receiptHandles: string[]) {
      handles = receiptHandles.filter((handle): handle is string => !!handle);
      if (handles.length === 0) {
        return;
      }

      await options.extendVisibility(handles, options.visibilitySeconds);

      const intervalMs = Math.max(
        5000,
        Math.floor((options.visibilitySeconds / 2) * 1000),
      );

      timer = setInterval(() => {
        void options.extendVisibility(handles, options.visibilitySeconds);
      }, intervalMs);
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      handles = [];
    },
  };
}
