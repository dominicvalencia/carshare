import { describe, expect, it } from 'vitest';
import { parseRedisConnection } from './redis-connection';

describe('BullMQ Redis connection configuration', () => {
  it('parses secure provider URLs without leaking credentials into logs', () => {
    expect(parseRedisConnection('rediss://worker:secret@redis.example.test:6380/2')).toEqual({
      db: 2,
      host: 'redis.example.test',
      password: 'secret',
      port: 6380,
      tls: {},
      username: 'worker',
    });
  });
});
