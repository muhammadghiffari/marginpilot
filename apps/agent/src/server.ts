import { buildServer } from './api/server.js';

const demoMode = process.env.DEMO_MODE === 'true';
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const app = await buildServer({ demoMode });

const close = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port, host });
// No environment values or key material are printed.
console.log(`MarginPilot listening on http://127.0.0.1:${port} (${demoMode ? 'SIMULATED demo mode' : 'demo endpoints disabled'})`);
