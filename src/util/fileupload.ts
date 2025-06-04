import axios from 'axios';
import sharp from 'sharp';
import fileType from 'file-type';
import { sha256 } from 'js-sha256';
import md5 from 'md5-hex';
import { ValidationError } from './ValidationError';
import {
  IS_TESTNET,
  SUPPORTED_AVATAR_TYPE,
} from '../constant';
import {
  bucket as fbBucket,
} from './firebase';

import { bookCacheBucket } from './gcloudStorage';

export function uploadFileAndGetLink(file, { filename, mimetype }): Promise<string[]> {
  const isStream = file && typeof file.pipe === 'function';
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file'));
      return;
    }
    if (!fbBucket) {
      reject(new Error('Bucket not inited'));
      return;
    }
    const blob = fbBucket.file(filename);
    const blobStream = blob.createWriteStream({
      metadata: {
        contentType: mimetype,
      },
    });
    blobStream.on('error', (err) => {
      reject(new Error(`Something is wrong! ${err || (err as any).msg}`));
    });
    blobStream.on('finish', () => {
      resolve(blob.getSignedUrl({
        action: 'read',
        expires: '01-07-2047',
      }));
    });
    if (isStream) {
      file.pipe(blobStream);
    } else {
      blobStream.end(file.buffer);
    }
  });
}

export async function handleAvatarUploadAndGetURL(user, file, avatarSHA256) {
  const type = fileType(file.buffer);
  if (!type || !SUPPORTED_AVATAR_TYPE.has(type.ext)) {
    throw new ValidationError(`unsupported file format! ${(type || {}).ext || JSON.stringify(type)}`);
  }

  const hash256 = sha256(file.buffer);
  if (avatarSHA256) {
    if (hash256 !== avatarSHA256) throw new ValidationError('avatar sha not match');
  }

  const resizedBuffer = await sharp(file.buffer).resize(400, 400).toBuffer();
  file.buffer = resizedBuffer; // eslint-disable-line no-param-reassign
  const [avatarUrl] = await uploadFileAndGetLink(file, {
    filename: `likecoin_store_user_${user}_${IS_TESTNET ? 'test' : 'main'}`,
    mimetype: file.mimetype,
  });
  const versionHash = md5(file.buffer).substring(0, 7);
  return { url: `${avatarUrl}&${versionHash}`, hash: hash256 };
}

export async function handleAvatarLinkAndGetURL(user, url) {
  let { data } = await axios.get(url, {
    responseType: 'stream',
    timeout: 5000,
  });
  data = await fileType.stream(data);
  const type = data.fileType;
  if (!SUPPORTED_AVATAR_TYPE.has(type && type.ext)) {
    throw new ValidationError(`unsupported file format! ${(type || {}).ext || JSON.stringify(type)}`);
  }
  let transformer = sharp();
  transformer = transformer
    .resize(400, 400)
    // eslint-disable-next-line no-console
    .on('error', (err) => console.error(JSON.stringify(err)));
  data.pipe(transformer);
  const [avatarUrl] = await uploadFileAndGetLink(transformer, {
    filename: `likecoin_store_user_${user}_${IS_TESTNET ? 'test' : 'main'}`,
    mimetype: type.mime,
  });
  return avatarUrl;
}

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
    await bookCacheBucket.file(path).save(file, {
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

export async function uploadImageBufferToCache({
  buffer,
  path,
}: {
  buffer: Buffer | Uint8Array
  path: string
}): Promise<boolean> {
  try {
    if (buffer.length > 1 * 1024 * 1024) {
      throw new ValidationError('File size exceeds 1MB');
    }

    const type = fileType(buffer);
    if (!type || type.ext !== 'png') {
      throw new ValidationError(`Unsupported image format: ${type?.ext || 'unknown'}`);
    }

    await uploadFileToBookCache({ path, file: buffer });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to upload image to ${path}`, err);
    return false;
  }
}

export default uploadFileAndGetLink;
