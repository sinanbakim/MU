import { reddit } from '@devvit/web/server';
import type { ClientMessage, ServerMessage } from '../../shared/messages';
import {
  getHighscoreRank,
  saveHighscore,
  saveLocationKey,
} from './leaderboard';

/**
 * Devvit-Web-Äquivalent zu `context.ui.webView.onMessage`.
 * Verarbeitet eingehende Client-Nachrichten (Highscores, Orts-Keys).
 */
export async function handleWebViewMessage(
  message: ClientMessage
): Promise<ServerMessage> {
  switch (message.type) {
    case 'highscore': {
      if (message.score < 0) {
        return { type: 'error', message: 'Score must be non-negative' };
      }

      const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
      await saveHighscore(username, message.score);

      const rank = await getHighscoreRank(username);
      return {
        type: 'ack',
        kind: 'highscore',
        message: 'Highscore saved',
        ...(rank !== undefined ? { rank: rank + 1 } : {}),
      };
    }

    case 'locationKey': {
      const key = message.key.trim();
      if (key.length === 0) {
        return { type: 'error', message: 'Location key must not be empty' };
      }

      await saveLocationKey(key);
      return {
        type: 'ack',
        kind: 'locationKey',
        message: 'Location key recorded',
      };
    }
  }
}
