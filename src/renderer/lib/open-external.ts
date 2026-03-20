export async function openExternal(url: string): Promise<void> {
  await window.api.openExternal(url);
}
