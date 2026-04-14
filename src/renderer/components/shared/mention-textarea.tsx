import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
/* eslint-disable @typescript-eslint/no-non-null-assertion, unicorn/no-lonely-if -- The mention matcher relies on locally guarded regex captures and an intentionally nested key handling branch. */
import { useQuery } from "@tanstack/react-query";
import { GitPullRequest, Loader2, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Textarea with @ mention and # issue/PR autocomplete.
 *
 * Triggers:
 * - `@` → shows user suggestions (PR contributors + repo contributors)
 * - `#` → shows issue/PR suggestions
 *
 * Inserts the selected value at cursor position.
 */

interface MentionTextareaProps {
  ariaLabel?: string;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  /** Override the default textarea classes entirely. When provided, replaces the built-in styling. */
  textareaClassName?: string;
  prNumber?: number;
  autoFocus?: boolean;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
}

type SuggestionKind = "user" | "issue";

interface Suggestion {
  kind: SuggestionKind;
  label: string;
  detail?: string;
  insertText: string;
  login?: string;
  state?: string;
  isPr?: boolean;
}

const DEFAULT_TEXTAREA_CLASS =
  "border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-full resize-none rounded-md border px-3 py-2.5 text-xs leading-relaxed focus:outline-none";

export function MentionTextarea({
  ariaLabel,
  autoComplete = "off",
  value,
  onChange,
  name,
  placeholder,
  rows = 3,
  className = "",
  textareaClassName,
  prNumber,
  autoFocus,
  textareaRef: forwardedTextareaRef,
  onKeyDown: externalOnKeyDown,
  onBlur: externalOnBlur,
  onFocus: externalOnFocus,
  onClick: externalOnClick,
  onSelect: externalOnSelect,
}: MentionTextareaProps) {
  const { repoTarget, nwo } = useWorkspace();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<{
    kind: SuggestionKind;
    startPos: number;
    query: string;
  } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch contributors for @ mentions
  const contributorsQuery = useQuery({
    queryKey: ["pr", "contributors", nwo, prNumber],
    queryFn: () => ipc("pr.contributors", { ...repoTarget, prNumber: prNumber ?? 0 }),
    enabled: Boolean(prNumber),
    staleTime: 120_000,
  });

  // Fetch issues/PRs for # autocomplete
  const issuesQuery = useQuery({
    queryKey: ["pr", "issuesList", nwo],
    queryFn: () => ipc("pr.issuesList", { ...repoTarget }),
    staleTime: 120_000,
  });

  const contributors = contributorsQuery.data ?? [];
  const issues = issuesQuery.data ?? [];

  // Debounced search query for GitHub user search
  const [debouncedUserQuery, setDebouncedUserQuery] = useState("");
  useEffect(() => {
    if (trigger?.kind !== "user" || trigger.query.length < 2) {
      setDebouncedUserQuery("");
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedUserQuery(trigger.query);
    }, 300);
    return () => clearTimeout(timer);
  }, [trigger?.kind, trigger?.query]);

  // GitHub user search (fires when local results are sparse)
  const userSearchQuery = useQuery({
    queryKey: ["pr", "searchUsers", nwo, debouncedUserQuery],
    queryFn: () => ipc("pr.searchUsers", { ...repoTarget, query: debouncedUserQuery }),
    enabled: debouncedUserQuery.length >= 2,
    staleTime: 60_000,
  });
  const searchedUsers = userSearchQuery.data ?? [];

  // Build suggestions based on trigger
  const suggestions = useMemo(() => {
    if (!trigger) {
      return [];
    }
    const q = trigger.query.toLowerCase();

    if (trigger.kind === "user") {
      // Local results first (contributors, PR participants)
      const localResults = contributors
        .filter((login) => login.toLowerCase().includes(q))
        .map(
          (login): Suggestion => ({
            kind: "user",
            label: login,
            insertText: `@${login} `,
            login,
          }),
        );

      // Merge in GitHub search results (dedupe)
      const seen = new Set(localResults.map((s) => s.label.toLowerCase()));
      const remoteResults = searchedUsers
        .filter((u) => !seen.has(u.login.toLowerCase()))
        .map(
          (u): Suggestion => ({
            kind: "user",
            label: u.login,
            detail: u.name ?? undefined,
            insertText: `@${u.login} `,
            login: u.login,
          }),
        );

      return [...localResults, ...remoteResults].slice(0, 10);
    }

    // # trigger — issues and PRs
    return issues
      .filter((item) => String(item.number).includes(q) || item.title.toLowerCase().includes(q))
      .slice(0, 8)
      .map(
        (item): Suggestion => ({
          kind: "issue",
          label: `#${item.number}`,
          detail: item.title,
          insertText: `#${item.number} `,
          state: item.state,
          isPr: item.isPr,
        }),
      );
  }, [trigger, contributors, issues, searchedUsers]);

  // Clamp the selected index to remain within bounds when async results arrive
  // (e.g. GitHub user search resolves and the list shrinks).
  const safeSelectedIndex =
    suggestions.length > 0 ? Math.min(selectedIndex, suggestions.length - 1) : 0;

  // Detect trigger characters while typing
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      const cursorPos = e.target.selectionStart;
      const textBefore = newValue.slice(0, cursorPos);

      // Find the last @ or # that isn't preceded by a word char
      const atMatch = textBefore.match(/(?:^|[^a-zA-Z0-9])@([a-zA-Z0-9-]*)$/);
      const hashMatch = textBefore.match(/(?:^|[^a-zA-Z0-9])#([a-zA-Z0-9-]*)$/);

      if (atMatch) {
        const startPos = cursorPos - atMatch[1]!.length - 1;
        setTrigger({ kind: "user", startPos, query: atMatch[1]! });
        setSelectedIndex(0);
      } else if (hashMatch) {
        const startPos = cursorPos - hashMatch[1]!.length - 1;
        setTrigger({ kind: "issue", startPos, query: hashMatch[1]! });
        setSelectedIndex(0);
      } else {
        setTrigger(null);
      }
    },
    [onChange],
  );

  // Insert suggestion
  const insertSuggestion = useCallback(
    (suggestion: Suggestion) => {
      if (!trigger || !textareaRef.current) {
        return;
      }
      const before = value.slice(0, trigger.startPos);
      const cursorPos = textareaRef.current.selectionStart;
      const after = value.slice(cursorPos);
      const newValue = before + suggestion.insertText + after;
      onChange(newValue);
      setTrigger(null);

      // Restore focus + cursor position after insert
      requestAnimationFrame(() => {
        const pos = before.length + suggestion.insertText.length;
        textareaRef.current?.setSelectionRange(pos, pos);
        textareaRef.current?.focus();
      });
    },
    [trigger, value, onChange],
  );

  // Keyboard navigation in dropdown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (trigger && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          // Only intercept Enter if autocomplete is open
          if (suggestions[safeSelectedIndex]) {
            e.preventDefault();
            insertSuggestion(suggestions[safeSelectedIndex]!);
            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setTrigger(null);
          return;
        }
      }

      // Pass through to external handler
      externalOnKeyDown?.(e);
    },
    [trigger, suggestions, safeSelectedIndex, insertSuggestion, externalOnKeyDown],
  );

  const showDropdown = trigger !== null && (suggestions.length > 0 || userSearchQuery.isFetching);
  const isSearching = trigger?.kind === "user" && userSearchQuery.isFetching;

  return (
    <div className={`relative ${className}`}>
      <textarea
        aria-label={ariaLabel}
        autoComplete={autoComplete}
        ref={(node) => {
          textareaRef.current = node;
          assignTextareaRef(forwardedTextareaRef, node);
        }}
        name={name}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          // Delay to allow click on dropdown
          setTimeout(() => setTrigger(null), 200);
          externalOnBlur?.(event);
        }}
        onFocus={externalOnFocus}
        onClick={externalOnClick}
        onSelect={externalOnSelect}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className={textareaClassName ?? DEFAULT_TEXTAREA_CLASS}
      />

      {/* Autocomplete dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="border-border bg-bg-elevated absolute bottom-full left-0 z-30 mb-1 max-h-48 w-64 overflow-y-auto rounded-md border p-1 shadow-lg"
        >
          {suggestions.map((suggestion, i) => (
            <button
              key={suggestion.insertText}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertSuggestion(suggestion);
              }}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                i === safeSelectedIndex
                  ? "bg-accent-muted text-accent-text"
                  : "text-text-secondary hover:bg-bg-raised"
              }`}
            >
              {suggestion.kind === "user" ? (
                <>
                  <GitHubAvatar
                    login={suggestion.login ?? ""}
                    size={16}
                  />
                  <span className="text-text-primary font-medium">{suggestion.label}</span>
                  {suggestion.detail && (
                    <span className="text-text-tertiary truncate text-[10px]">
                      {suggestion.detail}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {suggestion.isPr ? (
                    <GitPullRequest
                      size={13}
                      className="text-text-tertiary shrink-0"
                    />
                  ) : (
                    <MessageCircle
                      size={13}
                      className="text-text-tertiary shrink-0"
                    />
                  )}
                  <span className="text-text-primary shrink-0 font-mono font-medium">
                    {suggestion.label}
                  </span>
                  <span className="text-text-tertiary min-w-0 flex-1 truncate">
                    {suggestion.detail}
                  </span>
                  {suggestion.state && (
                    <span
                      className={`shrink-0 text-[9px] ${
                        suggestion.state === "OPEN"
                          ? "text-success"
                          : suggestion.state === "MERGED"
                            ? "text-info"
                            : "text-text-ghost"
                      }`}
                    >
                      {suggestion.state.toLowerCase()}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
          {isSearching && (
            <div className="text-text-ghost flex items-center gap-2 px-2 py-1.5 text-[10px]">
              <Loader2
                size={11}
                className="animate-spin"
              />
              Searching GitHub...
            </div>
          )}
          {trigger?.kind === "user" &&
            suggestions.length === 0 &&
            !isSearching &&
            trigger.query.length >= 2 && (
              <div className="text-text-ghost px-2 py-1.5 text-[10px]">No users found</div>
            )}
        </div>
      )}
    </div>
  );
}

function assignTextareaRef(
  ref: React.Ref<HTMLTextAreaElement> | undefined,
  node: HTMLTextAreaElement | null,
): void {
  if (!ref) {
    return;
  }

  if (typeof ref === "function") {
    ref(node);
    return;
  }

  (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
}
