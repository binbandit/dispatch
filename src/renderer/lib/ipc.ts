import type { IpcApi, IpcMethod } from "../../shared/ipc";

/**
 * Typed IPC client for the renderer process.
 *
 * Calls main process handlers via window.api.invoke().
 * Fully type-safe: method name → args type → result type.
 */

type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export async function ipc<M extends IpcMethod>(
  method: M,
  ...args: IpcApi[M]["args"] extends void ? [] : [IpcApi[M]["args"]]
): Promise<IpcApi[M]["result"]> {
  const payload = args.length > 0 ? args[0] : undefined;
  const response = (await window.api.invoke(method, payload)) as IpcResponse<IpcApi[M]["result"]>;

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data;
}
