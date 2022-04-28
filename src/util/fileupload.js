import axios from 'axios';
import {
  bucket as fbBucket,
} from './firebase';
import {
  IS_TESTNET,
  SUPPORTED_AVATAR_TYPE,
} from '../constant';
import { ValidationError } from './ValidationError';

const sharp = require('sharp');
const fileType = require('file-type');
const sha256 = require('js-sha256');
// eslint-disable-next-line import/no-extraneous-dependencies
const md5 = require('md5-hex');

export function uploadFileAndGetLink(file, { filename, mimetype }) {
  const isStream = file && typeof file.pipe === 'function';
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file'));
    }
    const blob = fbBucket.file(filename);
    const blobStream = blob.createWriteStream({
      metadata: {
        contentType: mimetype,
      },
    });
    blobStream.on('error', (err) => {
      reject(new Error(`Something is wrong! ${err || err.msg}`));
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
  if (!SUPPORTED_AVATAR_TYPE.has(type && type.ext)) {
    throw new ValidationError(`unsupported file format! ${(type || {}).ext || JSON.stringify(type)}`);
  }

  if (avatarSHA256) {
    const hash256 = sha256(file.buffer);
    if (hash256 !== avatarSHA256) throw new ValidationError('avatar sha not match');
  }

  const resizedBuffer = await sharp(file.buffer).resize(400, 400).toBuffer();
  file.buffer = resizedBuffer; // eslint-disable-line no-param-reassign
  const [avatarUrl] = await uploadFileAndGetLink(file, {
    filename: `likecoin_store_user_${user}_${IS_TESTNET ? 'test' : 'main'}`,
    mimetype: file.mimetype,
  });
  const versionHash = md5(file.buffer).substring(0, 7);
  return `${avatarUrl}&${versionHash}`;
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
  transformer = transformer.resize(400, 400);
  data.pipe(transformer);
  const [avatarUrl] = await uploadFileAndGetLink(transformer, {
    filename: `likecoin_store_user_${user}_${IS_TESTNET ? 'test' : 'main'}`,
    mimetype: type.mime,
  });
  return avatarUrl;
}

export default uploadFileAndGetLink;
