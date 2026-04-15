import {
  computeTrustBreakdown,
  TrustBreakdownModal,
} from "@/renderer/components/review/trust-breakdown-modal";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import {
  formatAuthorName,
  useDisplayNameFormat,
} from "@/renderer/hooks/preferences/use-display-name";
import { usePreference } from "@/renderer/hooks/preferences/use-preference";
import { ipc } from "@/renderer/lib/app/ipc";
import { relativeTime } from "@/shared/format";
import {
  isTrustedContributorSystemEnabled,
  TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY,
} from "@/shared/trusted-contributors";
import { useQuery } from "@tanstack/react-query";
import { Building2, Calendar, GitPullRequest, MapPin, Users } from "lucide-react";
import { useState } from "react";

/**
 * Author dossier — lazy-loaded contributor context panel.
 *
 * Fetches the PR author's GitHub profile on demand and displays:
 * - Avatar, name, bio
 * - Contributor score ring + trust label
 * - Organizations
 * - Stats (followers, public repos, account age)
 *
 * Designed for the side panel overview tab.
 */

interface AuthorDossierProps {
  login: string;
  author: { login: string; name?: string | null };
  createdAt: string;
  repo: string;
  prNumber: number;
}

export function AuthorDossier({ login, author, createdAt, repo, prNumber }: AuthorDossierProps) {
  const nameFormat = useDisplayNameFormat();
  const trustedContributorPreference = usePreference(TRUSTED_CONTRIBUTOR_SYSTEM_PREFERENCE_KEY);
  const trustedContributorSystemEnabled = isTrustedContributorSystemEnabled(
    trustedContributorPreference,
  );
  const [trustModalOpen, setTrustModalOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["env", "userProfile", login, repo, prNumber],
    queryFn: () => ipc("env.userProfile", { login, repo, currentPrNumber: prNumber }),
    staleTime: 300_000,
    retry: 1,
  });

  const profile = profileQuery.data;
  const breakdown =
    trustedContributorSystemEnabled && profile ? computeTrustBreakdown(profile) : null;
  const trustSignal = breakdown ? computeTrustSignal(breakdown.total) : null;

  return (
    <div
      style={{
        background: "var(--bg-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "10px 12px",
        marginBottom: "10px",
      }}
    >
      {/* Top row: avatar + name + trust badge */}
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <GitHubAvatar
            login={login}
            size={32}
            className="border-border-strong border"
          />
          {/* Score ring */}
          {profile && trustSignal && (
            <svg
              width={36}
              height={36}
              className="absolute -top-0.5 -left-0.5"
              style={{ transform: "rotate(-90deg)" }}
            >
              <circle
                cx={18}
                cy={18}
                r={16}
                fill="none"
                stroke="var(--border)"
                strokeWidth={2}
              />
              <circle
                cx={18}
                cy={18}
                r={16}
                fill="none"
                stroke={trustSignal.color}
                strokeWidth={2}
                strokeDasharray={`${(trustSignal.score / 100) * 100.5} 100.5`}
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-text-primary truncate text-xs font-medium">
              {formatAuthorName(author, nameFormat)}
            </span>
            {profile && trustSignal && (
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded-xs px-1.5 py-px text-[8px] font-bold tracking-[0.04em] uppercase transition-opacity hover:opacity-80"
                style={{
                  background: `color-mix(in srgb, ${trustSignal.color} 12%, transparent)`,
                  color: trustSignal.color,
                  border: `1px solid color-mix(in srgb, ${trustSignal.color} 20%, transparent)`,
                }}
                onClick={() => setTrustModalOpen(true)}
              >
                {trustSignal.label}
              </button>
            )}
          </div>
          <span className="text-text-ghost font-mono text-[10px]">
            opened {relativeTime(new Date(createdAt))}
          </span>
        </div>
      </div>

      {/* Loading skeleton */}
      {profileQuery.isLoading && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          <div className="bg-bg-elevated h-2.5 w-3/4 animate-pulse rounded-sm" />
          <div className="bg-bg-elevated h-2 w-1/2 animate-pulse rounded-sm" />
        </div>
      )}

      {/* Profile details */}
      {profile && (
        <div className="mt-2.5">
          {/* Bio */}
          {profile.bio && (
            <p className="text-text-secondary mb-2 text-[11px] leading-[1.4]">{profile.bio}</p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {profile.company && (
              <MetaItem icon={Building2}>{profile.company.replace(/^@/, "")}</MetaItem>
            )}
            {profile.location && <MetaItem icon={MapPin}>{profile.location}</MetaItem>}
            <MetaItem icon={Users}>
              {profile.followers} follower{profile.followers === 1 ? "" : "s"}
            </MetaItem>
            <MetaItem icon={GitPullRequest}>
              {profile.publicRepos} repo{profile.publicRepos === 1 ? "" : "s"}
            </MetaItem>
            <MetaItem icon={Calendar}>Joined {formatAccountAge(profile.createdAt)}</MetaItem>
          </div>

          {/* Organizations */}
          {profile.organizations.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-text-ghost text-[9px] font-semibold tracking-[0.06em] uppercase">
                Orgs
              </span>
              <div className="flex -space-x-1">
                {profile.organizations.slice(0, 6).map((org) => (
                  <GitHubAvatar
                    key={org.login}
                    login={org.login}
                    size={16}
                    className="ring-bg-raised ring-1"
                  />
                ))}
                {profile.organizations.length > 6 && (
                  <span className="text-text-ghost flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[7px] font-medium ring-1 ring-[var(--bg-raised)]">
                    +{profile.organizations.length - 6}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error — silent, just don't show profile */}
      {profileQuery.isError && (
        <p className="text-text-ghost mt-2 text-[10px]">Could not load contributor profile</p>
      )}

      {/* Trust breakdown modal */}
      {profile && breakdown && trustSignal && (
        <TrustBreakdownModal
          open={trustModalOpen}
          onOpenChange={setTrustModalOpen}
          profile={profile}
          breakdown={breakdown}
          label={trustSignal.label}
          color={trustSignal.color}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MetaItem({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <span className="text-text-tertiary flex items-center gap-1 text-[10px]">
      <Icon
        size={10}
        className="text-text-ghost shrink-0"
      />
      {children}
    </span>
  );
}

/**
 * Compute a contributor trust signal from the aggregated score.
 */
function computeTrustSignal(score: number | undefined): {
  score: number;
  label: string;
  color: string;
} {
  if (score === undefined) {
    return { score: 0, label: "Unknown", color: "var(--text-ghost)" };
  }

  if (score >= 70) {
    return { score, label: "Trusted", color: "var(--success)" };
  }
  if (score >= 40) {
    return { score, label: "Moderate", color: "var(--warning)" };
  }
  return { score, label: "New contributor", color: "var(--text-tertiary)" };
}

function formatAccountAge(createdAt: string): string {
  const years = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  );
  if (years < 1) {
    return "< 1 year ago";
  }
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
