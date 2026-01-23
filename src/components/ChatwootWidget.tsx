import { useEffect } from "react";

const chatwootToken = import.meta.env.VITE_CHATWOOT_TOKEN;
const BASE_URL = "https://app.chatwoot.com";

const ChatwootWidget = () => {
  useEffect(() => {
    if (!chatwootToken) {
      return;
    }

    if ((window as any).$chatwoot) {
      return;
    }

    (window as any).chatwootSettings = {
      hideMessageBubble: false,
      position: "right",
      locale: "en",
      type: "standard",
    };

    const script = document.createElement("script");
    script.src = `${BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if ((window as any).chatwootSDK) {
        (window as any).chatwootSDK.run({
          websiteToken: chatwootToken,
          baseUrl: BASE_URL,
        });

        window.addEventListener("chatwoot:ready", () => {
          const $chatwoot = (window as any).$chatwoot;
          if ($chatwoot) {
            $chatwoot.setCustomAttributes({
              source_app: "PPQ Voice",
              app_type: "desktop",
              platform: window.electronAPI?.getPlatform?.() || "unknown",
            });
          }
        });
      }
    };

    document.head.appendChild(script);

    return () => {
      const chatwootElements = document.querySelectorAll('[class^="woot-"]');
      chatwootElements.forEach((el) => el.remove());

      const chatwootIframes = document.querySelectorAll(
        'iframe[src*="chatwoot"]',
      );
      chatwootIframes.forEach((el) => el.remove());

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return null;
};

export default ChatwootWidget;
