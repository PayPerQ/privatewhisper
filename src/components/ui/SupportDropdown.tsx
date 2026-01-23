import React from "react";
import { Button } from "./button";
import { HelpCircle, MessageCircle } from "lucide-react";

interface SupportDropdownProps {
  className?: string;
}

export default function SupportDropdown({ className }: SupportDropdownProps) {
  const handleContactSupport = () => {
    // Open Chatwoot widget
    if ((window as any).$chatwoot) {
      (window as any).$chatwoot.toggle();
    } else {
      console.warn("Chatwoot widget not loaded yet");
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
