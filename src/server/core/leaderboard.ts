import { redis } from '@devvit/web/server';
import {
  LEADERBOARD_REDIS_KEY,
  LOCATION_KEYS_REDIS_KEY,
} from '../../shared/messages';

export async function saveHighscore(
  member: string,
  score: number
): Promise<void> {
  await redis.zAdd(LEADERBOARD_REDIS_KEY, { member, score });
}

export async function saveLocationKey(key: string): Promise<void> {
  await redis.zAdd(LOCATION_KEYS_REDIS_KEY, {
    member: key,
    score: Date.now(),
  });
}

export async function getHighscoreRank(
  member: string
): Promise<number | undefined> {
  const rank = await redis.zRank(LEADERBOARD_REDIS_KEY, member);
  if (rank === undefined || rank === null) {
    return undefined;
  }
  return rank;
}
