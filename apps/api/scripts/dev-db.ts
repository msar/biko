// Postgres embebido para desarrollo local sin Docker.
// Uso: npm run dev:db --workspace @biko/api  (deja el server corriendo)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(import.meta.dirname, '../../../.postgres-data/embedded');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'biko',
  password: 'biko',
  port: 5433,
  persistent: true,
});

const alreadyInitialized = existsSync(path.join(dataDir, 'PG_VERSION'));
if (!alreadyInitialized) {
  await pg.initialise();
}
await pg.start();
if (!alreadyInitialized) {
  await pg.createDatabase('biko');
}
console.log('Postgres embebido listo en postgresql://biko:biko@localhost:5433/biko');

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
