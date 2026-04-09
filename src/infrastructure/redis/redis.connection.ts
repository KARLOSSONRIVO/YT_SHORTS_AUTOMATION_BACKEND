import IORedis from "ioredis";

export const createRedisConnection = (redisUrl: string): IORedis => {
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
};
