import React from "react";
import { Button } from "./button";
import { HelpCircle } from "lucide-react";

interface SupportDropdownProps {
  className?: string;
}

export default function SupportDropdown({ className }: SupportDropdownProps) {
  const handleContactSupport = () => {
    if ((window as any).$chatwoot) {
      (window as any).$chatwoot.toggle();
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={handleContactSupport}
      title="Contact Support"
    >
      <HelpCircle size={16} />
    </Button>
  );
}
