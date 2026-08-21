import type { ConnectionOptions } from 'bullmq';

export function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;

  if (!Number.isInteger(database) || database < 0) {
    throw new Error('REDIS_URL contains an invalid database number.');
  }

  return {
    db: database,
    host: parsed.hostname,
    password: parsed.password || undefined,
    port: parsed.port ? Number(parsed.port) : 6379,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    username: parsed.username || undefined,
  };
}
