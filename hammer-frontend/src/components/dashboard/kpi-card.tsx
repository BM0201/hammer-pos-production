import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { getRoleColor } from "@/lib/role-colors";

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
  tile: string;
  bar: string;
  dot: string;
  iconBg: string;
  iconColor: string;
  Icon: LucideIcon;
};

function getTone(tone: string, roleCssPrefix: string): ToneConfig {
  if (tone === "alert") {
    return {
      tile: "hm-kpi-tile-alert",
      bar: "linear-gradient(90deg, var(--color-warning-400), var(--color-warning-600))",
      dot: "bg-[var(--color-warning-500)]",
      iconBg: "bg-[var(--color-warning-50)] border border-[var(--color-warning-100)]",
      iconColor: "text-[var(--color-warning-600)]",
      Icon: AlertTriangle,
    };
  }
  if (tone === "ok") {
    return {
      tile: "hm-kpi-tile-ok",
      bar: `linear-gradient(90deg, var(--color-${roleCssPrefix}-400), var(--color-${roleCssPrefix}-600))`,
      dot: "bg-[var(--color-success-500)]",
      iconBg: `bg-[var(--color-${roleCssPrefix}-50)] border border-[var(--color-${roleCssPrefix}-100)]`,
      iconColor: `text-[var(--color-${roleCssPrefix}-600)]`,
      Icon: roleCssPrefix === "master" ? TrendingUp : CheckCircle2,
    };
  }
  return {
    tile: "",
    bar: `linear-gradient(90deg, var(--color-${roleCssPrefix}-400), var(--color-${roleCssPrefix}-600))`,
    dot: "bg-[var(--color-text-soft)]",
    iconBg: "bg-[var(--color-surface-alt)] border border-[var(--color-border)]",
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
  const resolvedRole = roleAccent ?? (accent === "master" ? "MASTER" : "BRANCH_ADMIN");
  const roleCfg = getRoleColor(resolvedRole);
  const cfg = getTone(tone, roleCfg.cssPrefix);
  const Icon = cfg.Icon;

  return (
    <div className={`hm-kpi-tile hm-shine group ${cfg.tile}`}>
      {/* Top gradient accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl transition-all duration-300 group-hover:h-[4px]"
        style={{ background: cfg.bar }}
      />

      <div className="flex items-start justify-between gap-3 mt-1">
        {/* Left — metrics */}
        <div className="min-w-0 flex-1">
          <p className="hm-data-label mb-2">
            {label}
          </p>
          <p className="hm-num-2xl">{value}</p>
          {helper && (
            <p className="mt-1.5 text-[0.6875rem] text-[var(--color-text-soft)] truncate leading-relaxed">
              {helper}
            </p>
          )}
        </div>

        {/* Right — icon */}
        <div
          className={`hm-icon-wrap hm-icon-wrap-lg ${cfg.iconBg} transition-all duration-300 group-hover:scale-105 group-hover:shadow-md mt-0.5 flex-shrink-0`}
        >
          <Icon className={`${cfg.iconColor}`} style={{ width: "1.25rem", height: "1.25rem" }} />
        </div>
      </div>

      {/* Bottom-right status dot */}
      <div className={`absolute bottom-2.5 right-3 h-1.5 w-1.5 rounded-full ${cfg.dot} opacity-70`} />
    </div>
  );
}
