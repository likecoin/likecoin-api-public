import { Storage } from '@google-cloud/storage';
import serviceAccount from '../../../../../config/serviceAccountKey.json';
import { CACHE_BUCKET } from '../../../../constant';

const storage = new Storage({ credentials: serviceAccount });
const bucket = storage.bucket(CACHE_BUCKET);

export async function uploadFileToBookCache({
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

export async function uploadBase64Image({
  base64,
  path,
}: {
  base64: string;
  path: string;
}): Promise<boolean> {
  if (!base64) return false;
  try {
    const matches = base64.match(/^data:image\/png;base64,(.+)$/);
    if (!matches || matches.length !== 3) throw new Error('Invalid base64 string');
    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    return await uploadFileToBookCache({ path, file: buffer, contentType });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to upload image to ${path}`, err);
    return false;
  }
}
