import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (
      extname(entry.name) !== ".tsx" ||
      entry.name.includes(".test.")
    ) {
      return [];
    }
    return [path];
  });
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string) {
  const values = [relativeLuminance(first), relativeLuminance(second)]
    .sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("primary action contrast contract", () => {
  it("defines inseparable high-contrast colors for both themes", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(
      /\.action-primary\s*\{[^}]*background: #17181c !important;[^}]*color: #ffffff !important;[^}]*-webkit-text-fill-color: #ffffff !important;/,
    );
    expect(css).toMatch(
      /\.dark \.action-primary\s*\{[^}]*background: #5148b8 !important;[^}]*color: #ffffff !important;[^}]*-webkit-text-fill-color: #ffffff !important;/,
    );
    expect(contrastRatio("#17181c", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#5148b8", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#6259cb", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("rejects the fragile white-background plus white-text dark-mode pattern", () => {
    const violations = productionTsxFiles(join(process.cwd(), "app"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split(/\r?\n/)
          .map((line, index) => ({ path, line, number: index + 1 })),
      )
      .filter(({ line }) =>
        line.includes("text-white") &&
        /dark:!?bg-(?:white|neutral-100)(?:\s|$)/.test(line),
      )
      .map(({ path, number }) => `${path}:${number}`);

    expect(violations).toEqual([]);
  });
});
