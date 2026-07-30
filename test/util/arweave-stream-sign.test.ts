import { PassThrough, Readable } from 'stream';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';
import {
  describe, expect, it, vi,
} from 'vitest';
import { createData, DataItem, TypedEthereumSigner } from 'arbundles';

const KEY = `0x${'11'.repeat(32)}`;

// The real signer reads the Irys key from config/secret, which tests do not have.
// Everything under test is the ANS-104 assembly, so a fixed key is what makes the
// comparison against the library's buffered path deterministic.
vi.mock('../../src/util/arweave/signer', () => ({
  getSigner: async () => new TypedEthereumSigner(KEY),
  IRYS_NODE_ENDPOINT: 'https://devnet.irys.xyz',
  IRYS_TOKEN: 'base-eth',
  readIrysResponseBody: () => '',
}));

const {
  signDataItemStream, uploadSignedDataItemToIrys, getDeterministicAnchor,
} = await import('../../src/util/arweave/upload');

// signDataItemStream inlines arbundles' own streamSigner, because the exported one
// returns the output stream and keeps the header — and so the id — private, while
// the id is the name the GCS object gets promoted to. Inlining means we own the
// ANS-104 assembly, and a wrong item is *accepted* by the node and becomes a
// permanent bad on-chain id. So pin it against the library's buffered path.

// Deliberately not a round number of chunks, so a boundary bug cannot hide.
const PAYLOAD = crypto.randomBytes(1024 * 1024 + 12345);
const TAGS = [
  { name: 'Content-Type', value: 'application/pdf' },
  { name: 'IPFS-CID', value: 'bafyfakecid' },
];

async function buildBuffered() {
  const signer = new TypedEthereumSigner(KEY);
  const item = createData(PAYLOAD, signer, {
    tags: TAGS,
    anchor: getDeterministicAnchor('gcs-test'),
  });
  await item.sign(signer);
  return item;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('signDataItemStream', () => {
  it('produces the same id and bytes as the buffered library path', async () => {
    const buffered = await buildBuffered();
    const header = await signDataItemStream(Readable.from([PAYLOAD]), {
      tags: TAGS,
      anchorSeed: 'gcs-test',
    });

    expect(header.id).toBe(buffered.id);

    // Reassemble exactly as uploadSignedDataItemToIrys does: header ‖ payload.
    const body = new PassThrough();
    body.write(header.getRaw());
    Readable.from([PAYLOAD]).pipe(body);
    const wire = await collect(body);

    expect(wire.equals(buffered.getRaw())).toBe(true);
    // The Content-Length we declare must match the body we actually send.
    expect(header.getRaw().length + PAYLOAD.length).toBe(wire.length);
    expect(await new DataItem(wire).isValid()).toBe(true);
  });

  it('is independent of chunk boundaries', async () => {
    const buffered = await buildBuffered();
    // A prime chunk size, so no chunk aligns with any internal block size.
    const odd = Readable.from((function* chunked() {
      for (let i = 0; i < PAYLOAD.length; i += 7919) yield PAYLOAD.subarray(i, i + 7919);
    }()));
    const header = await signDataItemStream(odd, { tags: TAGS, anchorSeed: 'gcs-test' });
    expect(header.id).toBe(buffered.id);
  });

  it('gives different uploads different ids for identical bytes', async () => {
    // Without the anchor the id is a pure function of the content, which would
    // collapse two genuinely separate uploads of the same file into one id.
    const a = await signDataItemStream(Readable.from([PAYLOAD]), { tags: TAGS, anchorSeed: 'gcs-a' });
    const b = await signDataItemStream(Readable.from([PAYLOAD]), { tags: TAGS, anchorSeed: 'gcs-b' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('uploadSignedDataItemToIrys', () => {
  const TOTAL = 32 * 1024 * 1024;
  const BLOCK = Buffer.alloc(1024 * 1024, 0x41);

  // The whole point of streaming is that the payload is never resident. axios'
  // default transport (follow-redirects) retains every chunk to replay on
  // redirect, and its write() returns undefined so pipe() never pauses — which
  // silently reinstates a full-file buffer. Only maxRedirects: 0 avoids it, so
  // guard that: without it this test pulls the entire payload.
  it('honours backpressure instead of buffering the payload', async () => {
    let produced = 0;
    const server = createServer((_req, res) => {
      // Never read the request body, so a correct client stalls once the socket
      // buffer fills.
      setTimeout(() => { res.writeHead(400); res.end('stop'); }, 300);
    });
    await new Promise<void>((resolve) => { server.listen(0, resolve); });
    const { port } = server.address() as AddressInfo;
    const data = new Readable({
      read() {
        if (produced >= TOTAL) { this.push(null); return; }
        produced += BLOCK.length;
        this.push(BLOCK);
      },
    });
    const item = await signDataItemStream(Readable.from([Buffer.alloc(0)]), { tags: TAGS });

    try {
      await uploadSignedDataItemToIrys(item, data, TOTAL, `http://127.0.0.1:${port}`);
    } catch {
      // A 400 from the stub is expected; the assertion is about bytes pulled.
    } finally {
      // The stub never reads the request body, so the socket is still live here:
      // close() alone would wait on it, and awaiting that callback would hang.
      server.closeAllConnections();
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
    }

    // Generously above one socket buffer, far below the payload.
    expect(produced).toBeLessThan(TOTAL / 4);
  });
});
