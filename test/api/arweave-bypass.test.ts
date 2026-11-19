import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import { testingWallet1, testingLikeWallet1 } from './data';
import { iscnArweaveTxCollection } from '../../src/util/firebase';
import { FILES_HOSTNAME } from '../../src/constant';

const TX_ID = 'bypass-open-upload-id';
const TX_ID_OFF = 'bypass-open-upload-id-off';
const ARWEAVE_ID = 'A'.repeat(43);
const FILE_SHA256 = 'f'.repeat(64);

const mocks = vi.hoisted(() => ({
  disabled: true,
  estimateSpy: vi.fn(),
  uploadToArweaveSpy: vi.fn(),
  uploadToIrysSpy: vi.fn(),
}));

// A getter, so each describe can flip the switch after the module graph is loaded.
vi.mock('../../config/config', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get ARWEAVE_UPLOAD_DISABLED() { return mocks.disabled; },
  };
});

vi.mock('../../src/util/gcloudStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/gcloudStorage')>();
  return {
    ...actual,
    isEbookTierBucketEnabled: () => true,
  };
});

vi.mock('../../src/util/api/arweave/ingest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/api/arweave/ingest')>();
  return {
    ...actual,
    getStagedUploadSignedUrl: async () => 'https://upload.example/staged',
    verifyStagedObject: async () => ({ computedSHA256: FILE_SHA256, generation: '1' }),
    promoteStagedObject: async (txHash: string) => txHash,
    deleteStagedObject: async () => undefined,
  };
});

vi.mock('../../src/util/api/arweave/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/api/arweave/index')>();
  return { ...actual, estimateUploadToArweaveV2: mocks.estimateSpy };
});

vi.mock('../../src/util/api/arweave/openUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/api/arweave/openUpload')>();
  return { ...actual, uploadStagedObjectToArweave: mocks.uploadToArweaveSpy };
});

vi.mock('../../src/util/arweave/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/arweave/upload')>();
  return { ...actual, uploadSignedDataItemToIrys: mocks.uploadToIrysSpy };
});

const auth = { Authorization: `Bearer ${jwtSign({ wallet: testingWallet1, permissions: ['write:iscn'] })}` };

const post = (url: string, data: unknown) => axiosist
  .post(url, data, { headers: auth })
  .catch((err) => (err as any).response);

// Distinct ids per describe: the stub's set() appends rather than replaces, so a
// doc the first describe completed would stay complete.
const seedPending = (id: string) => iscnArweaveTxCollection.doc(id).set({
  source: 'gcs',
  tier: 'open',
  status: 'pending',
  fileSize: 1000,
  fileSHA256: FILE_SHA256,
  contentType: 'image/jpeg',
  ownerWallet: testingLikeWallet1,
});

describe('Arweave upload kill-switch on', () => {
  const postOpenFinalize = (id: string, body: Record<string, unknown>) => post(`/api/arweave/v2/gcs/arweave/${id}`, body);

  beforeEach(async () => {
    mocks.disabled = true;
    vi.clearAllMocks();
    await seedPending(TX_ID);
  });

  it('estimate returns zero cost without calling Irys', async () => {
    const res = await post('/api/arweave/v2/estimate', { fileSize: 1000, ipfsHash: 'QmTest' });

    expect(res.status).toBe(200);
    expect(res.data.ETH).toBe('0');
    expect(res.data.arweaveId).toBeUndefined();
    expect(mocks.estimateSpy).not.toHaveBeenCalled();
  });

  it('upload_init mints a bare uuid', async () => {
    const res = await post('/api/arweave/v2/gcs/upload_init', {
      fileSize: 1000,
      fileSHA256: FILE_SHA256,
      contentType: 'image/jpeg',
      tier: 'open',
    });

    expect(res.status).toBe(200);
    expect(res.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('open finalize completes in GCS with no arweaveId', async () => {
    const res = await postOpenFinalize(TX_ID, { ipfsHash: 'QmTest', txToken: 'SPONSORED' });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: TX_ID, link: `https://${FILES_HOSTNAME}/${TX_ID}` });
    expect(res.data.link).toBe(`https://files-testnet.3ook.com/${TX_ID}`);
    const doc = (await iscnArweaveTxCollection.doc(TX_ID).get()).data();
    expect(doc.status).toBe('complete');
    expect(doc.isRequireAuth).toBe(false);
    expect(doc.contentBucketPath).toBe(TX_ID);
    expect(doc.arweaveId).toBeUndefined();
    expect(mocks.uploadToArweaveSpy).not.toHaveBeenCalled();
    expect(mocks.uploadToIrysSpy).not.toHaveBeenCalled();
  });

  it('rejects a second finalize of the same id', async () => {
    await postOpenFinalize(TX_ID, { ipfsHash: 'QmTest' });
    const res = await postOpenFinalize(TX_ID, { ipfsHash: 'QmTest' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Arweave upload kill-switch off', () => {
  beforeEach(async () => {
    mocks.disabled = false;
    vi.clearAllMocks();
    await seedPending(TX_ID_OFF);
  });

  it('open finalize still uploads to Arweave and returns its id', async () => {
    mocks.uploadToArweaveSpy.mockResolvedValue({
      arweaveId: ARWEAVE_ID,
      contentBucketPath: ARWEAVE_ID,
      fileSHA256: FILE_SHA256,
      isSponsored: true,
    });
    const res = await post(`/api/arweave/v2/gcs/arweave/${TX_ID_OFF}`, { ipfsHash: 'QmTest', txToken: 'SPONSORED' });

    expect(res.status).toBe(200);
    expect(mocks.uploadToArweaveSpy).toHaveBeenCalledTimes(1);
    expect(res.data.arweaveId).toBe(ARWEAVE_ID);
    expect(res.data.link).toContain(ARWEAVE_ID);
  });
});
