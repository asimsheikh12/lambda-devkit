export function serializePayload(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data ?? {});
}
