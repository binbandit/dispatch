import { Bell, GitPullRequest, Settings } from "lucide-react";

/**
 * Top navbar matching DISPATCH-DESIGN-SYSTEM.md § 8.1:
 *
 * - Height: 40px (42px including accent bar above)
 * - Background: --bg-surface
 * - Border: 1px solid --border on bottom
 * - -webkit-app-region: drag (Electron window dragging)
 * - Interactive elements: -webkit-app-region: no-drag
 */
export function Navbar() {
  return (
    <header
      className="flex h-10 shrink-0 items-center border-b border-border bg-bg-surface px-3"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Logo (§ 8.1 Logo) */}
      <div
        className="flex items-center gap-[7px]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Logo mark: 20x20, copper background, rounded-sm, italic "d" */}
        <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-primary">
          <span className="font-heading text-sm italic leading-none text-bg-root">d</span>
        </div>
        <span className="text-[13px] font-semibold tracking-[-0.02em] text-text-primary">
          Dispatch
        </span>
      </div>

      {/* Nav tabs */}
      <nav
        className="ml-8 flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NavTab label="Review" icon={<GitPullRequest size={14} />} active />
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right-side icon buttons (§ 8.1 Icon buttons) */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <IconButton icon={<Bell size={15} />} />
        <IconButton icon={<Settings size={15} />} />

        {/* Avatar (§ 8.1 Avatar) */}
        <div
          className="ml-2 flex h-6 w-6 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(135deg, var(--primary), #7c5a2a)",
            border: "1.5px solid var(--border-strong)",
          }}
        >
          <span className="text-[10px] font-semibold text-bg-root">D</span>
        </div>
      </div>
    </header>
  );
}

function NavTab({
  label,
  icon,
  active = false,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`relative flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs transition-colors ${
        active
          ? "font-medium text-text-primary"
          : "font-[450] text-text-secondary hover:bg-bg-raised hover:text-text-primary"
      }`}
    >
      {icon}
      {label}
      {active && (
        <div
          className="absolute bottom-[-7px] left-1/2 h-[1.5px] w-4 -translate-x-1/2 rounded-[1px] bg-primary"
        />
      )}
    </button>
  );
}

function IconButton({ icon }: { icon: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-[30px] w-[30px] items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary"
    >
      {icon}
    </button>
  );
}
