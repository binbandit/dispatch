import type { ComponentPropsWithoutRef } from "react";

/* eslint-disable no-continue, no-inline-comments, @typescript-eslint/no-non-null-assertion -- Markdown AST traversal is clearer as a guarded walk than forcing alternative forms. */
import { useSyntaxHighlighter } from "@/renderer/hooks/review/use-syntax-highlight";
import { openExternal } from "@/renderer/lib/app/open-external";
import { useTheme } from "@/renderer/lib/app/theme-context";
import {
  getShikiTokenColor,
  type ShikiToken,
  type ThemeMode,
} from "@/renderer/lib/review/highlighter";
import { AlertCircle, Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import { Children, isValidElement, useMemo } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";

/**
 * Render GitHub-flavored markdown (PR body, comments).
 *
 * Matches GitHub's rendering:
 * - GFM tables, strikethrough, task lists, autolinks
 * - HTML elements (sub, sup, ins, details, summary, br, kbd, picture)
 * - Emoji shortcodes (:+1:, :rocket:, etc.)
 * - GitHub alerts (> [!NOTE], > [!WARNING], etc.)
 * - #123 issue/PR references → clickable links
 * - @username mentions → clickable links
 * - External links open in browser
 */

interface MarkdownBodyProps {
  content: string;
  /** GitHub "owner/repo" for resolving #123 references */
  repo?: string;
  className?: string;
}

type SyntaxHighlighter = NonNullable<ReturnType<typeof useSyntaxHighlighter>>;

/**
 * Pre-process markdown:
 * - Turn #123 into links (skip inside code)
 * - Turn @username into links (skip inside code)
 * - Convert GitHub alert syntax to styled HTML
 */
function preprocess(md: string, repo?: string): string {
  // Split on code fences and inline code to avoid mangling them
  const parts = md.split(/(```[\s\S]*?```|`[^`]+`)/g);
  for (let i = 0; i < parts.length; i += 2) {
    if (!parts[i]) {
      continue;
    }
    // #123 → link to issue/PR
    if (repo) {
      parts[i] = parts[i]!.replaceAll(
        /(^|[^&\w])#(\d+)\b/g,
        (_m, prefix: string, num: string) =>
          `${prefix}[#${num}](https://github.com/${repo}/issues/${num})`,
      );
    }
    // @username → link to profile
    parts[i] = parts[i]!.replaceAll(
      /(^|[^/\w[\]])@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)\b/g,
      (_m, prefix: string, username: string) =>
        `${prefix}[@${username}](https://github.com/${username})`,
    );
    // GitHub alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
    parts[i] = parts[i]!.replaceAll(
      /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:>.*\n?)*)/gm,
      (_m, type: string, body: string) => {
        const alertType = type.toLowerCase();
        const cleanBody = body.replaceAll(/^> ?/gm, "").trim();
        return [
          `<div class="gh-alert gh-alert-${alertType}">`,
          `<p class="gh-alert-title gh-alert-title-${alertType}">${type}</p>`,
          "",
          cleanBody,
          "",
          "</div>",
          "",
        ].join("\n");
      },
    );
  }
  return parts.join("");
}

/**
 * Syntax-highlight a fenced code block using Shiki.
 * Returns an array of <span> elements with token colors, or null on failure.
 */
function highlightCode(args: {
  highlighter: SyntaxHighlighter;
  code: string;
  lang: string;
  shikiTheme: { light: string; dark: string };
  resolvedTheme: ThemeMode;
}): React.ReactNode[] | null {
  try {
    if (!args.highlighter.getLoadedLanguages().includes(args.lang)) {
      return null;
    }
    const result = args.highlighter.codeToTokens(args.code, {
      lang: args.lang as Parameters<SyntaxHighlighter["codeToTokens"]>[1]["lang"],
      themes: {
        light: args.shikiTheme.light,
        dark: args.shikiTheme.dark,
      },
    } as unknown as Parameters<SyntaxHighlighter["codeToTokens"]>[1]);
    return result.tokens.flatMap((line, li) => {
      const spans = line.map((token, ti) => (
        <span
          key={`${li}-${ti}`}
          style={{ color: getShikiTokenColor(token as ShikiToken, args.resolvedTheme) }}
        >
          {token.content}
        </span>
      ));
      // Add newline between lines (not after last)
      if (li < result.tokens.length - 1) {
        spans.push(<span key={`${li}-nl`}>{"\n"}</span>);
      }
      return spans;
    });
  } catch {
    return null;
  }
}

