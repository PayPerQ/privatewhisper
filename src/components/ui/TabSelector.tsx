import * as React from "react";
import { cn } from "../lib/utils";

interface Tab {
  id: string;
  label: string;
}

interface TabSelectorProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export default function TabSelector({
  tabs,
  activeTab,
  onChange,
  className,
}: TabSelectorProps) {
  return (
    <div
      className={cn(
        "inline-flex p-1 bg-stone-100 rounded-lg border border-stone-200",
        className,
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-md transition-all duration-150",
            activeTab === tab.id
              ? "bg-white text-stone-900 shadow-sm"
              : "text-stone-600 hover:text-stone-900",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
