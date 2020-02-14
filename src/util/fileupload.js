import axios from 'axios';
import {
  bucket as fbBucket,
} from './firebase';
import {
  IS_TESTNET,
  SUPPORTED_AVATER_TYPE,
} from '../constant';
import { ValidationError } from './ValidationError';

const sharp = require('sharp');
const fileType = require('file-type');
const sha256 = require('js-sha256');

export function uploadFileAndGetLink(file, newFilename) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file'));
    }
    const filename = newFilename || file.originalname;
    const blob = fbBucket.file(filename);
    const blobStream = blob.createWriteStream({
      metadata: {
        contentType: file.mimetype,
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
    blobStream.end(file.buffer);
  });
}

export async function handleAvatarUploadAndGetURL(user, file, avatarSHA256) {
  const type = fileType(file.buffer);
  if (!SUPPORTED_AVATER_TYPE.has(type && type.ext)) {
    console.error(`unsupported file format! ${(type || {}).ext || JSON.stringify(type)}`);
    return undefined;
  }

  if (avatarSHA256) {
    const hash256 = sha256(file.buffer);
    if (hash256 !== avatarSHA256) throw new ValidationError('avatar sha not match');
  }

  const resizedBuffer = await sharp(file.buffer).resize(400, 400).toBuffer();
  file.buffer = resizedBuffer; // eslint-disable-line no-param-reassign
  const [avatarUrl] = await uploadFileAndGetLink(file, `likecoin_store_user_${user}_${IS_TESTNET ? 'test' : 'main'}`);
  return avatarUrl;
}

export async function handleAvatarLinkAndGetURL(user, url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
  });
  const buffer = new Uint8Array(data);
  const type = fileType(buffer);
  if (!SUPPORTED_AVATER_TYPE.has(type && type.ext)) {
    console.error(`unsupported file format! ${(type || {}).ext || JSON.stringify(type)}`);
    return undefined;
  }
  const resizedBuffer = await sharp(data).resize(400, 400).toBuffer();
  const filename = url.split('/').pop();
  const file = {
    buffer: resizedBuffer,
    filename,
    originalname: filename,
    mimetype: type.mime,
  };
  const [avatarUrl] = await uploadFileAndGetLink(file, `likecoin_store_user_${user}_${IS_TESTNET ? 'test' : 'main'}`);
  return avatarUrl;
}

export default uploadFileAndGetLink;
