import path from 'path';
import axios from 'axios';
import sharp from 'sharp';

import { API_EXTERNAL_HOSTNAME, NFT_GEM_COLOR } from '../../../constant';
import { likeNFTCollection } from '../../firebase';
import { getISCNPrefixDocName } from '.';
import { getNFTISCNData, getNFTClassDataById } from '../../cosmos/nft';
import { ValidationError } from '../../ValidationError';

export const DEFAULT_NFT_IMAGE_WIDTH = 1280;
export const DEFAULT_NFT_IMAGE_HEIGHT = 768;

async function addTextOnImage(text, color) {
  const svgImage = `
    <svg width="${DEFAULT_NFT_IMAGE_WIDTH}" height="${DEFAULT_NFT_IMAGE_HEIGHT}">
      <style>
      .title { fill: ${color}; font-size: 100px; font-weight: bold;}
      </style>
      <text x="50%" y="55%" text-anchor="middle" class="title">${text}</text>
    </svg>
    `;
  return Buffer.from(svgImage);
}

let maskData;
export async function getImageMask() {
  if (maskData) return maskData;
  const imgPath = path.join(__dirname, '../../../assets/book.png');
  maskData = await sharp(imgPath)
    .resize({
      height: DEFAULT_NFT_IMAGE_HEIGHT,
      width: DEFAULT_NFT_IMAGE_HEIGHT,
    })
    .extractChannel('alpha')
    .toBuffer();
  return maskData;
}

function encodedURL(url) {
  if (/^[ -~]+$/.test(url)) {
    return url;
  }
  return encodeURI(url);
}

export async function getBasicImage(image, title) {
  let imageBuffer;
  let contentType;
  let isDefault = true;
  if (image) {
    const imageData = (await axios.get(encodedURL(image), { responseType: 'stream' }).catch(() => ({} as any)));
    if (imageData && imageData.data) {
      imageBuffer = imageData.data;
      contentType = imageData.headers['content-type'] || 'image/png';
      isDefault = false;
    }
  }
  if (isDefault) {
    const escapedTitle = title.replace(/&/g, '&amp;');
    const textDataBuffer = await addTextOnImage(escapedTitle, 'black');
    contentType = 'image/png';
    imageBuffer = await sharp(textDataBuffer)
      .png()
      .flatten({ background: { r: 250, g: 250, b: 250 } });
  }
  return { image: imageBuffer, contentType, isDefault };
}

export async function getCombinedImage() {
  const maskBuffer = await getImageMask();
  return sharp()
    .ensureAlpha()
    .joinChannel(maskBuffer);
}

export function getResizedImage(size = DEFAULT_NFT_IMAGE_WIDTH) {
  return sharp()
    .resize({
      fit: sharp.fit.cover,
      width: size,
      height: Math.round((size / DEFAULT_NFT_IMAGE_WIDTH) * DEFAULT_NFT_IMAGE_HEIGHT),
    });
}

export function getDynamicBackgroundColor({ currentBatch }) {
  let gemLevel = currentBatch;
  if (currentBatch >= 14 && currentBatch <= 16) {
    gemLevel = 14;
  } else if (currentBatch >= 17) {
    gemLevel = 15;
  }
  return NFT_GEM_COLOR[gemLevel];
}

export function getLikerNFTDynamicData(classId, iscnDocData, classMetadata, iscnData) {
  const { currentBatch } = iscnDocData;
  const { is_custom_image: isCustomImage = false } = classMetadata;
  const { contentMetadata: { url = '', description = '' } = {} } = iscnData;
  const backgroundColor = getDynamicBackgroundColor({ currentBatch });
  const payload: any = {
    backgroundColor,
  };
  if (!isCustomImage) payload.image =  `https://${API_EXTERNAL_HOSTNAME}/likernft/metadata/image/class_${classId}?size=${DEFAULT_NFT_IMAGE_WIDTH}`;
  if (description) payload.description = description;
  if (url) payload.externalUrl = url;
  return payload;
}

export async function getClassMetadata({ classId, iscnPrefix }) {
  const iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
  const iscnDocRef = likeNFTCollection.doc(iscnPrefixDocName);
  const classDocRef = iscnDocRef.collection('class').doc(classId);
  const [iscnDoc, classDoc] = await Promise.all([iscnDocRef.get(), classDocRef.get()]);
  const iscnDocData = iscnDoc.data();
  const classData = classDoc.data();
  if (!classData) throw new ValidationError('NFT_DATA_NOT_FOUND', 404);

  const [res, chainData] = await Promise.all([
    // eslint-disable-next-line no-console
    getNFTISCNData(iscnPrefix).catch((err) => { console.error(err); return {}; }),
    // eslint-disable-next-line no-console
    getNFTClassDataById(classId).catch((err) => console.error(err)),
  ]);
  const { owner: iscnOwner, data: iscnData }: { owner?: string; data?: any } = res;
  if (!iscnData) throw new ValidationError('ISCN_NOT_FOUND', 404);
  if (!chainData) throw new ValidationError('NFT_CLASS_NOT_FOUND', 404);
  const {
    name,
    description,
    uri,
    data: { parent, metadata: classMetadata = {} } = {},
  } = chainData;
  const chainMetadata = {
    ...classMetadata,
    name,
    description,
    uri,
    parent,
  };
  const dynamicData = getLikerNFTDynamicData(classId, iscnDocData, classMetadata, iscnData);
  if (!dynamicData) throw new ValidationError('NFT_CLASS_NOT_REGISTERED');
  return {
    iscnOwner,
    classData,
    iscnData,
    chainData: chainMetadata,
    dynamicData,
  };
}
