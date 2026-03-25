/**
 * Temporal schedule management for daily Sisyphus shifts.
 *
 * Creates (or updates) a Temporal Schedule that starts the
 * sisyphusShiftWorkflow every day at BUSINESS_HOURS_START.
 * The schedule is idempotent — safe to call on every startup.
 */

import type { Client } from "@temporalio/client";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("shift:scheduler");

/** Stable schedule ID — only one schedule for the daily shift. */
const SCHEDULE_ID = "sisyphus-daily-shift";

/** Workflow ID for shift executions — Temporal deduplicates by this. */
const SHIFT_WORKFLOW_ID = "sisyphus-shift";

/**
 * Create or update the Temporal schedule for daily Sisyphus shifts.
 *
 * The schedule starts sisyphusShiftWorkflow every day at BUSINESS_HOURS_START
 * in the configured BUSINESS_TIMEZONE. If the schedule already exists, it is
 * updated in place (idempotent).
 *
 * @param client - Connected Temporal Client
 */
export async function createShiftSchedule(client: Client): Promise<void> {
  const { BUSINESS_HOURS_START, BUSINESS_TIMEZONE, TEMPORAL_TASK_QUEUE } = env;

  const [startHour, startMinute] = BUSINESS_HOURS_START.split(":").map(Number);

  log.info(
    {
      scheduleId: SCHEDULE_ID,
      startTime: BUSINESS_HOURS_START,
      timezone: BUSINESS_TIMEZONE,
      taskQueue: TEMPORAL_TASK_QUEUE,
    },
    "Creating/updating shift schedule",
  );

  // Check if the schedule already exists
  try {
    const existing = client.schedule.getHandle(SCHEDULE_ID);
    // Try to describe it — if it doesn't exist, this throws
    await existing.describe();

    // Schedule exists — update it
    log.info({ scheduleId: SCHEDULE_ID }, "Schedule already exists, updating");

    await existing.update((prev) => ({
      ...prev,
      spec: {
        calendars: [
          {
            // Every day of the week
            dayOfWeek: "*",
            hour: startHour,
            minute: startMinute,
            comment: `Daily Sisyphus shift at ${BUSINESS_HOURS_START} ${BUSINESS_TIMEZONE}`,
          },
        ],
        jitter: "5m",
      },
      action: {
        type: "startWorkflow" as const,
        workflowType: "sisyphusShiftWorkflow",
        workflowId: SHIFT_WORKFLOW_ID,
        taskQueue: TEMPORAL_TASK_QUEUE,
        args: [false, 0], // isResuming=false, cyclesSoFar=0
      },
    }));

    log.info({ scheduleId: SCHEDULE_ID }, "Shift schedule updated");
    return;
  } catch {
    // Schedule doesn't exist — create it
    log.info({ scheduleId: SCHEDULE_ID }, "Schedule not found, creating new");
  }

  // Create the schedule
  await client.schedule.create({
    scheduleId: SCHEDULE_ID,
    spec: {
      calendars: [
        {
          dayOfWeek: "*",
          hour: startHour,
          minute: startMinute,
          comment: `Daily Sisyphus shift at ${BUSINESS_HOURS_START} ${BUSINESS_TIMEZONE}`,
        },
      ],
      jitter: "5m",
    },
    action: {
      type: "startWorkflow" as const,
      workflowType: "sisyphusShiftWorkflow",
      workflowId: SHIFT_WORKFLOW_ID,
      taskQueue: TEMPORAL_TASK_QUEUE,
      args: [false, 0], // isResuming=false, cyclesSoFar=0
    },
  });

  log.info(
    {
      scheduleId: SCHEDULE_ID,
      startHour,
      startMinute,
      timezone: BUSINESS_TIMEZONE,
    },
    "Shift schedule created successfully",
  );
}
