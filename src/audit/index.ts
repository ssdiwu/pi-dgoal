// Audit-domain helpers that do not depend on Goal Runtime or Pi process state.

export const APPROVED_MARKER = "<APPROVED>";
export const REJECTED_MARKER = "<REJECTED>";

export function parseAuditorDecision(output: string): boolean {
  if (!output) return false;
  return output.includes(APPROVED_MARKER) && !output.includes(REJECTED_MARKER);
}

export function summarizeCheckProgress(output: string, emptyText: string): string {
  const trimmed = output.trim();
  if (!trimmed) return emptyText;
  return trimmed.length > 4000 ? `${trimmed.slice(0, 3999)}…` : trimmed;
}

export function extractUserReviewSuggestions(output: string): string[] {
  const match = output.match(/(?:^|\n)##\s*(?:建议用户复核|用户复核|User review)(?:（不阻塞完成）|\s*\(non-blocking\))?[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean);
}

// vNext 终审归因：从 <REJECTED> 标记解析失败主要归各哪一层。
// <REJECTED phase="3"> → 重开 phase 3；<REJECTED goal> → goal 级修复；<REJECTED user_review> → 仅记录用户复核。
export type FinalAuditAttribution =
  | { kind: "phase"; phaseId: number }
  | { kind: "goal" }
  | { kind: "user_review" };

export function parseFinalAuditAttribution(output: string): FinalAuditAttribution {
  if (!output) return { kind: "goal" };
  const phaseMatch = output.match(/<REJECTED\s+phase\s*=\s*["']?(\d+)["']?\s*>/i);
  if (phaseMatch) {
    const phaseId = parseInt(phaseMatch[1], 10);
    if (Number.isFinite(phaseId) && phaseId > 0) return { kind: "phase", phaseId };
  }
  if (/<REJECTED\s+user_review\s*>/i.test(output)) return { kind: "user_review" };
  if (/<REJECTED\s+goal\s*>/i.test(output)) return { kind: "goal" };
  return { kind: "goal" };
}
