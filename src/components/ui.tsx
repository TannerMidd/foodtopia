"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "small" | "icon";
  busy?: boolean;
};

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
    primary: "bg-[var(--leaf)] text-white hover:bg-[var(--leaf-bright)] shadow-sm",
    secondary:
      "border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--leaf)]",
    ghost: "bg-transparent text-[var(--leaf)] hover:bg-[var(--sprout)]",
    danger: "bg-[var(--tomato-soft)] text-[#9b3f2c] hover:bg-[#f2cfc5]",
  };
  const sizes = {
    default: "min-h-12 rounded-full px-5 py-2.5",
    small: "min-h-11 rounded-full px-4 py-2 text-sm",
    icon: "size-11 shrink-0 rounded-full",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
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
    <main className={cn("page-enter mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6 sm:pt-7", className)}>
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
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--tomato)]">{eyebrow}</p>
        )}
        <h1 className="text-[clamp(1.8rem,7vw,2.55rem)] font-extrabold leading-[1.04] tracking-[-0.045em] text-[var(--ink)]">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "rounded-[1.65rem] border border-[color:var(--line)] bg-[var(--card)] p-5 shadow-[var(--shadow)]",
        className,
      )}
    >
      {children}
    </section>
  );
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
    neutral: "bg-[#eeeae0] text-[#59675f]",
    green: "bg-[var(--sprout)] text-[#24533f]",
    orange: "bg-[#f8e1d6] text-[#98442f]",
    red: "bg-[#f8d9d3] text-[#963928]",
    yellow: "bg-[#f7edc8] text-[#725b13]",
  };
  return (
    <span className={cn("inline-flex min-h-7 items-center rounded-full px-2.5 py-1 text-xs font-bold", tones[tone], className)}>
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
  const tones = {
    neutral: "border-[var(--line)] bg-[var(--card)]",
    warning: "border-[#e9d593] bg-[#fff8dc]",
    error: "border-[#efb9ad] bg-[#fff1ed]",
    success: "border-[#bdd8bd] bg-[#eff8ea]",
  };
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border p-4", tones[tone])} role={tone === "error" ? "alert" : "status"}>
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-[var(--leaf)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        {children && <div className="mt-1 text-sm leading-5 text-[var(--muted)]">{children}</div>}
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
    <div className="rounded-[1.65rem] border border-dashed border-[var(--line)] bg-white/45 px-6 py-10 text-center">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[var(--sprout)] text-[var(--leaf)]">
        {icon}
      </div>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-2xl border border-[var(--line)] bg-white px-4 text-base text-[var(--ink)] placeholder:text-[#929d96] transition hover:border-[#afbaaf] focus:border-[var(--leaf)] focus:outline-none";

export const selectClass = `${inputClass} appearance-none pr-9`;

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
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-bold">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{hint}</p>}
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#17382b]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={onClose}>
      <section
        className="safe-bottom max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[2rem] bg-[var(--card)] p-5 shadow-2xl sm:rounded-[2rem] sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)] sm:hidden" />
        <div className="mb-5">
          <h2 id="modal-title" className="text-xl font-extrabold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{description}</p>}
        </div>
        {children}
      </section>
    </div>
  );
}
