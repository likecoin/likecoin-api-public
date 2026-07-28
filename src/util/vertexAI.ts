import type { GoogleGenAI } from '@google/genai' with { 'resolution-mode': 'import' };

import { VERTEX_AI_PROJECT_ID, VERTEX_AI_REGION } from '../../config/config';
import serviceAccount from '../../config/serviceAccountKey.json';

// @google/genai is ESM-only to tsc, so it must be loaded via dynamic import;
// lazy construction also keeps dev/test runs from opening a network connection.
// Cache the promise, not the client: concurrent first callers would otherwise
// each await the import and construct their own instance.
let clientPromise: Promise<GoogleGenAI> | undefined;
export async function getVertexGenAIClient(): Promise<GoogleGenAI> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { GoogleGenAI: GoogleGenAIClient } = await import('@google/genai');
      return new GoogleGenAIClient({
        vertexai: true,
        project: VERTEX_AI_PROJECT_ID || serviceAccount.project_id,
        location: VERTEX_AI_REGION,
        googleAuthOptions: {
          credentials: serviceAccount,
          scopes: 'https://www.googleapis.com/auth/cloud-platform',
        },
      });
    })();
    clientPromise.catch(() => { clientPromise = undefined; });
  }
  return clientPromise;
}

export default getVertexGenAIClient;
