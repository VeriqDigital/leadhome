export function safeTaskListReturnPath(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 1_000) {
    return "/tasks";
  }
  try {
    const url = new URL(value, "http://leadhome.local");
    if (
      url.origin !== "http://leadhome.local" ||
      url.pathname !== "/tasks"
    ) {
      return "/tasks";
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return "/tasks";
  }
}
