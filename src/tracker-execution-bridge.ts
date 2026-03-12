import { executionManager, type ExecutionInfo } from "./execution-manager.js";
import { trackerManager } from "./tracker-manager.js";
import { sessionNamesManager } from "./session-names-manager.js";
import { query } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

type PlanAction = "plan" | "execute" | "review";

interface PlanMapping {
  planId: string;
  itemCode: string;
  action: PlanAction;
}

const planExecutionMap = new Map<string, PlanMapping>();

export function registerPlanExecution(execId: string, planId: string, itemCode: string, action: PlanAction): void {
  planExecutionMap.set(execId, { planId, itemCode, action });
}

export async function initTrackerExecutionBridge(): Promise<void> {
  await recoverStalePlans();

  executionManager.on("complete", async (execId: string, info: ExecutionInfo) => {
    const mapping = planExecutionMap.get(execId);
    if (!mapping) return;
    planExecutionMap.delete(execId);

    const sessionId = info.result?.sessionId;

    if (mapping.action === "plan" || mapping.action === "review") {
      const updates: Parameters<typeof trackerManager.updateItemPlan>[1] = {
        status: "planned",
        lastExecutionId: execId,
      };

      if (sessionId) {
        updates.sessionId = sessionId;
        if (mapping.itemCode) {
          sessionNamesManager.setName(sessionId, mapping.itemCode);
        }
      }

      if (info.result?.output) {
        updates.planMarkdown = info.result.output;
      }

      updates.pendingQuestions = info.pendingQuestion?.questions ?? null;

      await trackerManager.updateItemPlan(mapping.planId, updates).catch((err) => {
        console.error("[tracker-bridge] Failed to update plan:", err);
      });
    } else if (mapping.action === "execute") {
      await trackerManager.updateItemPlan(mapping.planId, {
        status: "completed",
        lastExecutionId: execId,
      }).catch((err) => {
        console.error("[tracker-bridge] Failed to update plan:", err);
      });
    }
  });

  executionManager.on("error", async (execId: string, _info: ExecutionInfo, _message: string) => {
    const mapping = planExecutionMap.get(execId);
    if (!mapping) return;
    planExecutionMap.delete(execId);

    await trackerManager.updateItemPlan(mapping.planId, {
      status: "error",
      lastExecutionId: execId,
    }).catch((err) => {
      console.error("[tracker-bridge] Failed to update plan on error:", err);
    });
  });
}

async function recoverStalePlans(): Promise<void> {
  try {
    const staleStatuses = ["planning", "executing", "reviewing"];
    const rows = await query<RowDataPacket[]>(
      `SELECT id, status FROM tracker_item_plans WHERE status IN (?, ?, ?)`,
      staleStatuses,
    );
    for (const row of rows) {
      await trackerManager.updateItemPlan(row.id, { status: "error" }).catch(() => {});
      console.log(`[tracker-bridge] Recovered stale plan ${row.id} (was ${row.status}) -> error`);
    }
  } catch {
    // table may not exist yet on first run
  }
}
