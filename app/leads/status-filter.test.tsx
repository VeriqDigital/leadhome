import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusFilter } from "./status-filter";

describe("lead dropdown filter", () => {
  it("supports named sort fields with readable dark-mode pointer controls", () => {
    const html = renderToStaticMarkup(
      <StatusFilter
        name="sort"
        defaultValue="updated-desc"
        options={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "updated-asc", label: "Oldest updated" },
        ]}
      />,
    );

    expect(html).toContain('name="sort"');
    expect(html).toContain("Recently updated");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("dark:bg-transparent");
  });
});
