import { describe, expect, it } from "vitest";

import { __test__ } from "./UserMemorySettingsCard";

const { compactPreferences, readShape } = __test__;

describe("UserMemorySettingsCard helpers", () => {
  describe("compactPreferences always stamps personal_info.onboarding_seen", () => {
    it("preserves onboarding_seen even when the form is otherwise empty", () => {
      // Reaching the settings card implies the user has been through the
      // onboarding flow at least once. Whole-object PUT semantics on the
      // backend (user_memory router) mean any field absent from the payload
      // is dropped — so the save must restamp the flag every time.
      const result = compactPreferences({});
      expect(result).toEqual({ personal_info: { onboarding_seen: true } });
    });

    it("stamps onboarding_seen alongside an edited preferred_name", () => {
      const result = compactPreferences({
        personal_info: { preferred_name: "李总" },
      });
      expect(result).toEqual({
        personal_info: { preferred_name: "李总", onboarding_seen: true },
      });
    });

    it("trims whitespace and drops an empty preferred_name without losing the flag", () => {
      const result = compactPreferences({
        personal_info: { preferred_name: "   " },
      });
      expect(result).toEqual({ personal_info: { onboarding_seen: true } });
    });

    it("co-exists with response_preferences and work_style edits", () => {
      const result = compactPreferences({
        personal_info: { preferred_name: "Liang" },
        response_preferences: { language: "en", tone: "direct", format: "" },
        work_style: { ask_before_destructive: true },
      });
      expect(result).toEqual({
        personal_info: { preferred_name: "Liang", onboarding_seen: true },
        response_preferences: { language: "en", tone: "direct" },
        work_style: { ask_before_destructive: true },
      });
    });
  });

  describe("readShape", () => {
    it("loads preferred_name when present", () => {
      const shape = readShape({ personal_info: { preferred_name: "李总" } });
      expect(shape).toEqual({ personal_info: { preferred_name: "李总" } });
    });

    it("ignores empty preferred_name", () => {
      const shape = readShape({ personal_info: { preferred_name: "" } });
      expect(shape.personal_info).toBeUndefined();
    });
  });
});