export function MarkdownBody({ content, repo, className = "" }: MarkdownBodyProps) {
  const highlighter = useSyntaxHighlighter();
  const { codeThemeDark, codeThemeLight, resolvedTheme } = useTheme();
  const shikiTheme = useMemo(
    () => ({
      light: codeThemeLight,
      dark: codeThemeDark,
    }),
    [codeThemeDark, codeThemeLight],
  );

  if (!content.trim()) {
    return <p className="text-text-ghost text-xs italic">No description provided.</p>;
  }

  const processed = preprocess(content, repo);

  return (
    <div className={`prose-dispatch ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkGemoji]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // Images: no-referrer to avoid leaking origin, lazy load
          img({ src, alt, ...rest }) {
            const imgProps = {
              ...(rest as ComponentPropsWithoutRef<"img"> & {
                node?: unknown;
                sourcePos?: unknown;
              }),
            };
            delete imgProps.node;
            delete imgProps.sourcePos;

            return (
              <img
                src={src}
                alt={alt ?? ""}
                referrerPolicy="no-referrer"
                loading="lazy"
                {...imgProps}
              />
            );
          },
          // Videos: native controls, no-referrer, contained sizing
          video({ src, children, ...rest }) {
            return (
              // eslint-disable-next-line react/no-unknown-property -- referrerPolicy is valid HTML but missing from React's VideoHTMLAttributes
              <video
                src={src}
                controls
                preload="metadata"
                // @ts-expect-error -- referrerPolicy is valid on <video> but not in React's type defs
                referrerPolicy="no-referrer"
                {...rest}
              >
                {children}
              </video>
            );
          },
          // Open external links in browser
          a({ href, children, ...rest }) {
            return (
              <a
                href={href}
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (!href) {
                    return;
                  }

                  event.preventDefault();
                  void openExternal(href);
                }}
                {...rest}
              >
                {children}
              </a>
            );
          },
          // Syntax-highlight fenced code blocks
          code({ className: codeClass, children, ...rest }) {
            // Fenced blocks get className="language-xxx" from react-markdown
            const langMatch =
              typeof codeClass === "string" ? codeClass.match(/language-(\w+)/) : null;
            if (langMatch && highlighter) {
              const code = String(children).replace(/\n$/, "");
              const tokens = highlightCode({
                highlighter,
                code,
                lang: langMatch[1]!,
                shikiTheme,
                resolvedTheme,
              });
              if (tokens) {
                return (
                  <code
                    className={codeClass}
                    {...rest}
                  >
                    {tokens}
                  </code>
                );
              }
            }
            return (
              <code
                className={codeClass}
                {...rest}
              >
                {children}
              </code>
            );
          },
          // Render GitHub alert divs with icons
          div({ className: divClass, children, ...rest }) {
            if (typeof divClass === "string" && divClass.startsWith("gh-alert gh-alert-")) {
              const alertType = divClass.replace("gh-alert gh-alert-", "");
              const config = ALERT_CONFIG[alertType] ?? ALERT_CONFIG.note!;
              const childNodes = Children.toArray(children);
              const titleIndex = childNodes.findIndex(
                (child) =>
                  isValidElement<{ className?: string }>(child) &&
                  typeof child.props.className === "string" &&
                  child.props.className.includes("gh-alert-title"),
              );
              const titleChild = titleIndex !== -1 ? childNodes[titleIndex] : null;
              const bodyChildren = childNodes.filter(
                (child, index) =>
                  index !== titleIndex && !(typeof child === "string" && child.trim().length === 0),
              );

              return (
                <div
                  className={`${divClass} border-border my-3 rounded-md border border-l-[3px] px-3 py-3 ${config.containerClass}`}
                  {...rest}
                >
                  {titleChild}
                  {bodyChildren.length > 0 ? (
                    <div className="gh-alert-content">{bodyChildren}</div>
                  ) : null}
                </div>
              );
            }
            return (
              <div
                className={divClass}
                {...rest}
              >
                {children}
              </div>
            );
          },
          // Style the alert title paragraph
          p({ className: pClass, children, ...rest }) {
            if (typeof pClass === "string" && pClass.includes("gh-alert-title")) {
              const alertType = pClass.match(/gh-alert-title-([a-z]+)/)?.[1] ?? "note";
              const config = ALERT_CONFIG[alertType] ?? ALERT_CONFIG.note!;
              return (
                <p
                  className={`${pClass} mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase ${config.titleClass}`}
                  {...rest}
                >
                  <config.icon size={14} />
                  {children}
                </p>
              );
            }
            return (
              <p
                className={pClass}
                {...rest}
              >
                {children}
              </p>
            );
          },
        }}
      >
        {processed}
      </Markdown>
    </div>
  );
}

const ALERT_CONFIG: Record<
  string,
  { icon: typeof Info; containerClass: string; titleClass: string }
> = {
  note: {
    icon: Info,
    containerClass: "border-l-info bg-info/5",
    titleClass: "text-info",
  },
  tip: {
    icon: Lightbulb,
    containerClass: "border-l-success bg-success/5",
    titleClass: "text-success",
  },
  important: {
    icon: AlertCircle,
    containerClass: "border-l-purple bg-purple/5",
    titleClass: "text-purple",
  },
  warning: {
    icon: TriangleAlert,
    containerClass: "border-l-warning bg-warning/5",
    titleClass: "text-warning",
  },
  caution: {
    icon: OctagonAlert,
    containerClass: "border-l-destructive bg-destructive/5",
    titleClass: "text-destructive",
  },
};
