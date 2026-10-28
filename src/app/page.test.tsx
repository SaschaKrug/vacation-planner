import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/render";

import de from "../../messages/de.json";
import HomePage from "./page";

describe("HomePage", () => {
  it("is a synchronous function, so no route fallback can become reachable", () => {
    // The page calls useTranslations(), so it cannot be invoked bare outside a
    // provider; an `async` page would show up as an AsyncFunction instead.
    expect(HomePage.constructor.name).toBe("Function");
  });

  it("renders from the catalog, not from literals", () => {
    const { container } = renderWithProviders(<HomePage />, { locale: "de" });

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.textContent).toContain(de.home.building);
  });
});
