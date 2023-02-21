import { grpc as GRPCWeb } from '@improbable-eng/grpc-web';
import { NodeHttpTransport } from '@improbable-eng/grpc-web-node-http-transport';
import { GenerationServiceClient } from './generation/generation_pb_service';
import {
  buildGenerationRequest,
  executeGenerationRequest,
} from './helpers';

import {
  STABILITY_AI_API_KEY,
  STABILITY_AI_FIXED_PROMPTS,
} from '../../../config/config';
import { ValidationError } from '../ValidationError';

// This is a NodeJS-specific requirement - browsers implementations should omit this line.
GRPCWeb.setDefaultTransport(NodeHttpTransport());

// Authenticate using your API key, don't commit your key to a public repository!
const metadata = new GRPCWeb.Metadata();
metadata.set('Authorization', `Bearer ${STABILITY_AI_API_KEY}`);

// Create a generation client to use with all future requests
const client = new GenerationServiceClient('https://grpc.stability.ai', {});

export async function generateImageFromText(text: string): Promise<Uint8Array> {
  if (!STABILITY_AI_API_KEY) throw new ValidationError('API_KEY_NOT_SET');
  const request = buildGenerationRequest('stable-diffusion-512-v2-1', {
    type: 'text-to-image',
    prompts: [{
      text: `${STABILITY_AI_FIXED_PROMPTS}, ${text}`,
    }],
  });

  const res = await executeGenerationRequest(client, request, metadata);
  if (res instanceof Error) throw res;
  if (!res.imageArtifacts.length) throw new ValidationError('RESULT_FILTERED_PLEASE_RETRY');
  return res.imageArtifacts[0].getBinary_asU8();
}

export default generateImageFromText;
