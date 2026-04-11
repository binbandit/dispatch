import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";
import { Building2, Calendar, MapPin, Users } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * UserProfileTooltip — wraps any trigger element (typically a GitHubAvatar)
 * and shows a rich lazy-loaded profile card on hover.
 *
 * Fetches the profile via env.userProfile only when the tooltip opens,
 * using React Query with a 5-minute stale time so repeated hovers are instant.
 */

interface UserProfileTooltipProps {
  login: string;
  children: ReactNode;
}

export function UserProfileTooltip({ login, children }: UserProfileTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={setOpen}
    >
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipPopup
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[260px] !p-0"
      >
        {open && <ProfileContent login={login} />}
      </TooltipPopup>
    </Tooltip>
  );
}

function ProfileContent({ login }: { login: string }) {
  const profileQuery = useQuery({
    queryKey: ["env", "userProfile", login],
    queryFn: () => ipc("env.userProfile", { login }),
    staleTime: 300_000,
    retry: 1,
  });

  const profile = profileQuery.data;

  if (profileQuery.isLoading) {
    return <ProfileSkeleton />;
  }

  if (profileQuery.isError || !profile) {
    return (
      <div style={{ padding: "10px 12px" }}>
        <span className="text-text-ghost text-[10px]">Could not load profile</span>
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 12px" }}>
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <GitHubAvatar
          login={login}
          size={28}
          className="border-border-strong shrink-0 border"
        />
        <div className="min-w-0 flex-1">
          <div className="text-text-primary truncate text-xs font-medium">
            {profile.name ?? login}
          </div>
          <div className="text-text-tertiary truncate font-mono text-[10px]">{login}</div>
        </div>
      </div>

      {/* Bio */}
      {profile.bio && (
        <p
          className="text-text-secondary mt-2 text-[11px] leading-[1.4]"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {profile.bio}
        </p>
      )}

      {/* Stats */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {profile.company && (
          <MetaItem icon={Building2}>{profile.company.replace(/^@/, "")}</MetaItem>
        )}
        {profile.location && <MetaItem icon={MapPin}>{profile.location}</MetaItem>}
        <MetaItem icon={Users}>
          {profile.followers} follower{profile.followers !== 1 ? "s" : ""}
        </MetaItem>
        <MetaItem icon={Calendar}>{formatAge(profile.createdAt)}</MetaItem>
      </div>

      {/* Orgs */}
      {profile.organizations.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex -space-x-1">
            {profile.organizations.slice(0, 5).map((org) => (
              <GitHubAvatar
                key={org.login}
                login={org.login}
                size={14}
                className="ring-bg-elevated ring-1"
              />
            ))}
            {profile.organizations.length > 5 && (
              <span className="text-text-ghost flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[7px] ring-1 ring-[var(--bg-elevated)]">
                +{profile.organizations.length - 5}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div style={{ padding: "10px 12px" }}>
      <div className="flex items-center gap-2.5">
        <div className="bg-bg-raised h-7 w-7 shrink-0 animate-pulse rounded-full" />
        <div className="flex-1">
          <div className="bg-bg-raised h-3 w-20 animate-pulse rounded-sm" />
          <div className="bg-bg-raised mt-1 h-2 w-14 animate-pulse rounded-sm" />
        </div>
      </div>
      <div className="bg-bg-raised mt-2.5 h-2 w-3/4 animate-pulse rounded-sm" />
    </div>
  );
}

function MetaItem({ icon: Icon, children }: { icon: React.ElementType; children: ReactNode }) {
  return (
    <span className="text-text-tertiary flex items-center gap-1 text-[10px]">
      <Icon
        size={9}
        className="text-text-ghost shrink-0"
      />
      {children}
    </span>
  );
}

function formatAge(createdAt: string): string {
  const years = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  );
  if (years < 1) {
    return "< 1y";
  }
  return `${years}y`;
}
