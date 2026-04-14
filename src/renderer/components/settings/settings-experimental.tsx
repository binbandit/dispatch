import { Switch } from "@/components/ui/switch";
import {
  EXPERIMENTAL_FEATURES,
  isExperimentalFeatureEnabled,
} from "@/shared/experimental-features";
import { FlaskConical, TriangleAlert } from "lucide-react";

interface ExperimentalSettingsSectionProps {
  prefs: Record<string, string | null | undefined>;
  savePref: (key: string, value: string) => void;
}

export function ExperimentalSettingsSection({ prefs, savePref }: ExperimentalSettingsSectionProps) {
  return (
    <>
      <h2 className="text-text-primary text-base font-semibold">Experimental</h2>
      <p className="text-text-tertiary mt-0.5 text-xs">
        Try features we are still shaping. They may change substantially or disappear between
        releases.
      </p>

      <section className="border-border mt-6 overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_top_left,rgba(212,136,58,0.06),transparent_48%)] shadow-sm">
        <div className="border-border-subtle flex items-start gap-3 border-b px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[--accent-muted] text-[--accent-text]">
            <FlaskConical size={14} />
          </div>
          <div>
            <p className="text-text-primary text-xs font-medium">Built for fast iteration</p>
            <p className="text-text-secondary mt-1 text-xs leading-5">
              Experimental features help us test new ideas in the open. If you turn one on, expect
              rough edges, renamed controls, or behavior that moves back behind a flag.
            </p>
          </div>
        </div>

        <div className="divide-y divide-[--border-subtle]">
          {EXPERIMENTAL_FEATURES.map((feature) => (
            <label
              key={feature.key}
              className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-text-secondary text-xs">{feature.label}</span>
                  <span className="border border-[--border-accent] bg-[--accent-muted] px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.08em] text-[--accent-text] uppercase">
                    Preview
                  </span>
                </div>
                <p className="text-text-ghost mt-1 text-[10px] leading-4">{feature.description}</p>
              </div>
              <Switch
                checked={isExperimentalFeatureEnabled(prefs[feature.key])}
                onCheckedChange={(checked) => savePref(feature.key, checked ? "true" : "false")}
                aria-label={`Toggle ${feature.label}`}
              />
            </label>
          ))}
        </div>

        <div className="border-border-subtle flex items-start gap-2 border-t bg-[--bg-surface]/60 px-4 py-3">
          <TriangleAlert
            size={12}
            className="mt-0.5 shrink-0 text-[--warning]"
          />
          <p className="text-text-ghost text-[10px] leading-4">
            These settings are intentionally temporary. If an experiment works well, it may graduate
            into the product with different defaults or controls.
          </p>
        </div>
      </section>
    </>
  );
}
