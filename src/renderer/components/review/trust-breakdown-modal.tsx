import type { GhUserProfile } from "@/shared/ipc";

import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { Calendar, GitPullRequest, History, ShieldCheck, Users } from "lucide-react";

export interface TrustBreakdown {
  total: number;
  accountAge: number;
  followers: number;
  publicRepos: number;
  organizations: number;
  repoHistory: number;
}

interface TrustBreakdownModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: GhUserProfile;
  breakdown: TrustBreakdown;
  label: string;
  color: string;
}

const TRUST_SCORE_WEIGHTS = {
  accountAge: 25,
  followers: 20,
  publicRepos: 20,
  organizations: 15,
  repoHistory: 20,
} as const;

const CATEGORIES = [
  {
    key: "accountAge" as const,
    label: "Account Age",
    max: TRUST_SCORE_WEIGHTS.accountAge,
    icon: Calendar,
    color: "var(--success)",
    rawValue: (p: GhUserProfile) => {
      const years = Math.floor(
        (Date.now() - new Date(p.createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      );
      return years < 1 ? "< 1 year" : `${years} year${years === 1 ? "" : "s"}`;
    },
  },
  {
    key: "followers" as const,
    label: "Followers",
    max: TRUST_SCORE_WEIGHTS.followers,
    icon: Users,
    color: "var(--info)",
    rawValue: (p: GhUserProfile) => String(p.followers),
  },
  {
    key: "publicRepos" as const,
    label: "Public Repos",
    max: TRUST_SCORE_WEIGHTS.publicRepos,
    icon: GitPullRequest,
    color: "var(--purple)",
    rawValue: (p: GhUserProfile) => String(p.publicRepos),
  },
  {
    key: "organizations" as const,
    label: "Organizations",
    max: TRUST_SCORE_WEIGHTS.organizations,
    icon: ShieldCheck,
    color: "var(--warning)",
    rawValue: (p: GhUserProfile) => String(p.organizations.length),
  },
  {
    key: "repoHistory" as const,
    label: "Repo History",
    max: TRUST_SCORE_WEIGHTS.repoHistory,
    icon: History,
    color: "var(--accent)",
    rawValue: (p: GhUserProfile) => {
      if (!p.repoContributions) {
        return "No repo data";
      }
      if (p.repoContributions.total === 0) {
        return "No prior activity";
      }
      return p.repoContributions.mergedPullRequests > 0
        ? `${p.repoContributions.total} prior items · ${p.repoContributions.mergedPullRequests} merged`
        : `${p.repoContributions.total} prior items`;
    },
  },
];

function trustDescription(total: number): string {
  if (total >= 70) {
    return "An established contributor with strong GitHub signals and meaningful prior work in this repository.";
  }
  if (total >= 40) {
    return "A moderately established contributor with some track record on GitHub and in this codebase.";
  }
  return "A newer or less active GitHub user. Review contributions with standard diligence.";
}

function formatAccountAge(createdAt: string): string {
  const years = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  );
  if (years < 1) {
    return "< 1y";
  }
  return `${years}y`;
}

export function TrustBreakdownModal({
  open,
  onOpenChange,
  profile,
  breakdown,
  label,
  color,
}: TrustBreakdownModalProps) {
  const ringSize = 72;
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const progress = (breakdown.total / 100) * circumference;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogPopup className="max-w-[340px] overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          {/* Hero: score ring with avatar + user info */}
          <div className="flex items-center gap-3.5">
            <div
              className="relative shrink-0"
              style={{ width: ringSize, height: ringSize }}
            >
              <svg
                className="absolute inset-0 -rotate-90"
                viewBox={`0 0 ${ringSize} ${ringSize}`}
                width={ringSize}
                height={ringSize}
              >
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={3}
                />
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeWidth={3}
                  strokeDasharray={`${progress} ${circumference}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dasharray 0.5s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <GitHubAvatar
                  login={profile.login}
                  size={36}
                  className="border-border border"
                />
              </div>
              {/* Score pill overlapping bottom of ring */}
              <span
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-px font-mono text-[9px] font-bold"
                style={{
                  background: `color-mix(in srgb, ${color} 18%, var(--bg-elevated))`,
                  color,
                  border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                }}
              >
                {breakdown.total}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-text-primary truncate text-[13px] leading-tight font-semibold tracking-[-0.01em]">
                {profile.name ?? profile.login}
              </p>
              <p className="text-text-tertiary mt-0.5 truncate font-mono text-[10px]">
                @{profile.login} &middot; {formatAccountAge(profile.createdAt)}
              </p>
              <p
                className="font-display mt-1 text-[15px] leading-none italic"
                style={{ color }}
              >
                {label}
              </p>
            </div>
          </div>

          {/* Description */}
          <p className="text-text-secondary mt-3 text-[11px] leading-[1.45]">
            {trustDescription(breakdown.total)}
          </p>

          {/* Divider + section label */}
          <div className="mt-3.5 flex items-center gap-2">
            <span className="text-text-ghost text-[9px] font-semibold tracking-[0.08em] uppercase">
              Breakdown
            </span>
            <div className="bg-border-subtle h-px flex-1" />
          </div>

          {/* Stacked category bar */}
          <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
            {CATEGORIES.map((cat) => (
              <div
                key={cat.key}
                className="rounded-full"
                style={{
                  width: `${(cat.max / 100) * 100}%`,
                  background: `color-mix(in srgb, ${cat.color} ${Math.round((breakdown[cat.key] / cat.max) * 100)}%, var(--border))`,
                  transition: "background 0.4s ease",
                }}
              />
            ))}
          </div>

          {/* Category breakdown */}
          <div className="mt-3 flex flex-col gap-2.5">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const value = breakdown[cat.key];
              const pct = Math.round((value / cat.max) * 100);
              const raw = cat.rawValue(profile);

              return (
                <div key={cat.key}>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Icon
                        size={11}
                        style={{ color: cat.color }}
                      />
                      <span className="text-text-primary text-[11px] font-medium">{cat.label}</span>
                      <span className="text-text-ghost font-mono text-[9px]">{raw}</span>
                    </div>
                    <span className="text-text-tertiary font-mono text-[10px]">
                      {Math.round(value)}/{cat.max}
                    </span>
                  </div>
                  <div className="bg-bg-elevated h-1 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: cat.color,
                        opacity: 0.7,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <p className="text-text-ghost mt-4 text-center text-[9px]">
            {profile.repoContributions
              ? "Based on public GitHub profile data and prior repository activity"
              : "Based on public GitHub profile data"}
          </p>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function computeRepoHistoryScore(profile: GhUserProfile): number {
  if (!profile.repoContributions) {
    return 0;
  }

  const contributionUnits =
    profile.repoContributions.pullRequests +
    profile.repoContributions.issues +
    profile.repoContributions.reviewedPullRequests +
    profile.repoContributions.mergedPullRequests;

  return Math.min(
    TRUST_SCORE_WEIGHTS.repoHistory,
    (contributionUnits / 12) * TRUST_SCORE_WEIGHTS.repoHistory,
  );
}

/**
 * Compute a contributor trust signal with per-category breakdown.
 */
export function computeTrustBreakdown(profile: GhUserProfile): TrustBreakdown {
  const ageYears =
    (Date.now() - new Date(profile.createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const accountAge = Math.min(
    TRUST_SCORE_WEIGHTS.accountAge,
    (ageYears / 4) * TRUST_SCORE_WEIGHTS.accountAge,
  );
  const followers = Math.min(
    TRUST_SCORE_WEIGHTS.followers,
    (profile.followers / 100) * TRUST_SCORE_WEIGHTS.followers,
  );
  const publicRepos = Math.min(
    TRUST_SCORE_WEIGHTS.publicRepos,
    (profile.publicRepos / 30) * TRUST_SCORE_WEIGHTS.publicRepos,
  );
  const organizations = Math.min(
    TRUST_SCORE_WEIGHTS.organizations,
    (profile.organizations.length / 3) * TRUST_SCORE_WEIGHTS.organizations,
  );
  const repoHistory = computeRepoHistoryScore(profile);

  return {
    total: Math.round(accountAge + followers + publicRepos + organizations + repoHistory),
    accountAge,
    followers,
    publicRepos,
    organizations,
    repoHistory,
  };
}
