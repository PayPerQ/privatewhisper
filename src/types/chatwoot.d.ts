declare global {
  interface Window {
    chatwootSDK: {
      run: (config: { websiteToken: string; baseUrl: string }) => void;
    };
    chatwootSettings: {
      hideMessageBubble?: boolean;
      position?: "left" | "right";
      locale?: string;
      type?: "standard" | "expanded_bubble";
    };
    $chatwoot: {
      toggle: () => void;
      show: () => void;
      hide: () => void;
      setUser: (
        id: string,
        userData: { email?: string; name?: string },
      ) => void;
    };
  }
}

export {};
