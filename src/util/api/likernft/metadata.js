import path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { API_EXTERNAL_HOSTNAME } from '../../../constant';

const ALL_CAP = 512;

async function addTextOnImage(text, color) {
  const width = ALL_CAP;
  const height = ALL_CAP;
  const svgImage = `
    <svg width="${width}" height="${height}">
      <style>
      .title { fill: ${color}; font-size: 100px; font-weight: bold;}
      </style>
      <text x="50%" y="50%" text-anchor="middle" class="title">${text}</text>
    </svg>
    `;
  const svgPng = await sharp(Buffer.from(svgImage)).png();
  return svgPng;
}

async function getImageMask() {
  const imgPath = path.join(__dirname, '../../../assets/iscn.png');
  const maskData = await sharp(imgPath)
    .resize({
      width: ALL_CAP,
      height: ALL_CAP,
    })
    .toBuffer();
  return maskData;
}

let mask;
export async function getMaskedNFTImage() {
  if (!mask) mask = await getImageMask();
  const combinedData = await sharp()
    .resize({
      fit: sharp.fit.contain,
      width: ALL_CAP,
      height: ALL_CAP,
      background: 'white', // image white borders
    })
    .ensureAlpha()
    .composite([{ input: mask }])
    .png();
  return combinedData;
}

export async function getImageStream(image, title, color) {
  let imageStream;
  if (image) {
    imageStream = (await axios({ method: 'get', url: image, responseType: 'stream' })).data;
  } else {
    imageStream = await addTextOnImage(title, color);
  }
  return imageStream;
}

export async function getDynamicBackgroundColor(soldCount) {
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

export async function getLikerNFTDynamicData(classId, classData) {
  const { soldCount } = classData;
  const backgroundColor = await getDynamicBackgroundColor(soldCount);
  return {
    image: `https://${API_EXTERNAL_HOSTNAME}/likernft/metadata/image/class_${classId}.png`,
    backgroundColor,
  };
}
