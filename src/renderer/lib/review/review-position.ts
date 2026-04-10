export type ReviewPositionSide = "LEFT" | "RIGHT";

export function getReviewPositionKey(path: string, line: number, side: ReviewPositionSide): string {
  return `${path}:${side}:${line}`;
}
