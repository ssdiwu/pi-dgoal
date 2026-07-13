// Pi extension composition root. Runtime behavior lives under src/.
import { registerDgoal } from "./src/runtime/index.ts";

export * from "./src/runtime/index.ts";
export default registerDgoal;
