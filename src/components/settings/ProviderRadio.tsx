import type { ReactNode } from "react";

export type StatusDotColor = "green" | "yellow" | "red" | "gray";

export interface StatusDot {
  color: StatusDotColor;
  title: string;
  pulse?: boolean;
}

interface Props {
  id: string;
  name: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
  statusDot?: StatusDot;
  children?: ReactNode; // rendered below the label when selected
}

const DOT_CLASSES: Record<StatusDotColor, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  gray: "bg-gray-400",
};

export function ProviderRadio({
  id,
  name,
  label,
  description,
  selected,
  onSelect,
  disabled,
  disabledReason,
  statusDot,
  children,
}: Props) {
  const containerClass = selected
    ? "border-orange-300 bg-orange-50"
    : disabled
      ? "border-border bg-neutral-50 opacity-60 cursor-not-allowed"
      : "border-border bg-accent hover:bg-neutral-100";

  return (
    <div className={`rounded-xl border transition-colors ${containerClass}`}>
      <label
        className={`flex items-start gap-3 p-4 ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        title={disabled ? disabledReason : undefined}
      >
        <input
          type="radio"
          name={name}
          value={id}
          checked={selected}
          onChange={() => {
            if (!disabled) onSelect();
          }}
          disabled={disabled}
          className="mt-1 accent-orange-500"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{label}</p>
            {statusDot && selected && (
              <span
                className={`inline-block h-2 w-2 rounded-full ${DOT_CLASSES[statusDot.color]} ${
                  statusDot.pulse ? "animate-pulse" : ""
                }`}
                title={statusDot.title}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          {disabled && disabledReason && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              {disabledReason}
            </p>
          )}
        </div>
      </label>
      {selected && children && (
        <div className="border-t border-orange-200 bg-white/50 px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}
