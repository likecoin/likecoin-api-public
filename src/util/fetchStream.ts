import axios, { AxiosError } from 'axios';
import type { Readable } from 'stream';

/**
 * GET the first URL that responds, as a stream. Used to fetch the same content
 * addressed object through a list of interchangeable gateways (Arweave, IPFS).
 */
// eslint-disable-next-line import/prefer-default-export
export async function fetchStreamWithFallback(urls: string[], {
  timeout,
  maxContentLength,
  headers,
}: {
  timeout: number;
  maxContentLength: number;
  headers?: Record<string, string>;
}): Promise<{ stream: Readable; contentType: string }> {
  let lastError: unknown = new Error('NO_GATEWAY_URL');
  for (const url of urls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await axios.get<Readable>(url, {
        responseType: 'stream',
        timeout,
        maxContentLength,
        ...(headers ? { headers } : {}),
      });
      const contentType = res.headers['content-type'];
      return {
        stream: res.data,
        contentType: typeof contentType === 'string' ? contentType : '',
      };
    } catch (error) {
      // A stream response body is left open on a non-2xx; drop it or the socket
      // is held until the gateway times out.
      (error as AxiosError<Readable>).response?.data?.destroy?.();
      lastError = error;
    }
  }
  throw lastError;
}
