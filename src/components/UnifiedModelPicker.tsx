import { Globe } from "lucide-react";

interface ModelOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

interface UnifiedModelPickerCompactProps {
  selectedModel: string;
  onModelSelect: (modelId: string) => void;
  models: ModelOption[];
  className?: string;
}

export function UnifiedModelPickerCompact({
  selectedModel,
  onModelSelect,
  models,
  className = "",
}: UnifiedModelPickerCompactProps) {
  const handleOpenAIModels = () => {
    if (typeof window !== "undefined") {
      window.electronAPI?.openExternal?.(
        "https://platform.openai.com/docs/models",
      );
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleOpenAIModels}
          className="text-xs text-link underline hover:opacity-80"
        >
          Explore models on OpenAI ↗
        </button>
      </div>
      {models.map((model) => (
        <button
          key={model.value}
          onClick={() => onModelSelect(model.value)}
          className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
            selectedModel === model.value
              ? "border-primary bg-accent"
              : "border-border bg-background hover:border-muted"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                {model.icon ? (
                  <img
                    src={model.icon}
                    alt=""
                    className="w-4 h-4"
                    aria-hidden="true"
                  />
                ) : (
                  <Globe className="w-4 h-4 text-gray-400" aria-hidden="true" />
                )}
                <span className="font-medium text-gray-900">{model.label}</span>
              </div>
              {model.description && (
                <div className="text-xs text-gray-600 mt-1">
                  {model.description}
                </div>
              )}
            </div>
            {selectedModel === model.value && (
              <span className="text-xs text-primary bg-accent px-2 py-1 rounded-full font-medium">
                ✓ Selected
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

export default UnifiedModelPickerCompact;
