/** Renderer-side platform presentation. macOS and Linux keep the original labels. */
export const isWindows =
  typeof navigator !== "undefined" && /^Win/i.test(navigator.platform ?? "");

/** Rewrite macOS modifier glyphs as the key names printed on Windows keyboards. */
export function windowsKeys(label: string): string {
  return label
    .replace(/⌘ \/ Ctrl/g, "Ctrl")
    .replace(/⇧ \+ ⌘/g, "Ctrl + Shift")
    .replace(/⇧⌘/g, "Ctrl+Shift+")
    .replace(/⌘(?=[^\s+])/g, "Ctrl+")
    .replace(/⌘/g, "Ctrl")
    .replace(/⌥(?=[^\s+])/g, "Alt+")
    .replace(/⌥/g, "Alt")
    .replace(/⇧(?=[^\s+])/g, "Shift+")
    .replace(/⇧/g, "Shift");
}

export const keys = (label: string): string =>
  isWindows ? windowsKeys(label) : label;
