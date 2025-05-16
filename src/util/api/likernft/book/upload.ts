import { Storage } from '@google-cloud/storage';
import { CACHE_BUCKET } from '../../../../constant';

const storage = new Storage();
const bucket = storage.bucket(CACHE_BUCKET);

export default async function uploadFile({
  path,
  file,
  contentType = 'image/png',
}: {
  path: string
  file: Buffer | Uint8Array
  contentType?: string
}): Promise<boolean> {
  if (!path || !file) {
    throw new Error('path and file are required');
  }

  try {
    await bucket.file(path).save(file, {
      public: true,
      contentType,
    });
    // eslint-disable-next-line no-console
    console.log(`Uploaded ${path}`);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to upload ${path}`, err);
    return false;
  }
}
