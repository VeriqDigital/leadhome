import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  state: undefined as unknown,
  action: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initializer: unknown) => {
      if (hooks.state === undefined) {
        hooks.state =
          typeof initializer === "function"
            ? (initializer as () => unknown)()
            : initializer;
      }
      const setState = (next: unknown) => {
        hooks.state =
          typeof next === "function"
            ? (next as (current: unknown) => unknown)(hooks.state)
            : next;
      };
      return [hooks.state, setState];
    },
    useActionState: () => [{}, hooks.action, false],
    useTransition: () => [
      false,
      (callback: () => void) => {
        callback();
      },
    ],
  };
});

import { LeadForm } from "./lead-form";

type ElementLike = {
  type?: unknown;
  props?: Record<string, unknown>;
};

function flattenElements(node: unknown): ElementLike[] {
  if (Array.isArray(node)) return node.flatMap(flattenElements);
  if (!node || typeof node !== "object") return [];
  const element = node as ElementLike;
  return [
    element,
    ...flattenElements(element.props?.children),
  ];
}

const lead = {
  name: "Jane",
  company: "Acme",
  email: "jane@example.com",
  phone: "",
  source: "MANUAL" as const,
  status: "CONTACTED" as const,
  estimatedValue: "",
  nextFollowUp: "2026-08-12",
  message: "",
};

const action = vi.fn(async () => ({}));

beforeEach(() => {
  hooks.state = undefined;
  hooks.action.mockReset();
  action.mockReset();
});

describe("LeadForm persisted follow-up rerender", () => {
  it("updates the persisted date under the same component identity without losing an editable draft", () => {
    const firstRender = flattenElements(
      LeadForm({ action, lead, submitLabel: "Save changes" }),
    );
    const nameField = firstRender.find(
      (element) => element.props?.name === "name",
    );
    const firstFollowUp = firstRender.find(
      (element) => element.props?.name === "nextFollowUp",
    );

    expect(nameField?.props?.value).toBe("Jane");
    expect(firstFollowUp?.props?.value).toBe("2026-08-12");

    (nameField?.props?.onChange as (value: string) => void)("Unsaved name");

    const secondRender = flattenElements(
      LeadForm({
        action,
        lead: { ...lead, nextFollowUp: "2026-08-20" },
        submitLabel: "Save changes",
      }),
    );
    const rerenderedName = secondRender.find(
      (element) => element.props?.name === "name",
    );
    const rerenderedFollowUp = secondRender.find(
      (element) => element.props?.name === "nextFollowUp",
    );

    expect(rerenderedName?.props?.value).toBe("Unsaved name");
    expect(rerenderedFollowUp?.props?.value).toBe("2026-08-20");
  });
});
