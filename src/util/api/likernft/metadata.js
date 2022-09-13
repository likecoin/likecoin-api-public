import path from 'path';
import axios from 'axios';
import sharp from 'sharp';

import { API_EXTERNAL_HOSTNAME } from '../../../constant';
import { likeNFTCollection } from '../../firebase';
import { getISCNPrefixDocName } from '.';
import { getNFTISCNData, getNFTClassDataById } from '../../cosmos/nft';
import { ValidationError } from '../../ValidationError';

const IMAGE_WIDTH = 1280;
const IMAGE_HEIGHT = 768;

async function addTextOnImage(text, color) {
  const svgImage = `
    <svg width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}">
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
      height: IMAGE_HEIGHT,
      width: IMAGE_HEIGHT,
    })
    .extractChannel('alpha')
    .toBuffer();
  return maskData;
}

export async function getBasicImage(image, title) {
  let imageBuffer;
  let isDefault = true;
  if (image) {
    const imageData = (await axios.get(image, { responseType: 'stream' }).catch(() => {}));
    if (imageData && imageData.data) {
      imageBuffer = imageData.data;
      isDefault = false;
    }
  }
  if (isDefault) {
    const escapedTitle = title.replace(/&/g, '&amp;');
    const textDataBuffer = await addTextOnImage(escapedTitle, 'black');
    imageBuffer = await sharp(textDataBuffer)
      .png()
      .flatten({ background: { r: 250, g: 250, b: 250 } });
  }
  return { image: imageBuffer, isDefault };
}

export async function getCombinedImage() {
  const maskBuffer = await getImageMask();
  return sharp()
    .ensureAlpha()
    .joinChannel(maskBuffer);
}

export function getResizedImage() {
  return sharp()
    .resize({
      fit: sharp.fit.cover,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    })
    .png();
}

export function getDynamicBackgroundColor(soldCount) {
  // TODO: replace with actual color map
  if (soldCount > 100) {
    return '#28646e';
  } if (soldCount > 10) {
    return '#16a122';
  } if (soldCount > 1) {
    return '#50e3c2';
  }
  return '#d2f0f0';
}

export function getLikerNFTDynamicData(classId, classData, iscnData) {
  const { soldCount } = classData;
  const { contentMetadata: { url, description } = {} } = iscnData;
  const backgroundColor = getDynamicBackgroundColor(soldCount);
  const payload = {
    image: `https://${API_EXTERNAL_HOSTNAME}/likernft/metadata/image/class_${classId}.png`,
    backgroundColor,
  };
  if (description) payload.description = description;
  if (url) payload.externalUrl = url;
  return payload;
}

export async function getClassMetadata({ classId, iscnPrefix }) {
  const iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
  const classDocRef = likeNFTCollection.doc(iscnPrefixDocName).collection('class').doc(classId);
  const classDoc = await classDocRef.get();
  const classData = classDoc.data();
  if (!classData) throw new ValidationError('NFT_DATA_NOT_FOUND');

  const [{ owner: iscnOwner, data: iscnData }, chainData] = await Promise.all([
    // eslint-disable-next-line no-console
    getNFTISCNData(iscnPrefix).catch((err) => { console.error(err); return {}; }),
    // eslint-disable-next-line no-console
    getNFTClassDataById(classId).catch(err => console.error(err)),
  ]);
  if (!iscnData) throw new ValidationError('ISCN_NOT_FOUND');
  if (!chainData) throw new ValidationError('NFT_CLASS_NOT_FOUND');
  const dynamicData = getLikerNFTDynamicData(classId, classData, iscnData);
  if (!dynamicData) throw new ValidationError('NFT_CLASS_NOT_REGISTERED');
  return {
    iscnOwner,
    classData,
    iscnData,
    chainData,
    dynamicData,
  };
}
