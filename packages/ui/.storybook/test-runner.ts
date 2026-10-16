import type { TestRunnerConfig } from "@storybook/test-runner";
import { getStoryContext } from "@storybook/test-runner";
import { injectAxe, checkA11y } from "axe-playwright";

// CI-enforcing a11y check (TASK-037). Distinct from @storybook/addon-a11y (interactive-only,
// added in TASK-035) -- this actually fails the run on a real WCAG AA violation.
const config: TestRunnerConfig = {
  async preVisit(page) {
    await injectAxe(page);
  },
  async postVisit(page, context) {
    // UI-014 (docs/ui-review/03-roadmap.md): lets one story disable a specific axe rule for
    // itself via its own `parameters.a11y.config.rules` -- never a global override here. Added
    // for dropdown-menu.stories.tsx's Open story (see its own comment for the verified reason);
    // no other story sets this today.
    const storyContext = await getStoryContext(page, context);
    const storyRules = (storyContext.parameters?.a11y?.config?.rules ?? []) as Array<{
      id: string;
      enabled: boolean;
    }>;

    await checkA11y(page, "body", {
      detailedReport: true,
      detailedReportOptions: { html: true },
      axeOptions: {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
        rules: Object.fromEntries(storyRules.map((rule) => [rule.id, { enabled: rule.enabled }])),
      },
    });
  },
};

export default config;
