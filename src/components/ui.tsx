"use client";

import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";

let bodyLockCount = 0;
let restoreBody: (() => void) | null = null;
const modalStack: string[] = [];
const subscribeToMount = () => () => undefined;
const getClientMountSnapshot = () => true;
const getServerMountSnapshot = () => false;

function lockBodyScroll() {
  bodyLockCount += 1;
  if (bodyLockCount === 1) {
    const scrollY = window.scrollY;
    const previous = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    restoreBody = () => {
      document.body.style.overflow = previous.overflow;
      document.body.style.position = previous.position;
      document.body.style.top = previous.top;
      document.body.style.width = previous.width;
      if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    };
  }

  return () => {
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) {
      restoreBody?.();
      restoreBody = null;
    }
  };
}

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
    <header className="mb-9 flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        {eyebrow && <p className="ml !text-[var(--accent)]">{eyebrow}</p>}
        <h1 className="hd mt-3 text-[clamp(1.9rem,7vw,2.3rem)]">{title}</h1>
        {description && <p className="bd mt-3 max-w-[34rem] text-[15px]">{description}</p>}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
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
      className={cn(
        "flex flex-col items-start gap-4 rounded-[20px] py-4 pl-6 pr-5 sm:flex-row sm:justify-between sm:gap-5",
        rules[tone],
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className="min-w-0 flex-1">
        <p className="nm">{title}</p>
        {children && <div className="bd mt-1.5">{children}</div>}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
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
    <div className="min-w-0">
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
  suspended = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  suspended?: boolean;
}) {
  const mounted = useSyncExternalStore(
    subscribeToMount,
    getClientMountSnapshot,
    getServerMountSnapshot,
  );
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const suspendedRef = useRef(suspended);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;

  useEffect(() => {
    onCloseRef.current = onClose;
    suspendedRef.current = suspended;
  }, [onClose, suspended]);

  useEffect(() => {
    if (!mounted || !open) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlockBody = lockBodyScroll();
    const dialogElement = dialogRef.current;
    modalStack.push(modalId);

    const background = Array.from(document.body.children)
      .filter((element) => element !== overlayRef.current)
      .map((element) => ({ element, wasInert: element.hasAttribute("inert") }));
    for (const { element } of background) element.setAttribute("inert", "");

    const keepFocusedControlVisible = () => {
      const active = document.activeElement;
      const dialog = dialogRef.current;
      if (!(active instanceof HTMLElement) || !dialog?.contains(active)) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const rect = active.getBoundingClientRect();
      if (rect.top < viewportTop + 16 || rect.bottom > viewportBottom - 16) {
        active.scrollIntoView({ block: "center", behavior: "auto" });
      }
    };
    const syncToVisualViewport = () => {
      const overlay = overlayRef.current;
      const viewport = window.visualViewport;
      if (!overlay || !viewport) return;
      overlay.style.left = `${viewport.offsetLeft}px`;
      overlay.style.top = `${viewport.offsetTop}px`;
      overlay.style.width = `${viewport.width}px`;
      overlay.style.height = `${viewport.height}px`;
      window.requestAnimationFrame(keepFocusedControlVisible);
    };
    syncToVisualViewport();
    dialogElement?.addEventListener("focusin", keepFocusedControlVisible);
    window.visualViewport?.addEventListener("resize", syncToVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncToVisualViewport);

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current || modalStack.at(-1) !== modalId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      dialogElement?.removeEventListener("focusin", keepFocusedControlVisible);
      window.visualViewport?.removeEventListener("resize", syncToVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncToVisualViewport);
      const stackIndex = modalStack.lastIndexOf(modalId);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      for (const { element, wasInert } of background) {
        if (!wasInert) element.removeAttribute("inert");
      }
      unlockBody();
      const restoreTarget = restoreFocusRef.current;
      window.requestAnimationFrame(() => {
        if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
      });
    };
  }, [modalId, mounted, open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-[#171310]/75 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-[2px] sm:items-center sm:p-6"
      aria-hidden={suspended || undefined}
      inert={suspended}
      onPointerDown={(event) => {
        if (!suspended && event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <section
        ref={dialogRef}
        className="frame flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-b-none sm:max-h-[calc(100dvh-3rem)] sm:rounded-[28px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="shrink-0 px-6 pb-5 pt-4 sm:px-8 sm:pt-7">
          <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-[var(--edge-strong)] sm:hidden" />
          <div className="relative pr-12">
            <h2 id={titleId} className="hd text-[24px]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="bd mt-2.5">
                {description}
              </p>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              className="absolute -right-1 -top-2 flex size-11 items-center justify-center rounded-full text-[var(--ink-4)] transition hover:bg-[var(--ground-tint)] hover:text-[var(--ink)]"
              aria-label={`Close ${title}`}
              onClick={() => onCloseRef.current()}
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] [scroll-padding-block:1rem_max(6rem,env(safe-area-inset-bottom))] sm:px-8 sm:pb-8">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}
