import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorMessage, NotFoundError } from '../../lib/errors.js';
import { runChatTurn, streamChatTurn, type ChatTurnOptions } from '../../modules/chat/chatService.js';
import { startSSE } from '../../modules/chat/streaming.js';
import { conversationRepo } from '../../repos/conversationRepo.js';
import { messageRepo } from '../../repos/messageRepo.js';
import { requireContext } from './helpers.js';

const chatSchema = z.object({
  conversationId: z.string().min(1).max(100).optional(),
  message: z.string().min(1).max(8000),
  model: z.string().min(1).max(100).optional(),
});

function optionsFrom(body: z.infer<typeof chatSchema>): ChatTurnOptions {
  return body.model ? { model: body.model } : {};
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    const body = chatSchema.parse(request.body);
    return runChatTurn(body.conversationId, body.message, ctx, optionsFrom(body));
  });

  app.post('/chat/stream', { onRequest: [app.authenticate] }, async (request, reply) => {
    const ctx = requireContext(request);
    const body = chatSchema.parse(request.body);
    const sse = startSSE(reply);
    try {
      await streamChatTurn(body.conversationId, body.message, ctx, sse, optionsFrom(body));
    } catch (err) {
      sse.send('error', { message: errorMessage(err) });
    } finally {
      sse.close();
    }
  });

  app.get('/chat/conversations', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    const conversations = await conversationRepo.listForUser(ctx);
    return { conversations };
  });

  app.get<{ Params: { id: string } }>(
    '/chat/conversations/:id/messages',
    { onRequest: [app.authenticate] },
    async (request) => {
      const ctx = requireContext(request);
      const conversation = await conversationRepo.findOwned(ctx, request.params.id);
      if (!conversation) throw new NotFoundError('Conversation not found');
      const messages = await messageRepo.listByConversation(ctx, conversation.id, { limit: 200 });
      return { conversation, messages };
    },
  );
}
