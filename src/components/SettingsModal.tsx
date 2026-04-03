import React from "react";
import { Settings, Key, BookOpen, SlidersHorizontal, Cpu, ScrollText } from "lucide-react";
import SidebarModal, { SidebarItem } from "./ui/SidebarModal";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({
  open,
  onOpenChange,
}: SettingsModalProps) {
  const sidebarItems: SidebarItem<SettingsSectionType>[] = [
    { id: "general", label: "General", icon: Settings },
    { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
    { id: "models", label: "Model Selection", icon: Cpu },
    { id: "transcription", label: "API Key", icon: Key },
    { id: "dictionary", label: "Dictionary", icon: BookOpen },
    { id: "logs", label: "Logs", icon: ScrollText },
  ];

  const [activeSection, setActiveSection] =
    React.useState<SettingsSectionType>("general");

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
    >
      <SettingsPage activeSection={activeSection} />
    </SidebarModal>
  );
}
