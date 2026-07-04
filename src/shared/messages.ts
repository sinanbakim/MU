export type HighscoreMessage = {
  type: 'highscore';
  score: number;
};

export type LocationKeyMessage = {
  type: 'locationKey';
  key: string;
};

export type ClientMessage = HighscoreMessage | LocationKeyMessage;

export type AckMessage = {
  type: 'ack';
  kind: 'highscore' | 'locationKey';
  message: string;
  rank?: number;
};

export type ErrorMessage = {
  type: 'error';
  message: string;
};

export type ServerMessage = AckMessage | ErrorMessage;

export const LEADERBOARD_REDIS_KEY = 'mucaching:leaderboard';
export const LOCATION_KEYS_REDIS_KEY = 'mucaching:location-keys';

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;

  if (message.type === 'highscore') {
    return typeof message.score === 'number' && Number.isFinite(message.score);
  }

  if (message.type === 'locationKey') {
    return typeof message.key === 'string';
  }

  return false;
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;
  return message.type === 'ack' || message.type === 'error';
}
