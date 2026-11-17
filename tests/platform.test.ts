import { expect, it } from "vitest";
import { isWindows, keys, windowsKeys } from "../src/platform";

it("spells macOS modifier glyphs as Windows key names", () => {
  expect(windowsKeys("⌘S")).toBe("Ctrl+S");
  expect(windowsKeys("⇧⌘Z")).toBe("Ctrl+Shift+Z");
  expect(windowsKeys("⌘ / Ctrl + B")).toBe("Ctrl + B");
  expect(windowsKeys("⌘ + Z / ⇧ + ⌘ + Z")).toBe("Ctrl + Z / Ctrl + Shift + Z");
  expect(windowsKeys("⌘ + N / O / S")).toBe("Ctrl + N / O / S");
  expect(windowsKeys("Save project ⌘S")).toBe("Save project Ctrl+S");
  expect(windowsKeys("⇧ Multiselect · ⌥←/→ Nudge")).toBe("Shift Multiselect · Alt+←/→ Nudge");
});
it("only rewrites labels on Windows", () => {
  expect(keys("⇧⌘Z")).toBe(isWindows ? "Ctrl+Shift+Z" : "⇧⌘Z");
});
