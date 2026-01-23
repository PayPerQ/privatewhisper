import { useEffect } from 'react';

// Get the Chatwoot token from Vite environment variables
const chatwootToken = import.meta.env.VITE_CHATWOOT_TOKEN;
const BASE_URL = 'https://app.chatwoot.com';

/**
 * ChatwootWidget - Loads the Chatwoot support chat widget
 *
 * This component injects the Chatwoot SDK script and initializes the widget
 * with the configured token. The widget appears as a floating chat bubble
 * in the bottom-right corner.
 */
const ChatwootWidget = () => {
  useEffect(() => {
    console.log('[Chatwoot] Initializing with token:', chatwootToken ? 'present' : 'missing');

    if (!chatwootToken) {
      console.warn('[Chatwoot] Token not configured. Set VITE_CHATWOOT_TOKEN in .env');
      return;
    }

    // Check if already loaded
    if ((window as any).$chatwoot) {
      console.log('[Chatwoot] Already loaded');
      return;
    }

    // Chatwoot Settings - must be set before loading the script
    (window as any).chatwootSettings = {
      hideMessageBubble: false,
      position: 'right',
      locale: 'en',
      type: 'standard',
    };

    // Create and inject the script
    const script = document.createElement('script');
    script.src = `${BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      console.log('[Chatwoot] SDK script loaded');
      if ((window as any).chatwootSDK) {
        (window as any).chatwootSDK.run({
          websiteToken: chatwootToken,
          baseUrl: BASE_URL,
        });
        console.log('[Chatwoot] SDK initialized');

        // Wait for widget to be ready, then set custom attributes
        window.addEventListener('chatwoot:ready', () => {
          const $chatwoot = (window as any).$chatwoot;
          if ($chatwoot) {
            // Set custom attributes on the contact to identify the source
            $chatwoot.setCustomAttributes({
              source_app: 'PPQ Voice',
              app_type: 'desktop',
              platform: window.electronAPI?.getPlatform?.() || 'unknown',
            });

            console.log('[Chatwoot] Custom attributes set');
          }
        });
      } else {
        console.error('[Chatwoot] SDK not available after script load');
      }
    };

    script.onerror = (error) => {
      console.error('[Chatwoot] Failed to load SDK script:', error);
    };

    document.head.appendChild(script);

    // Cleanup on unmount
    return () => {
      const chatwootElements = document.querySelectorAll('[class^="woot-"]');
      chatwootElements.forEach(el => el.remove());

      const chatwootIframes = document.querySelectorAll('iframe[src*="chatwoot"]');
      chatwootIframes.forEach(el => el.remove());

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return null;
};

export default ChatwootWidget;
