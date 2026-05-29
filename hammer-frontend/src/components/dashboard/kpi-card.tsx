import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { getRoleColor } from "@/lib/role-colors";
import { Card } from "@/components/ui/card";

type KpiCardProps = {
  label: string;
  value: string | number;
  tone?: "default" | "alert" | "ok";
  helper?: string;
  /** Role code for accent color. Defaults to MASTER. */
  roleAccent?: string;
  /** Legacy prop — maps master→MASTER, branch→BRANCH_ADMIN */
  accent?: "master" | "branch";
};

type ToneConfig = {
  card: string;
  dot: string;
  iconBg: string;
  iconColor: string;
  Icon: LucideIcon;
};

function getTone(tone: string, roleCssPrefix: string): ToneConfig {
  if (tone === "alert") {
    return {
      card: "bg-[var(--color-surface)] border-[var(--color-warning-100)]/80",
      dot: "bg-[var(--color-warning-500)]",
      iconBg: "bg-[var(--color-warning-50)]",
      iconColor: "text-[var(--color-warning-600)]",
      Icon: AlertTriangle,
    };
  }
  if (tone === "ok") {
    return {
      card: "bg-[var(--color-surface)] border-[var(--color-success-100)]/80",
      dot: "bg-[var(--color-success-500)]",
      iconBg: `bg-[var(--color-${roleCssPrefix}-50)]`,
      iconColor: `text-[var(--color-${roleCssPrefix}-600)]`,
      Icon: roleCssPrefix === "master" ? TrendingUp : CheckCircle2,
    };
  }
  return {
    card: "bg-[var(--color-surface)] border-[var(--color-border)]",
    dot: "bg-[var(--color-text-soft)]",
    iconBg: "bg-[var(--color-surface-alt)]",
    iconColor: "text-[var(--color-text-muted)]",
    Icon: Activity,
  };
}

export function KpiCard({
  label,
  value,
  tone = "default",
  helper,
  roleAccent,
  accent = "branch",
}: KpiCardProps) {
  // Resolve role code: prefer roleAccent, fall back to legacy accent prop
  const resolvedRole = roleAccent ?? (accent === "master" ? "MASTER" : "BRANCH_ADMIN");
  const roleCfg = getRoleColor(resolvedRole);
  const cfg = getTone(tone, roleCfg.cssPrefix);
  const Icon = cfg.Icon;

  return (
    <Card
      className={`${cfg.card} p-4 flex items-start gap-3 hover:shadow-md transition-shadow cursor-default`}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 rounded-xl p-2.5 ${cfg.iconBg}`}>
        <Icon className={`h-5 w-5 ${cfg.iconColor}`} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            {label}
          </p>
        </div>
        <p className="mt-1.5 text-2xl font-bold leading-none text-[var(--color-text)]">
          {value}
        </p>
        {helper ? (
          <p className="mt-1 text-[0.6875rem] text-[var(--color-text-soft)] truncate">{helper}</p>
        ) : null}
      </div>
    </Card>
  );
}
