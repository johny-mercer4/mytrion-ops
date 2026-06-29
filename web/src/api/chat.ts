/** Conversation session CRUD (the /v1/chat/conversations endpoints). Streaming lives in stream.ts. */
import { request } from './transport';

export interface ToolSummary {
  name: string;
  status: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  messageCount: number;
  departmentScope: string | string[] | null;
  createdAt: string;
  lastMessageAt: string;
}

export interface ConversationFull extends ConversationSummary {
  zohoUserId: string | null;
  userName: string | null;
  profile: string | null;
  role: string | null;
  updatedAt: string;
}

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ragPassages: number | null;
  tools: ToolSummary[];
  error: string | null;
  createdAt: string;
}

export interface CreateConversationInput {
  zohoUserId: string;
  userName?: string;
  profile?: string;
  role?: string;
  title?: string;
  departmentScope?: string | string[] | null;
}

export async function listConversations(
  zohoUserId: string,
  page: { limit?: number; offset?: number } = {},
): Promise<{ conversations: ConversationSummary[]; total: number }> {
  const data = await request('GET', '/chat/conversations', {
    query: { zoho_user_id: zohoUserId, limit: page.limit ?? 30, offset: page.offset ?? 0 },
  });
  return data as { conversations: ConversationSummary[]; total: number };
}

export async function createConversation(input: CreateConversationInput): Promise<ConversationFull> {
  const body: Record<string, unknown> = {
    zoho_user_id: input.zohoUserId,
    user_name: input.userName,
    profile: input.profile,
    role: input.role,
  };
  if (input.title) body.title = input.title;
  if (input.departmentScope != null) body.department_scope = input.departmentScope;
  const data = await request('POST', '/chat/conversations', { body });
  return (data as { conversation: ConversationFull }).conversation;
}

export async function getConversation(
  id: string,
  zohoUserId: string,
): Promise<{ conversation: ConversationFull; messages: TranscriptMessage[] }> {
  const data = await request('GET', `/chat/conversations/${encodeURIComponent(id)}`, {
    query: { zoho_user_id: zohoUserId },
  });
  return data as { conversation: ConversationFull; messages: TranscriptMessage[] };
}

export async function renameConversation(id: string, zohoUserId: string, title: string): Promise<void> {
  await request('POST', `/chat/conversations/${encodeURIComponent(id)}`, {
    body: { zoho_user_id: zohoUserId, title },
  });
}

export async function deleteConversation(id: string, zohoUserId: string): Promise<void> {
  await request('POST', `/chat/conversations/${encodeURIComponent(id)}/delete`, {
    body: { zoho_user_id: zohoUserId },
  });
}
