import { bench, describe } from "vitest";

import { parseDiff } from "./diff-parser";

function generateDiff(lineCount: number): string {
  let diff = "diff --git a/big-file.ts b/big-file.ts\n--- a/big-file.ts\n+++ b/big-file.ts\n";
  diff += `@@ -1,${lineCount} +1,${lineCount} @@\n`;
  for (let i = 0; i < lineCount; i++) {
    if (i % 5 === 0) {
      diff += `+const added_${i} = true;\n`;
    } else if (i % 7 === 0) {
      diff += `-const removed_${i} = false;\n`;
    } else {
      diff += ` const context_${i} = null;\n`;
    }
  }
  return diff;
}

describe("diff parser performance", () => {
  bench("parse 1,000 lines", () => {
    parseDiff(generateDiff(1000));
  });
  bench("parse 10,000 lines", () => {
    parseDiff(generateDiff(10000));
  });
  bench("parse 50,000 lines", () => {
    parseDiff(generateDiff(50000));
  });
});
