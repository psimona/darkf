import type { z } from "zod";
import type { OutputSchema } from "../../core/index.ts";

/**
 * Adapter from a Zod schema to the engine's `OutputSchema` interface
 * (`AgentStateDef.outputType`). Joins every issue from one failed parse
 * into a single message, so one nudge can name all failing fields.
 */
export function zodOutputType<T>(schema: z.ZodType<T>): OutputSchema {
  return {
    safeParse: (value) => {
      const result = schema.safeParse(value);
      if (result.success) return { success: true };
      const message = result.error.issues
        .map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`)
        .join("; ");
      return { success: false, message };
    },
  };
}
