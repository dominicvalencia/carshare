import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const compose = parse(readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8'));
const requiredServices = ['postgres', 'redis'];

for (const serviceName of requiredServices) {
  const service = compose?.services?.[serviceName];
  if (service === undefined) {
    throw new Error(`Docker Compose is missing the ${serviceName} service.`);
  }
  if (service.healthcheck?.test === undefined) {
    throw new Error(`Docker Compose service ${serviceName} is missing a health check.`);
  }
  if (service.restart !== 'unless-stopped') {
    throw new Error(`Docker Compose service ${serviceName} must use the local restart policy.`);
  }
}

if (compose.volumes?.carrental_postgres_data === undefined) {
  throw new Error('Docker Compose is missing the PostgreSQL persistent volume.');
}

if (compose.volumes?.carrental_redis_data === undefined) {
  throw new Error('Docker Compose is missing the Redis persistent volume.');
}

process.stdout.write('Docker Compose foundation structure is valid.\n');
