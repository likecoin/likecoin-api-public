import { Storage } from '@google-cloud/storage';
import { CACHE_BUCKET } from '../../../../constant';

const storage = new Storage();
const bucket = storage.bucket(CACHE_BUCKET);

export default async function uploadSignatureAndMemoImages({ classId, signFile, memoFile }) {
  if (!classId) {
    throw new Error('classId is required');
  }

  if (signFile) {
    try {
      const signPath = `${classId}/sign.png`;
      await bucket.file(signPath).save(signFile.data, {
        public: true,
        contentType: signFile.type || 'image/png',
      });
      // eslint-disable-next-line no-console
      console.log('sign.png uploaded');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to upload sign.png for ${classId}`, err);
    }
  }

  if (memoFile) {
    try {
      const memoPath = `${classId}/memo.png`;
      await bucket.file(memoPath).save(memoFile.data, {
        public: true,
        contentType: memoFile.type || 'image/png',
      });
      // eslint-disable-next-line no-console
      console.log('memo.png uploaded');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to upload memo.png for ${classId}`, err);
    }
  }
}
