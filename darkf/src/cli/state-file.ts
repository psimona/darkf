import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** mkdir -p on the parent; best-effort — swallow write errors. Shared by
 *  `setup.ts`'s probe state and `update.ts`'s update-check state; both
 *  degrade to re-running next invocation when the location is unwritable. */
export function writeJsonState<T>(file: string, state: T): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // An unwritable state location degrades to re-probing/re-checking next invocation.
  }
}
