import { Hono } from 'hono';
import {
  isClientMessage,
  type ServerMessage,
} from '../../shared/messages';
import { handleWebViewMessage } from '../core/webViewMessages';

export const messages = new Hono();

messages.post('/', async (c) => {
  try {
    const body: unknown = await c.req.json();

    if (!isClientMessage(body)) {
      return c.json<ServerMessage>(
        { type: 'error', message: 'Invalid message payload' },
        400
      );
    }

    const response = await handleWebViewMessage(body);
    const status = response.type === 'error' ? 400 : 200;
    return c.json(response, status);
  } catch (error) {
    console.error('WebView message handler error:', error);
    return c.json<ServerMessage>(
      { type: 'error', message: 'Failed to process message' },
      500
    );
  }
});
