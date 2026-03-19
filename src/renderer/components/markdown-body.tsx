import { AlertCircle, Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
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
      parts[i] = parts[i]!.replace(
        /(^|[^&\w])#(\d+)\b/g,
        (_m, prefix: string, num: string) =>
          `${prefix}[#${num}](https://github.com/${repo}/issues/${num})`,
      );
    }
    // @username → link to profile
    parts[i] = parts[i]!.replace(
      /(^|[^/\w[\]])@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)\b/g,
      (_m, prefix: string, username: string) =>
        `${prefix}[@${username}](https://github.com/${username})`,
    );
    // GitHub alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
    parts[i] = parts[i]!.replace(
      /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:> .*\n?)*)/gm,
      (_m, type: string, body: string) => {
        const cleanBody = body.replace(/^> ?/gm, "").trim();
        return `<div class="gh-alert gh-alert-${type.toLowerCase()}">\n<p class="gh-alert-title">${type}</p>\n\n${cleanBody}\n\n</div>\n`;
      },
    );
  }
  return parts.join("");
}

export function MarkdownBody({ content, repo, className = "" }: MarkdownBodyProps) {
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
          // Open external links in browser
          a({ href, children, ...rest }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...rest}
              >
                {children}
              </a>
            );
          },
          // Render GitHub alert divs with icons
          div({ className: divClass, children, ...rest }) {
            if (typeof divClass === "string" && divClass.startsWith("gh-alert")) {
              const alertType = divClass.replace("gh-alert gh-alert-", "");
              const config = ALERT_CONFIG[alertType] ?? ALERT_CONFIG.note!;
              return (
                <div
                  className={`my-3 rounded-md border-l-[3px] px-3 py-2 ${config.containerClass}`}
                  {...rest}
                >
                  <div
                    className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold ${config.titleClass}`}
                  >
                    <config.icon size={14} />
                    {children}
                  </div>
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
            if (typeof pClass === "string" && pClass === "gh-alert-title") {
              return null; // Title is handled by the div component above
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
