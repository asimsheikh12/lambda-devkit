export type BatchItemFailure = { itemIdentifier: string };

export function isBatchItemFailures(
  value: unknown,
): value is { batchItemFailures: BatchItemFailure[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { batchItemFailures?: unknown }).batchItemFailures)
  );
}

export function countBatchItemFailures(result: unknown): number {
  if (!isBatchItemFailures(result)) {
    return 0;
  }

  return result.batchItemFailures.length;
}
