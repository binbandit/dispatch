import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  getGitHubAvatarUrl,
  isEnterpriseManagedUserLogin,
} from "@/renderer/lib/shared/github-avatar";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";

interface GitHubAvatarProps {
  login: string;
  size?: number;
  className?: string;
  avatarUrl?: string;
  cwd?: string;
}

export function GitHubAvatar({
  login,
  size = 20,
  className,
  avatarUrl,
  cwd,
}: GitHubAvatarProps): React.ReactElement {
  const workspace = useWorkspace();
  const iconSize = Math.max(Math.round(size * 0.48), 10);
  const resolvedCwd = cwd ?? workspace.cwd;
  const repoAccountQuery = useQuery({
    queryKey: ["env", "repoAccount", workspace.nwo],
    queryFn: () => ipc("env.repoAccount", { ...workspace.repoTarget }),
    staleTime: 300_000,
    retry: 1,
    enabled: Boolean(resolvedCwd),
  });
  const host = repoAccountQuery.data?.host ?? "github.com";
  const shouldResolveAvatarUrl =
    !avatarUrl &&
    Boolean(resolvedCwd) &&
    (host !== "github.com" || isEnterpriseManagedUserLogin(login));
  const avatarLookupQuery = useQuery({
    queryKey: ["env", "avatarUrl", resolvedCwd, host, login],
    queryFn: () => ipc("env.avatarUrl", { cwd: resolvedCwd, login, host }),
    staleTime: 900_000,
    retry: 1,
    enabled: shouldResolveAvatarUrl,
  });
  const src = getGitHubAvatarUrl({
    login,
    size: size * 2,
    host,
    avatarUrl,
    resolvedAvatarUrl: avatarLookupQuery.data?.avatarUrl ?? null,
  });

  return (
    <Avatar
      className={cn("bg-bg-raised shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <AvatarImage
        src={src}
        alt={login}
        height={size}
        loading="eager"
        referrerPolicy="no-referrer"
        width={size}
      />
      <AvatarFallback className="text-accent-text bg-[linear-gradient(135deg,rgba(212,136,58,0.18),rgba(124,90,42,0.72))]">
        <UserRound
          size={iconSize}
          strokeWidth={1.75}
        />
      </AvatarFallback>
    </Avatar>
  );
}
