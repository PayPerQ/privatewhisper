const { Menu } = require("electron");

// Shared menu templates to avoid duplication
const getAppMenu = () => ({
  label: "Private Whisper",
  submenu: [
    { role: "about" },
    { type: "separator" },
    { role: "services" },
    { type: "separator" },
    { role: "hide" },
    { role: "hideOthers" },
    { role: "unhide" },
    { type: "separator" },
    { role: "quit", label: "Quit Private Whisper" },
  ],
});

const getEditMenuBase = () => [
  { role: "undo" },
  { role: "redo" },
  { type: "separator" },
  { role: "cut" },
  { role: "copy" },
  { role: "paste" },
];

const getEditMenu = ({
  includePasteAndMatchStyle = false,
  includeSpeech = false,
} = {}) => ({
  label: "Edit",
  submenu: [
    ...getEditMenuBase(),
    ...(includePasteAndMatchStyle ? [{ role: "pasteAndMatchStyle" }] : []),
    { role: "delete" },
    { role: "selectAll" },
    ...(includeSpeech
      ? [
          { type: "separator" },
          {
            label: "Speech",
            submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
          },
        ]
      : []),
  ],
});

const getViewMenu = () => ({
  label: "View",
  submenu: [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ],
});

class MenuManager {
  static setupMainMenu() {
    if (process.platform === "darwin") {
      const template = [
        getAppMenu(),
        getEditMenu({ includePasteAndMatchStyle: true }),
      ];
      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
    }
  }

  static setupControlPanelMenu(controlPanelWindow) {
    if (process.platform === "darwin") {
      const template = [
        getAppMenu(),
        getEditMenu({ includePasteAndMatchStyle: true, includeSpeech: true }),
        getViewMenu(),
        {
          label: "Window",
          submenu: [
            { role: "minimize" },
            { role: "close" },
            { type: "separator" },
            { role: "front" },
            { type: "separator" },
            { role: "window" },
          ],
        },
        {
          label: "Help",
          submenu: [
            {
              label: "Learn More",
              click: async () => {
                const { shell } = require("electron");
                await shell.openExternal(
                  "https://github.com/PayPerQ/ppq-voice",
                );
              },
            },
          ],
        },
      ];

      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
    } else {
      // For Windows/Linux, keep the window-specific menu
      const template = [
        {
          label: "File",
          submenu: [{ role: "close", label: "Close Window" }],
        },
        {
          label: "Edit",
          submenu: [
            ...getEditMenuBase(),
            { type: "separator" },
            { role: "selectAll" },
          ],
        },
        getViewMenu(),
      ];

      const menu = Menu.buildFromTemplate(template);
      controlPanelWindow.setMenu(menu);
    }
  }
}

module.exports = MenuManager;
