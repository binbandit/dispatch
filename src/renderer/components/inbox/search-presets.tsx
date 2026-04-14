import type { PrSearchPreset } from "@/renderer/lib/inbox/pr-search-presets";

interface SearchPresetChipsProps {
  activeQuery: string;
  onSelect: (preset: PrSearchPreset) => void;
  presets: PrSearchPreset[];
}

export function SearchPresetChips({ activeQuery, onSelect, presets }: SearchPresetChipsProps) {
  const normalizedActiveQuery = activeQuery.trim().toLowerCase();

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {presets.map((preset) => {
        const isActive = normalizedActiveQuery === preset.query.toLowerCase();

        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset)}
            className={`inline-flex cursor-pointer items-center rounded-sm border px-2 py-1 text-[10px] font-medium transition-colors ${
              isActive
                ? "bg-accent-muted text-accent-text border-[var(--border-accent)]"
                : "border-border bg-bg-raised text-text-secondary hover:border-border-strong hover:bg-bg-elevated hover:text-text-primary"
            }`}
            title={preset.hint}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
