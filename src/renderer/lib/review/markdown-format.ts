export interface TextSelectionRange {
  end: number;
  start: number;
}

export type MarkdownFormatAction =
  | "blockquote"
  | "bold"
  | "bullet-list"
  | "code-block"
  | "inline-code"
  | "italic"
  | "link"
  | "numbered-list"
  | "task-list";

interface FormatResult {
  selection: TextSelectionRange;
  value: string;
}

interface WrapOptions {
  placeholder: string;
  prefix: string;
  suffix: string;
}

interface LinePrefixOptions {
  getPrefix: (lineIndex: number) => string;
  placeholder: string;
}

function clampSelection(value: string, selection: TextSelectionRange): TextSelectionRange {
  const max = value.length;
  const start = Math.max(0, Math.min(selection.start, max));
  const end = Math.max(0, Math.min(selection.end, max));

  return start <= end ? { start, end } : { start: end, end: start };
}

function wrapSelection(
  value: string,
  selection: TextSelectionRange,
  options: WrapOptions,
): FormatResult {
  const normalized = clampSelection(value, selection);
  const before = value.slice(0, normalized.start);
  const selected = value.slice(normalized.start, normalized.end);
  const after = value.slice(normalized.end);
  const { prefix, suffix, placeholder } = options;

  if (selected.length > 0) {
    const wrapped = `${prefix}${selected}${suffix}`;
    const selectionStart = before.length + prefix.length;
    return {
      value: `${before}${wrapped}${after}`,
      selection: {
        start: selectionStart,
        end: selectionStart + selected.length,
      },
    };
  }

  const wrapped = `${prefix}${placeholder}${suffix}`;
  const placeholderStart = before.length + prefix.length;
  return {
    value: `${before}${wrapped}${after}`,
    selection: {
      start: placeholderStart,
      end: placeholderStart + placeholder.length,
    },
  };
}

function findLineStart(value: string, index: number): number {
  const lineBreak = value.lastIndexOf("\n", Math.max(0, index - 1));
  return lineBreak === -1 ? 0 : lineBreak + 1;
}

function findLineEnd(value: string, index: number): number {
  const lineBreak = value.indexOf("\n", index);
  return lineBreak === -1 ? value.length : lineBreak;
}

function prefixSelectedLines(
  value: string,
  selection: TextSelectionRange,
  options: LinePrefixOptions,
): FormatResult {
  const normalized = clampSelection(value, selection);
  const hasSelection = normalized.start !== normalized.end;
  const selectionEnd =
    hasSelection && value[normalized.end - 1] === "\n" ? normalized.end - 1 : normalized.end;
  const blockStart = findLineStart(value, normalized.start);
  const blockEnd = findLineEnd(value, selectionEnd);
  const before = value.slice(0, blockStart);
  const segment = value.slice(blockStart, blockEnd);
  const after = value.slice(blockEnd);
  const { getPrefix, placeholder } = options;

  if (!hasSelection) {
    const lineText = segment;
    if (lineText.length === 0) {
      const prefix = getPrefix(0);
      const inserted = `${prefix}${placeholder}`;
      const selectionStart = before.length + prefix.length;
      return {
        value: `${before}${inserted}${after}`,
        selection: {
          start: selectionStart,
          end: selectionStart + placeholder.length,
        },
      };
    }

    const prefix = getPrefix(0);
    return {
      value: `${before}${prefix}${lineText}${after}`,
      selection: {
        start: normalized.start + prefix.length,
        end: normalized.end + prefix.length,
      },
    };
  }

  const prefixed = segment
    .split("\n")
    .map((line, lineIndex) => `${getPrefix(lineIndex)}${line}`)
    .join("\n");

  return {
    value: `${before}${prefixed}${after}`,
    selection: {
      start: blockStart,
      end: blockStart + prefixed.length,
    },
  };
}

function insertMarkdownLink(value: string, selection: TextSelectionRange): FormatResult {
  const normalized = clampSelection(value, selection);
  const before = value.slice(0, normalized.start);
  const selected = value.slice(normalized.start, normalized.end);
  const after = value.slice(normalized.end);
  const label = selected || "link text";
  const url = "https://";
  const link = `[${label}](${url})`;

  if (selected.length > 0) {
    const urlStart = before.length + label.length + 3;
    return {
      value: `${before}${link}${after}`,
      selection: {
        start: urlStart,
        end: urlStart + url.length,
      },
    };
  }

  return {
    value: `${before}${link}${after}`,
    selection: {
      start: before.length + 1,
      end: before.length + 1 + label.length,
    },
  };
}

export function applyMarkdownFormat(
  value: string,
  selection: TextSelectionRange,
  action: MarkdownFormatAction,
): FormatResult {
  switch (action) {
    case "bold": {
      return wrapSelection(value, selection, {
        prefix: "**",
        suffix: "**",
        placeholder: "bold text",
      });
    }
    case "italic": {
      return wrapSelection(value, selection, {
        prefix: "_",
        suffix: "_",
        placeholder: "emphasis",
      });
    }
    case "inline-code": {
      return wrapSelection(value, selection, {
        prefix: "`",
        suffix: "`",
        placeholder: "code",
      });
    }
    case "code-block": {
      return wrapSelection(value, selection, {
        prefix: "```\n",
        suffix: "\n```",
        placeholder: "code",
      });
    }
    case "link": {
      return insertMarkdownLink(value, selection);
    }
    case "blockquote": {
      return prefixSelectedLines(value, selection, {
        getPrefix: () => "> ",
        placeholder: "Quoted note",
      });
    }
    case "bullet-list": {
      return prefixSelectedLines(value, selection, {
        getPrefix: () => "- ",
        placeholder: "List item",
      });
    }
    case "numbered-list": {
      return prefixSelectedLines(value, selection, {
        getPrefix: (lineIndex) => `${lineIndex + 1}. `,
        placeholder: "List item",
      });
    }
    case "task-list": {
      return prefixSelectedLines(value, selection, {
        getPrefix: () => "- [ ] ",
        placeholder: "Task",
      });
    }
  }
}
