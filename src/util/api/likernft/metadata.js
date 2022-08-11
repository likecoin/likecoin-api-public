import path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { API_EXTERNAL_HOSTNAME } from '../../../constant';

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
    const titleFix = title.replace('&', '&amp;');
    const textDataBuffer = await addTextOnImage(titleFix, 'black');
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
