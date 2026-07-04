import { Hono } from 'hono';
import { messages } from './messages';

export const api = new Hono();

api.route('/message', messages);
