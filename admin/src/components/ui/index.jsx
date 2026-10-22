// Shared building blocks for the staff panel (design-system/qclinics/MASTER.md, section 5).
// Every screen should use these instead of hand-styled buttons, cards and badges,
// so the whole product looks like one product.
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaChevronRight, FaEllipsisV, FaSpinner } from "react-icons/fa";

export { default as Avatar } from "./Avatar";
export { DialogProvider, useDialog } from "./Dialog";
export { default as Modal } from "./Modal";

const cx = (...parts) => parts.filter(Boolean).join(" ");

// --- Layout ---

// One width and gutter for every staff page
export const Page = ({ children, className = "", narrow = false }) => (
  <div className={cx("w-full mx-auto px-4 py-5 sm:px-6 sm:py-6", narrow ? "max-w-4xl" : "max-w-7xl", className)}>{children}</div>
);

// Title, one line of description, actions on the right (wrap under on phones)
export const PageHeader = ({ title, description, actions, icon }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
        {icon && <span className="text-primary-700 text-xl" aria-hidden="true">{icon}</span>}
        {title}
      </h1>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const Card = ({ children, className = "", padded = true, as: Tag = "div", ...props }) => (
  <Tag className={cx("bg-white rounded-xl border border-slate-200", padded && "p-5", className)} {...props}>
    {children}
  </Tag>
);

export const CardHeader = ({ title, description, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
    <div className="min-w-0">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

// --- Buttons ---

const BUTTON_VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-800 border border-transparent",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50",
  ghost: "bg-transparent text-slate-700 border border-transparent hover:bg-slate-100",
  danger: "bg-red-600 text-white border border-transparent hover:bg-red-700",
  "danger-outline": "bg-white text-red-700 border border-red-200 hover:bg-red-50",
};
const BUTTON_SIZES = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

// Always has a text label (icon optional). `loading` disables it and shows a spinner.
export const Button = forwardRef(function Button(
  { variant = "secondary", size = "md", icon, loading = false, className = "", children, type = "button", disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors duration-150",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? <FaSpinner className="animate-spin" aria-hidden="true" /> : icon && <span aria-hidden="true" className="inline-flex">{icon}</span>}
      {children}
    </button>
  );
});

// Icon-only button: requires a label (read by screen readers, shown as a tooltip)
export const IconButton = ({ label, icon, tone = "default", className = "", ...props }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={cx(
      "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
      tone === "danger" ? "text-red-700 hover:bg-red-50" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      className
    )}
    {...props}
  >
    <span aria-hidden="true" className="inline-flex">{icon}</span>
  </button>
);

// --- Status ---

const BADGE_TONES = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  danger: "bg-red-50 text-red-700 ring-red-600/20",
  info: "bg-primary-50 text-primary-800 ring-primary-700/20",
  neutral: "bg-slate-100 text-slate-700 ring-slate-500/20",
  followup: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

// Status label: colour + words (never colour alone)
export const Badge = ({ tone = "neutral", icon, children, className = "", title }) => (
  <span
    title={title}
    className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", BADGE_TONES[tone], className)}
  >
    {icon && <span aria-hidden="true" className="inline-flex">{icon}</span>}
    {children}
  </span>
);

// Appointment status in one place, so every list says the same thing
export const AppointmentStatus = ({ item }) => {
  if (item.cancelled) return <Badge tone="danger">Cancelled</Badge>;
  if (item.isCompleted) return <Badge tone="success">Completed</Badge>;
  if (item.status === "no_show") return <Badge tone="warning">No-show</Badge>;
  // Arrived and given a queue token (walk-ins always are)
  if (item.type === "walk_in" || (item.history || []).some((h) => h.action === "checked_in")) return <Badge tone="info">In queue</Badge>;
  return <Badge tone="neutral">Booked</Badge>;
};

// --- Numbers ---

// Label, large value, one line of context. Neutral icon (no rainbow tiles).
// `to` makes the whole tile a link to the page behind the number.
export const StatTile = ({ label, value, hint, icon, loading = false, tone, to }) => {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {icon && (
          <span aria-hidden="true" className="text-slate-400 text-lg">
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-24 rounded bg-slate-100 animate-pulse" />
      ) : (
        <p className={cx("mt-1 font-display text-3xl font-semibold tabular-nums", tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-800" : "text-slate-900")}>{value}</p>
      )}
      {(hint || to) && (
        <p className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>{hint}</span>
          {to && <FaChevronRight aria-hidden="true" className="shrink-0 text-slate-400" />}
        </p>
      )}
    </>
  );
  if (!to) return <Card className="min-w-0">{body}</Card>;
  return (
    <Link to={to} className="block min-w-0 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-primary-300 hover:bg-primary-50/30">
      {body}
    </Link>
  );
};

// --- Empty / loading ---

export const EmptyState = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center text-center px-6 py-10">
    {icon && (
      <span aria-hidden="true" className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 text-xl">
        {icon}
      </span>
    )}
    <p className="font-medium text-slate-900">{title}</p>
    {description && <p className="mt-1 max-w-sm text-sm text-slate-600">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const Skeleton = ({ className = "h-4 w-full" }) => <div className={cx("rounded bg-slate-100 animate-pulse", className)} />;

// --- Forms ---

export const Field = ({ label, htmlFor, required, hint, error, children, className = "" }) => (
  <div className={className}>
    {label && (
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-700"> *</span>}
      </label>
    )}
    {children}
    {error ? (
      <p className="mt-1 text-sm text-red-700" role="alert">{error}</p>
    ) : (
      hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
    )}
  </div>
);

const CONTROL = "w-full rounded-lg border bg-white px-3 py-2 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 transition-colors disabled:bg-slate-50 disabled:text-slate-500";
const controlBorder = (invalid) => (invalid ? "border-red-500" : "border-slate-300 hover:border-slate-400");

export const Input = forwardRef(function Input({ invalid, className = "", ...props }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx(CONTROL, controlBorder(invalid), className)} {...props} />;
});

export const Select = forwardRef(function Select({ invalid, className = "", children, ...props }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cx(CONTROL, controlBorder(invalid), "pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ invalid, className = "", ...props }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cx(CONTROL, controlBorder(invalid), className)} {...props} />;
});

// --- Segmented tabs (filters, periods) ---

export const Segmented = ({ options, value, onChange, label, size = "md" }) => (
  <div role="tablist" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
    {options.map((o) => {
      const selected = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={selected}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            selected ? "bg-primary text-white" : "text-slate-700 hover:bg-slate-100"
          )}
        >
          {o.label}
          {o.count > 0 && (
            <span className={cx("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", selected ? "bg-white/25" : "bg-slate-100 text-slate-700")}>{o.count}</span>
          )}
        </button>
      );
    })}
  </div>
);

// --- Menu ("More" actions, user menu) ---
// items: [{ label, icon, onClick, tone: "danger", hidden, divider }]
// Keyboard: Enter/Space/ArrowDown opens; arrows move; Escape closes and returns focus.
export const Menu = ({ label = "More actions", trigger, items, align = "right", buttonClassName = "" }) => {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const list = useRef(null);
  const id = useId();
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!list.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    list.current?.querySelector("[role=menuitem]")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  const onKeyDown = (e) => {
    const entries = [...(list.current?.querySelectorAll("[role=menuitem]") || [])];
    const index = entries.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      entries[(index + 1) % entries.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      entries[(index - 1 + entries.length) % entries.length]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  if (!visible.length) return null;
  return (
    <div className="relative inline-block text-left">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={trigger ? undefined : label}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={buttonClassName || "inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"}
      >
        {trigger || <FaEllipsisV aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cx(
            "absolute z-40 mt-1 min-w-[12rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {visible.map((item, i) =>
            item.divider ? (
              <div key={`d${i}`} role="separator" className="my-1 border-t border-slate-100" />
            ) : item.header ? (
              <div key={`h${i}`} className="px-3 py-2">{item.header}</div>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(false);
                  item.onClick?.();
                }}
                className={cx(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors focus:outline-none",
                  item.tone === "danger" ? "text-red-700 hover:bg-red-50 focus:bg-red-50" : "text-slate-700 hover:bg-slate-50 focus:bg-slate-50"
                )}
              >
                {item.icon && <span aria-hidden="true" className="inline-flex w-4 justify-center opacity-80">{item.icon}</span>}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};
