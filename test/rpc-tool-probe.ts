import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PREFIX = "PI_DGOAL_RPC_TOOLS:";

export default function rpcToolProbe(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const names = pi.getAllTools().map((tool) => tool.name).sort();
    ctx.ui.notify(`${PREFIX}${JSON.stringify(names)}`, "info");
  });
}
