import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerX402Routes } from './x402/index.js';
import { registerAgentRoutes } from './agents/routes.js';

const config = loadConfig();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

registerHealthRoutes(app);
registerX402Routes(app, config);
registerAgentRoutes(app);

app.listen(config.port, () => {
  console.info(`[server] listening on :${config.port}`);
  console.info(`[server] x402 network: ${config.x402.network}`);
  console.info(`[server] facilitator: ${config.x402.facilitatorUrl}`);
});
