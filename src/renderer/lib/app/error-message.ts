/** Safely extract a human-readable message from an unknown error value. */
export function getErrorMessage(err?: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
