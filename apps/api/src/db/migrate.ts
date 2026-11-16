import { loadEnv } from '../env';
import { createDb } from './index';

const env = loadEnv();
const handle = createDb(env.databaseUrl);
await handle.migrate();
console.log(`[db] migrations applied (${handle.kind})`);
await handle.close();
