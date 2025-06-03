import { Storage } from '@google-cloud/storage';
import { CACHE_BUCKET } from '../constant';

import serviceAccount from '../../config/serviceAccountKey.json';

export const storage = new Storage({ credentials: serviceAccount });
export const bookCacheBucket = storage.bucket(CACHE_BUCKET);

export default storage;
