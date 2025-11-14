import React from 'react';

export const DotFlashing = () => (
  <>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 16 }}>
      <div className="dot-flashing"></div>
    </div>
    <style>{`
      .dot-flashing {
        position: relative;
        width: 5px;
        height: 5px;
        border-radius: 5px;
        background-color: var(--color-muted-foreground);
        color: var(--color-muted-foreground);
        animation: dot-flashing 1s infinite linear alternate;
        animation-delay: 0.5s;
      }
      .dot-flashing::before, .dot-flashing::after {
        content: "";
        display: inline-block;
        position: absolute;
        top: 0;
      }
      .dot-flashing::before {
        left: -8px;
        width: 5px;
        height: 5px;
        border-radius: 5px;
        background-color: var(--color-muted-foreground);
        color: var(--color-muted-foreground);
        animation: dot-flashing 1s infinite alternate;
        animation-delay: 0s;
      }
      .dot-flashing::after {
        left: 8px;
        width: 5px;
        height: 5px;
        border-radius: 5px;
        background-color: var(--color-muted-foreground);
        color: var(--color-muted-foreground);
        animation: dot-flashing 1s infinite alternate;
        animation-delay: 1s;
      }
      @keyframes dot-flashing {
        0% { background-color: var(--color-muted-foreground); }
        50%, 100% { background-color: var(--color-accent); }
      }
    `}</style>
  </>
); 