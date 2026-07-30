import crypto from 'crypto';
import { PassThrough } from 'stream';
import type { Readable } from 'stream';
import axios from 'axios';
import {
  createData, deepHash, stringToBuffer, DataItem,
} from 'arbundles';
import {
  IRYS_NODE_ENDPOINT, IRYS_TOKEN, getSigner, readIrysResponseBody,
} from './signer';

const UPLOAD_TIMEOUT_MS = 180000;

export interface DataItemTag {
  name: string;
  value: string;
}

// Anchors the DataItem to one upload, so retries produce the same id instead of
// paying for a second copy. Must be exactly 32 bytes; a 32-char hex slice is.
export function getDeterministicAnchor(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

/**
 * Sign an ANS-104 DataItem whose payload is a stream, returning the signed
 * header (ADR 0001 Phase 3 amendment).
 *
 * `createData('')` builds the item with an empty payload, which is exactly the
 * header: ANS-104 puts data last, so the wire format is `header ‖ data`. deepHash
 * accumulates the payload length as it consumes the stream and only tags at the
 * end, so the payload is never held.
 *
 * This is arbundles' own streamSigner inlined. It cannot be used directly:
 * it returns the output stream and keeps the header private, and the header is
 * the only thing that carries the id — which we need up front, because it is the
 * name the GCS object gets promoted to.
 *
 * `data` is consumed. Callers wanting the payload hash as well should tee it
 * through a hash transform before passing it in.
 */
export async function signDataItemStream(
  data: Readable,
  { tags = [], anchorSeed }: { tags?: DataItemTag[]; anchorSeed?: string } = {},
): Promise<DataItem> {
  const signer = await getSigner();
  const item = createData('', signer, {
    tags,
    ...(anchorSeed ? { anchor: getDeterministicAnchor(anchorSeed) } : {}),
  });
  const signatureData = await deepHash([
    stringToBuffer('dataitem'),
    stringToBuffer('1'),
    stringToBuffer(item.signatureType.toString()),
    item.rawOwner,
    item.rawTarget,
    item.rawAnchor,
    item.rawTags,
    data,
  ]);
  await item.setSignature(Buffer.from(await signer.sign(signatureData)));
  return item;
}

/**
 * Upload a signed DataItem to Irys, streaming its payload, and return the
 * arweaveId.
 *
 * The id is Base64URL(SHA-256(signature)) and so is fixed by signing, before any
 * byte is sent. A node echoing back a different one is rejected: accepting it
 * would put an id on-chain addressing content we never signed.
 *
 * Resolving means the node has taken custody — that receipt is the confirmation
 * callers block on, which is why there is no reconcile path.
 *
 * Content-Length is set explicitly. The node does accept a chunked body, but the
 * total is exactly known (header + payload), and declaring it lets proxies reject
 * an oversized upload before we spend the egress.
 */
export async function uploadSignedDataItemToIrys(
  item: DataItem,
  data: Readable,
  dataLength: number,
  // Overridable so the backpressure behaviour can be asserted against a local
  // server; production always uses the configured node.
  endpoint: string = IRYS_NODE_ENDPOINT,
): Promise<string> {
  const arweaveId = item.id;
  const header = item.getRaw();

  const body = new PassThrough();
  body.write(header);
  // pipe() does not forward errors, so a failed GCS read would otherwise stall
  // the request until the timeout with a silently truncated body.
  data.on('error', (err) => body.destroy(err));
  data.pipe(body);

  let res: { status: number; data?: { id?: string } };
  try {
    res = await axios.post(`${endpoint}/tx/${IRYS_TOKEN}`, body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(header.length + dataLength),
      },
      timeout: UPLOAD_TIMEOUT_MS,
      // Both of these are load-bearing for memory, not style.
      //
      // maxRedirects: 0 selects axios' native transport. Its default,
      // follow-redirects, retains every written chunk in _requestBodyBuffers to
      // replay on redirect, and its write() returns undefined — pipe() only
      // pauses on an exact `false`, so backpressure is defeated too. Together
      // that buffers the whole file, which is the thing this path exists to
      // avoid. Irys does not redirect, and a surprise 3xx now surfaces as a loud
      // IRYS_UPLOAD_FAILED rather than a silent re-buffer.
      //
      // maxBodyLength stays at the default -1 (unbounded): any other value makes
      // the native path wrap the body in a byte-counting Transform we do not need,
      // since Content-Length is already exact.
      maxRedirects: 0,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });
  } finally {
    // axios does not tear down a request body it stops reading, so without this a
    // rejected or early-answered upload leaves the GCS read draining into a
    // PassThrough nobody consumes, holding its connection open.
    if (!data.destroyed) data.destroy();
    if (!body.destroyed) body.destroy();
  }

  if (res.status < 200 || res.status >= 300) {
    const responseBody = readIrysResponseBody(res);
    // A re-submitted DataItem is a successful retry: the anchor guarantees the
    // node already holds exactly these bytes under exactly this id.
    if (/already (been )?(received|processed)|duplicate/i.test(responseBody)) return arweaveId;
    throw new Error(`IRYS_UPLOAD_FAILED status=${res.status} body=${responseBody}`);
  }
  const returnedId = res.data?.id;
  if (returnedId && returnedId !== arweaveId) {
    throw new Error(`IRYS_UPLOAD_ID_MISMATCH signed=${arweaveId} node=${returnedId}`);
  }
  return arweaveId;
}

export default signDataItemStream;
