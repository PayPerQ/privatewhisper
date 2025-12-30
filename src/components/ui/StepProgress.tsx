import React from "react";
import { Check, LucideIcon } from "lucide-react";

interface Step {
  title: string;
  icon: LucideIcon;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export default function StepProgress({
  steps,
  currentStep,
  className = "",
}: StepProgressProps) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      {steps.map((step, index) => {
        const Icon = step.icon;
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <div key={index} className="flex">
            <div
              className={`flex items-center gap-2 ${
                isActive
                  ? "text-primary"
                  : isCompleted
                    ? "text-success"
                    : "text-muted-foreground"
              }`}
              style={{ fontFamily: "Noto Sans, sans-serif" }}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-all duration-200 ${
                  isActive
                    ? "border-primary bg-accent shadow-sm"
                    : isCompleted
                      ? "border-success bg-success/10 shadow-sm"
                      : "border-border bg-background"
                }`}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <span className="text-xs font-medium hidden md:block truncate">
                {step.title}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-3 rounded-full transition-colors duration-200 ${
                  isCompleted ? "bg-success" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
