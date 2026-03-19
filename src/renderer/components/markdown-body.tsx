import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Render GitHub-flavored markdown (PR body, comments).
 *
 * - GFM tables, strikethrough, task lists
 * - #123 issue/PR references become clickable links
 * - @username mentions become clickable links
 * - External links open in browser
 */

interface MarkdownBodyProps {
  content: string;
  /** GitHub "owner/repo" for resolving #123 references */
  repo?: string;
  className?: string;
}

/**
 * Pre-process markdown to turn #123 and @username into links.
 * Skips content inside code fences and inline code.
 */
function linkifyReferences(md: string, repo?: string): string {
  // Split on code fences and inline code to avoid mangling them
  const parts = md.split(/(```[\s\S]*?```|`[^`]+`)/g);
  for (let i = 0; i < parts.length; i += 2) {
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
  }
  return parts.join("");
}

export function MarkdownBody({ content, repo, className = "" }: MarkdownBodyProps) {
  if (!content.trim()) {
    return <p className="text-text-ghost text-xs italic">No description provided.</p>;
  }

  const processed = linkifyReferences(content, repo);

  return (
    <div className={`prose-dispatch ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {processed}
      </Markdown>
    </div>
  );
}
