/**
 * Creator phase wiring for the a2a orchestrator.
 *
 * Builds the four Creator tools (narrative, image+Pinata, lore, four.meme
 * deployer), invokes `runCreatorAgent`, then translates the agent's tool
 * traces into the dashboard artifact stream:
 *   - lore-cid (author='creator') from lore_writer's pinned IPFS hash
 *   - meme-image from meme_image_creator's ImageOutput (status + cid +
 *     gatewayUrl + prompt). The dashboard renders a thumbnail when status='ok'
 *     and a placeholder card when status='upload-failed'.
 *
 * The bsc-token + token-deploy-tx artifacts are emitted by the orchestrator
 * itself (see runA2ADemo) so both the dry-run fallback and the real Creator
 * path share the same emission logic.
 *
 * Why a separate module: keeps `a2a.ts` focused on phase orchestration and
 * lets us unit-test the agent → artifact translation in isolation later.
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { PinataSDK } from 'pinata';
import { runCreatorAgent } from '../agents/creator.js';
import { ToolRegistry } from '../tools/registry.js';
import { createNarrativeTool } from '../tools/narrative.js';
import { createImageTool, type ImageOutput } from '../tools/image.js';
import { createLoreTool, type LoreOutput } from '../tools/lore.js';
import { createOnchainDeployerTool } from '../tools/deployer.js';
import type { RunCreatorPhaseFn } from './a2a.js';

// OpenRouter Anthropic-compatible gateway base — the SDK appends /v1/messages.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
const MODEL = 'anthropic/claude-sonnet-4-5';

/**
 * Find the most recent successful tool-call output in `toolCalls` whose
 * `name` matches the given tool name. Returns undefined if no successful call
 * exists. Used to pull tool-specific artifact data (image cid, lore cid)
 * back out of the agent loop trace without re-running anything.
 */
function findToolOutput(
  toolCalls: ReadonlyArray<{ name: string; output: unknown; isError: boolean }>,
  name: string,
): unknown | undefined {
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const call = toolCalls[i];
    if (call && call.name === name && !call.isError) return call.output;
  }
  return undefined;
}

export const runCreatorPhase: RunCreatorPhaseFn = async (deps) => {
  const { config, store, runId, theme } = deps;

  // Cross-check secrets that the Creator phase needs but a2a's outer guard
  // does not enforce (BSC deployer key + Google API key live outside the
  // shared core). We fail fast here rather than mid-loop.
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
  if (openrouterKey.trim() === '') {
    throw new Error('runCreatorPhase: OPENROUTER_API_KEY missing');
  }
  if (config.pinata.jwt === undefined) {
    throw new Error('runCreatorPhase: PINATA_JWT missing');
  }
  const googleKey = process.env.GOOGLE_API_KEY?.trim();
  if (googleKey === undefined || googleKey === '') {
    throw new Error('runCreatorPhase: GOOGLE_API_KEY missing (required for meme image generation)');
  }
  const bscDeployerKey = config.wallets.bscDeployer.privateKey;
  if (bscDeployerKey === undefined) {
    throw new Error('runCreatorPhase: BSC_DEPLOYER_PRIVATE_KEY missing');
  }

  // Build a Creator-local Anthropic client pinned to OpenRouter so the phase
  // does not assume the outer `deps.anthropic` is already routed through it.
  // (The outer client may be shared with other phases that don't care.)
  const anthropic = new Anthropic({ apiKey: openrouterKey, baseURL: OPENROUTER_BASE_URL });
  const gemini = new GoogleGenAI({ apiKey: googleKey });
  const pinata = new PinataSDK({
    pinataJwt: config.pinata.jwt,
    pinataGateway: 'gateway.pinata.cloud',
  });

  const registry = new ToolRegistry();
  registry.register(createNarrativeTool({ client: anthropic, model: MODEL }));
  registry.register(createImageTool({ client: gemini, pinata }));
  registry.register(createLoreTool({ anthropic, pinata, model: MODEL }));
  registry.register(createOnchainDeployerTool({ privateKey: bscDeployerKey as `0x${string}` }));

  const { result, loop } = await runCreatorAgent({
    client: anthropic,
    registry,
    theme,
    model: MODEL,
    onLog: (event) => store.addLog(runId, event),
  });

  // ─── Translate tool traces → dashboard artifacts ────────────────────────
  // meme-image: pull the ImageOutput shape out of the most recent successful
  // meme_image_creator call. Both 'ok' and 'upload-failed' carry the prompt
  // so the dashboard can show context even when Pinata is down.
  const imageOut = findToolOutput(loop.toolCalls, 'meme_image_creator') as ImageOutput | undefined;
  if (imageOut !== undefined) {
    if (imageOut.status === 'ok' && imageOut.cid !== null && imageOut.gatewayUrl !== null) {
      store.addArtifact(runId, {
        kind: 'meme-image',
        status: 'ok',
        cid: imageOut.cid,
        gatewayUrl: imageOut.gatewayUrl,
        prompt: imageOut.prompt,
      });
    } else {
      store.addArtifact(runId, {
        kind: 'meme-image',
        status: 'upload-failed',
        cid: null,
        gatewayUrl: null,
        prompt: imageOut.prompt,
        errorMessage: imageOut.errorMessage ?? 'unknown pinata error',
      });
    }
  }

  // lore-cid (author='creator'): pulled from the lore_writer tool result so
  // the cid/gatewayUrl matches what the writer pinned, not what the agent's
  // final JSON parrots back (defensive — they should match but the trace is
  // the source of truth).
  const loreOut = findToolOutput(loop.toolCalls, 'lore_writer') as LoreOutput | undefined;
  if (loreOut !== undefined) {
    store.addArtifact(runId, {
      kind: 'lore-cid',
      cid: loreOut.ipfsCid,
      gatewayUrl: loreOut.gatewayUrl,
      author: 'creator',
      label: 'Creator lore chapter',
    });
  }

  return {
    tokenAddr: result.tokenAddr,
    tokenName: result.metadata.name,
    tokenSymbol: result.metadata.symbol,
    tokenDeployTx: result.tokenDeployTx,
  };
};
