"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "small" | "icon";
  busy?: boolean;
};

/*
 * Primary is the only solid terracotta control on a screen — the one action,
 * fully rounded. Everything else steps back to a soft tile or to plain text.
 */
export function Button({
  className,
  variant = "primary",
  size = "default",
  busy = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary: "glow",
    secondary:
      "bg-[var(--ground-hi)] text-[var(--ink-2)] font-medium hover:bg-[var(--ground-tint)] hover:text-[var(--ink)]",
    ghost: "text-[var(--ink-4)] font-medium hover:text-[var(--ink)]",
    danger: "text-[var(--ink-3)] font-medium hover:text-[var(--accent)]",
  };
  const sizes = {
    default: "min-h-12 rounded-full px-6 text-[15px]",
    small: "min-h-12 rounded-full px-5 text-[13.5px]",
    icon: "size-12 shrink-0 rounded-full",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2.5 transition disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("page-enter mx-auto w-full max-w-[60rem] px-5 pb-10 pt-7 sm:px-8 md:pt-9", className)}>
      {children}
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-9 flex items-end justify-between gap-6">
      <div className="min-w-0">
        {eyebrow && <p className="ml !text-[var(--accent)]">{eyebrow}</p>}
        <h1 className="hd mt-3 text-[clamp(1.9rem,7vw,2.3rem)]">{title}</h1>
        {description && <p className="bd mt-3 max-w-[34rem] text-[15px]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/*
 * A labelled group of tiles. The label sits in a wide left margin on desktop —
 * outside the content — so each tile below reads as exactly one fact.
 */
export function Section({
  label,
  meta,
  children,
  className,
  labelWidth = "92px",
  id,
}: {
  label: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  labelWidth?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn("flex flex-col gap-3 sm:flex-row sm:gap-7", className)}
    >
      <div className="flex-none" style={{ width: labelWidth }}>
        <p className="ml">{label}</p>
        {meta && <p className="m mt-1.5 text-[11px] text-[var(--ink-5)]">{meta}</p>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

/*
 * A standalone panel — used only where the design shows a self-contained
 * surface (a sign-in sheet, a modal, a conflict to resolve), never as a card
 * around ordinary content.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("frame p-6", className)}>{children}</section>;
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "orange" | "red" | "yellow";
  className?: string;
}) {
  const tones = {
    neutral: "text-[var(--ink-4)]",
    green: "text-[var(--sage)]",
    orange: "text-[var(--accent)]",
    red: "text-[var(--accent)]",
    yellow: "text-[var(--accent)]",
  };
  return (
    <span className={cn("m text-[11px] font-semibold whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function StateNotice({
  title,
  children,
  tone = "neutral",
  action,
}: {
  title: string;
  children?: ReactNode;
  tone?: "neutral" | "warning" | "error" | "success";
  action?: ReactNode;
}) {
  // Trouble is a soft tile with a lit left rule — never a coloured box.
  const rules = {
    neutral: "bg-[var(--ground-hi)] shadow-[inset_5px_0_0_0_var(--edge-strong)]",
    warning: "bg-[var(--ground-hi)] shadow-[inset_5px_0_0_0_var(--accent)]",
    error: "bg-[var(--ground-hi)] shadow-[inset_5px_0_0_0_var(--accent)]",
    success: "bg-[var(--ground-hi)] shadow-[inset_5px_0_0_0_var(--sage)]",
  };
  return (
    <div
      className={cn("flex items-start justify-between gap-5 rounded-[20px] py-4 pl-6 pr-5", rules[tone])}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className="min-w-0 flex-1">
        <p className="nm">{title}</p>
        {children && <div className="bd mt-1.5">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[20px] bg-[var(--ground)] px-6 py-10">
      <span className="flex text-[var(--ink-5)]" aria-hidden="true">
        {icon}
      </span>
      <h2 className="hd mt-5 text-[20px]">{title}</h2>
      <p className="bd mt-2 max-w-sm">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/*
 * Inputs are soft tiles — a quiet field that lights up in terracotta on
 * focus, never a drawn box or an underline.
 */
export const inputClass =
  "min-h-12 w-full rounded-[16px] bg-[var(--ground)] px-4 py-3 text-[16px] text-[var(--ink)] transition focus:bg-[var(--ground-tint)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/60 disabled:opacity-45 placeholder:text-[var(--ink-5)]";

export const selectClass = `${inputClass} m appearance-none pr-7`;

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="ml mb-2.5 block">
        {label}
      </label>
      {children}
      {hint && <p className="bd mt-2 text-[12.5px] text-[var(--ink-5)]">{hint}</p>}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#171310]/75 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={onClose}
    >
      <section
        className="frame safe-bottom max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-b-none px-6 pb-6 pt-7 sm:rounded-[28px] sm:px-8 sm:pb-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-[5px] w-10 rounded-full bg-[var(--edge-strong)] sm:hidden" />
        <div className="mb-7">
          <h2 id="modal-title" className="hd text-[24px]">
            {title}
          </h2>
          {description && <p className="bd mt-2.5">{description}</p>}
        </div>
        {children}
      </section>
    </div>
  );
}
