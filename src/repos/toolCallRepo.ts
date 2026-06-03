import { db } from '../db/client.js';
import { toolCalls, type NewToolCall } from '../db/schema/index.js';

export const toolCallRepo = {
  /** Persist a detailed record of a dispatched tool call (args, result, status, timing). */
  async record(entry: NewToolCall): Promise<void> {
    await db.insert(toolCalls).values(entry);
  },
};
