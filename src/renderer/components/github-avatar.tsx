import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { UserRound } from "lucide-react";

interface GitHubAvatarProps {
  login: string;
  size?: number;
  className?: string;
}

/** Get a GitHub avatar URL for a given username */
export function githubAvatarUrl(login: string, size = 64): string {
  const cleanLogin = login.replace(/\[bot\]$/i, "");
  return `https://github.com/${encodeURIComponent(cleanLogin)}.png?size=${size}`;
}

export function GitHubAvatar({
  login,
  size = 20,
  className,
}: GitHubAvatarProps): React.ReactElement {
  const iconSize = Math.max(Math.round(size * 0.48), 10);

  return (
    <Avatar
      className={cn("bg-bg-raised shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <AvatarImage
        src={githubAvatarUrl(login, size * 2)}
        alt={login}
        loading="eager"
        referrerPolicy="no-referrer"
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
