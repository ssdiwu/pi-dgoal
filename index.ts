// Pi extension composition root. Startup owns Pi registration; runtime exports public behavior.
import { registerDgoal } from "./src/startup/index.ts";

export * from "./src/runtime/index.ts";
export { registerDgoal } from "./src/startup/index.ts";
export default registerDgoal;
