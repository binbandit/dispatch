import { AlertCircle, AlertTriangle, Info } from "lucide-react";

/**
 * CI annotation inline in the diff — DISPATCH-DESIGN-SYSTEM.md § 8.6
 *
 * Renders inside a `<td colSpan={3}>` in the diff table.
 * CI errors appear at the exact line that caused them.
 */

export interface Annotation {
  path: string;
  startLine: number;
  endLine: number;
  level: "notice" | "warning" | "failure";
  message: string;
  title: string;
  checkName: string;
}

interface CiAnnotationProps {
  annotations: Annotation[];
}

const LEVEL_STYLES: Record<
  string,
  { bg: string; border: string; text: string; icon: typeof AlertCircle }
> = {
  failure: {
    bg: "bg-danger-muted",
    border: "border-l-destructive",
    text: "text-destructive",
    icon: AlertCircle,
  },
  warning: {
    bg: "bg-warning-muted",
    border: "border-l-warning",
    text: "text-warning",
    icon: AlertTriangle,
  },
  notice: {
    bg: "bg-info-muted",
    border: "border-l-info",
    text: "text-info",
    icon: Info,
  },
};

export function CiAnnotation({ annotations }: CiAnnotationProps) {
  return (
    <div className="mx-3 my-1.5 flex max-w-xl flex-col gap-px overflow-hidden rounded-lg">
      {annotations.map((annotation, i) => {
        const style = LEVEL_STYLES[annotation.level] ?? LEVEL_STYLES.notice!;
        if (!style) {
          return null;
        }
        const Icon = style.icon;

        return (
          <div
            key={`${annotation.checkName}-${annotation.startLine}-${i}`}
            className={`flex items-start gap-2 border-l-2 px-3 py-2 ${style.bg} ${style.border}`}
          >
            <Icon
              size={14}
              className={`mt-0.5 shrink-0 ${style.text}`}
            />
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-medium ${style.text}`}>
                {annotation.title || annotation.message}
              </p>
              {annotation.title && annotation.message !== annotation.title && (
                <p className={`mt-0.5 text-[11px] ${style.text} opacity-80`}>
                  {annotation.message}
                </p>
              )}
              <p className="text-text-tertiary mt-0.5 font-mono text-[10px]">
                {annotation.checkName}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
