import type { Express } from 'express';
import { createRequestSchema } from '@hack-fourmeme/shared';

/**
 * Agent entry routes. Filled in from Phase 2 onward with plan/execute loops.
 * Current placeholder only validates the request schema.
 */
export function registerAgentRoutes(app: Express): void {
  app.post('/agents/creator/run', (req, res) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', issues: parsed.error.issues });
      return;
    }
    res.status(501).json({
      error: 'creator agent not yet wired — Phase 2',
      theme: parsed.data.theme,
    });
  });
}
