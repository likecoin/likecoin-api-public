import path from 'path';
import sharp from 'sharp';
import axios from 'axios';
import { API_EXTERNAL_HOSTNAME } from '../../../constant';

const Text2SVG = require('text-to-svg');

async function pasteText(
  text, fontSize, color,
) {
  const text2SVG = Text2SVG.loadSync();
  const attributes = { fill: color };
  const options = {
    fontSize,
    anchor: 'top',
    attributes,
  };
  const svg = Buffer.from(text2SVG.getSVG(text, options));
  return svg;
}

async function getImageMask() {
  const imgPath = path.join(__dirname, '../../../assets/iscn.png');
  const maskData = await sharp(imgPath)
    .resize(300, 300)
    .toBuffer();
  return maskData;
}

async function getMaskedNFTImage(imageData) {
  // TODO: use pipe
  const mask = await getImageMask();
  const combinedData = await sharp(imageData)
    .flatten({ background: 'blue' })
    .resize({
      fit: sharp.fit.contain,
      width: 512,
      height: 512,
    })
    .ensureAlpha()
    .composite([{
      input: mask,
      gravity: 'south',
    }])
    .toBuffer();
  return combinedData;
}

export async function getDynamicNFTImage(image, title) {
  const imageData = image ? await axios.get(image, { responseType: 'arraybuffer' }).data : await pasteText(title, 1000, 'black');
  return getMaskedNFTImage(imageData);
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
  console.log(4);

  const { soldCount } = classData;
  const backgroundColor = await getDynamicBackgroundColor(soldCount);
  console.log(4);
  return {
    image: `https://${API_EXTERNAL_HOSTNAME}/likernft/metadata/image/class_${classId}.png`,
    backgroundColor,
  };
}
