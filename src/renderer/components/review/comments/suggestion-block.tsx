import { toastManager } from "@/components/ui/toast";
import { useSyntaxHighlighter } from "@/renderer/hooks/review/use-syntax-highlight";
import { useTheme } from "@/renderer/lib/app/theme-context";
import {
  ensureHighlighterResources,
  getShikiTokenColor,
  isLanguageLoaded,
  normalizeLanguage,
  type ShikiToken,
} from "@/renderer/lib/review/highlighter";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface BodyPart {
  type: "text" | "suggestion";
  content: string;
}

export function parseSuggestions(body: string): { bodyParts: BodyPart[]; suggestions: string[] } {
  const regex = /```suggestion\n([\s\S]*?)```/g;
  const parts: BodyPart[] = [];
  const suggestions: string[] = [];
  let lastIndex = 0;

  let match = regex.exec(body);
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: body.slice(lastIndex, match.index) });
    }
    const suggestion = match[1] ?? "";
    parts.push({ type: "suggestion", content: suggestion });
    suggestions.push(suggestion);
    lastIndex = match.index + match[0].length;
    match = regex.exec(body);
  }

  if (lastIndex < body.length) {
    parts.push({ type: "text", content: body.slice(lastIndex) });
  }

  return { bodyParts: parts, suggestions };
}

export function SuggestionBlock({
  suggestion,
  language,
}: {
  suggestion: string;
  language: string;
}) {
  const highlighter = useSyntaxHighlighter();
  const { codeThemeDark, codeThemeLight, resolvedTheme } = useTheme();
  const shikiTheme = useMemo(
    () => ({
      light: codeThemeLight,
      dark: codeThemeDark,
    }),
    [codeThemeDark, codeThemeLight],
  );
  const lines = suggestion.split("\n");
  const normalizedLanguage = normalizeLanguage(language);
  const [, setSyntaxResourceVersion] = useState(0);

  useEffect(() => {
    if (!highlighter) {
      return;
    }

    let cancelled = false;
    void ensureHighlighterResources({
      languages: normalizedLanguage === "text" ? [] : [normalizedLanguage],
      themes: [shikiTheme.dark, shikiTheme.light],
    }).then((loadedResources) => {
      if (!cancelled && loadedResources) {
        setSyntaxResourceVersion((version) => version + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [highlighter, normalizedLanguage, shikiTheme.dark, shikiTheme.light]);

  // Tokenize lines for syntax highlighting.
  // Strip +/- prefixes, join into full code block for context-aware highlighting,
  // Then map per-line tokens back.
  const tokensByLine = useMemo(() => {
    if (!highlighter || normalizedLanguage === "text") {
      return null;
    }
    try {
      if (!isLanguageLoaded(highlighter, normalizedLanguage)) {
        return null;
      }
      const strippedLines = lines.map((l) =>
        l.startsWith("+") || l.startsWith("-") ? l.slice(1) : l,
      );
      const result = highlighter.codeToTokens(strippedLines.join("\n"), {
        lang: normalizedLanguage as Parameters<typeof highlighter.codeToTokens>[1]["lang"],
        themes: {
          light: shikiTheme.light,
          dark: shikiTheme.dark,
        },
      } as unknown as Parameters<typeof highlighter.codeToTokens>[1]);
      return result.tokens.map((lineTokens) => lineTokens.map((token) => token as ShikiToken));
    } catch {
      return null;
    }
  }, [highlighter, lines, normalizedLanguage, shikiTheme]);

  return (
    <div className="border-success/15 bg-success-muted/60 my-2 overflow-hidden rounded-md border">
      <div className="flex items-center gap-[5px] px-2 py-1.5 text-[10px] font-semibold text-[var(--success)]">
        <Check size={11} />
        Suggested fix
        <button
          type="button"
          className="ml-auto cursor-pointer rounded-[4px] bg-[var(--success)] px-2.5 py-1 text-[10px] font-semibold text-[var(--bg-root)] transition-shadow hover:shadow-[0_0_10px_rgba(61,214,140,0.22)]"
          onClick={() => {
            void navigator.clipboard.writeText(suggestion);
            toastManager.add({ title: "Suggestion copied", type: "success" });
          }}
        >
          Copy fix
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "4px 10px 6px",
          background: "transparent",
          border: "none",
          borderTop: "1px solid color-mix(in srgb, var(--success) 10%, transparent)",
          borderRadius: 0,
          overflow: "auto",
        }}
      >
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            lineHeight: "18px",
            padding: 0,
            background: "none",
            border: "none",
          }}
        >
          {lines.map((line, i) => {
            const lineTokens = tokensByLine?.[i];
            const content = lineTokens
              ? lineTokens.map((token, ti) => (
                  <span
                    key={ti}
                    style={{ color: getShikiTokenColor(token, resolvedTheme) }}
                  >
                    {token.content}
                  </span>
                ))
              : line.startsWith("+") || line.startsWith("-")
                ? line.slice(1)
                : line;

            if (line.startsWith("-")) {
              return (
                <div
                  key={i}
                  style={{
                    textDecoration: "line-through",
                    opacity: 0.7,
                    background: "var(--diff-del-bg)",
                  }}
                >
                  {content}
                </div>
              );
            }
            if (line.startsWith("+")) {
              return (
                <div
                  key={i}
                  style={{ background: "var(--diff-add-bg)" }}
                >
                  {content}
                </div>
              );
            }
            return <div key={i}>{content}</div>;
          })}
        </code>
      </pre>
    </div>
  );
}
