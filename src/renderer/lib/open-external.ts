export async function openExternal(url: string): Promise<void> {
  await globalThis.api.openExternal(url);
}
