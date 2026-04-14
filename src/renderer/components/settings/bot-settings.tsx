import {
  BOT_AUTO_COLLAPSE_PREFERENCE_KEY,
  DEFAULT_BOT_USERNAMES,
  parseJsonArray,
} from "@/renderer/hooks/preferences/use-bot-settings";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

export function BotSettings({
  prefs,
  savePref,
}: {
  prefs: Record<string, string | null>;
  savePref: (key: string, value: string) => void;
}) {
  const botTitleTags = useMemo(
    () => parseJsonArray(prefs.botTitleTags ?? null),
    [prefs.botTitleTags],
  );
  const botUsernames = useMemo(
    () => parseJsonArray(prefs.botUsernames ?? null),
    [prefs.botUsernames],
  );
  const autoCollapseBotUsernames = useMemo(
    () => parseJsonArray(prefs[BOT_AUTO_COLLAPSE_PREFERENCE_KEY] ?? null),
    [prefs[BOT_AUTO_COLLAPSE_PREFERENCE_KEY]],
  );

  return (
    <>
      <h2 className="text-text-primary text-base font-semibold">Bots</h2>
      <p className="text-text-tertiary mt-0.5 text-xs">
        Configure how automated and bot activity is detected and displayed.
      </p>

      <section className="mt-6">
        <h3 className="text-text-primary text-sm font-medium">PR Title Tags</h3>
        <p className="text-text-tertiary mt-0.5 text-xs">
          PRs with these tags in their title will be flagged as bot/automated PRs.
        </p>
        <TagInput
          tags={botTitleTags}
          onChange={(tags) => savePref("botTitleTags", JSON.stringify(tags))}
          placeholder="e.g. [bot], [auto], [dependabot]"
        />
      </section>

      <section className="mt-8">
        <h3 className="text-text-primary text-sm font-medium">Bot Usernames</h3>
        <p className="text-text-tertiary mt-0.5 text-xs">
          Comments from these users will be styled as bot comments.
        </p>
        <TagInput
          tags={botUsernames}
          onChange={(tags) => savePref("botUsernames", JSON.stringify(tags))}
          placeholder="e.g. my-org-bot, deploy-bot"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-text-ghost text-[10px]">Built-in:</span>
          {DEFAULT_BOT_USERNAMES.map((name) => (
            <span
              key={name}
              className="bg-bg-raised text-text-tertiary rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
            >
              {name}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-text-primary text-sm font-medium">Auto-Collapse Comment Bots</h3>
        <p className="text-text-tertiary mt-0.5 text-xs">
          Comments from these bots start collapsed in review threads and the conversation timeline.
        </p>
        <TagInput
          tags={autoCollapseBotUsernames}
          onChange={(tags) => savePref(BOT_AUTO_COLLAPSE_PREFERENCE_KEY, JSON.stringify(tags))}
          placeholder="e.g. coderabbit, my-org-review-bot"
        />
        <p className="text-text-ghost mt-2 text-[10px] leading-[1.5]">
          Add exact usernames for bots you want to keep out of the way by default. You can still
          expand individual comments when needed.
        </p>
      </section>
    </>
  );
}

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addTag(value: string) {
    const trimmed = value.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="border-border bg-bg-root focus-within:border-border-strong mt-2 flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
      {tags.map((tag, index) => (
        <span
          key={tag}
          className="bg-accent-muted text-accent-text border-border-accent inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px]"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => removeTag(index)}
            className="text-text-tertiary hover:text-text-primary cursor-pointer"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        aria-label="Add ignored bot"
        autoComplete="off"
        name="ignored-bot"
        spellCheck={false}
        type="text"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && input.trim()) {
            event.preventDefault();
            addTag(input);
          }
          if (event.key === "Backspace" && !input && tags.length > 0) {
            removeTag(tags.length - 1);
          }
        }}
        onBlur={() => {
          if (input.trim()) {
            addTag(input);
          }
        }}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="text-text-primary placeholder:text-text-tertiary min-w-[80px] flex-1 bg-transparent text-xs focus:outline-none"
      />
    </div>
  );
}
