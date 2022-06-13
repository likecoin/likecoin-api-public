import sharp from 'sharp';
import axios from 'axios';
import { EXTERNAL_HOSTNAME } from '../../../constant';
import { ValidationError } from '../../ValidationError';
import { likeNFTCollection } from '../../firebase';

let maskData;
async function getImageMask(
  maskUrl = 'https://s3.us-west-2.amazonaws.com/secure.notion-static.com/b35cd824-4acc-4678-b7d1-b7c70176eaab/ISCN_PressKit_Colou_Light.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIAT73L2G45EIPT3X45%2F20220613%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Date=20220613T141949Z&X-Amz-Expires=86400&X-Amz-Signature=c5778415d09b0e2695c3cb2c75aa2e3d500101edf3c0ed842231a2f9313e7c1f&X-Amz-SignedHeaders=host&response-content-disposition=filename%20%3D%22ISCN_PressKit_Colou_Light.png%22&x-id=GetObject',
) {
  if (maskData) return maskData;
  const { data } = await axios.get(maskUrl, { responseType: 'arraybuffer' });
  // TODO: use pipe
  const buffer = Buffer.from(data);
  maskData = await sharp(buffer)
    .resize(512, 512)
    .extractChannel('green')
    .toBuffer();
  return maskData;
}

async function getMaskedNFTImage(ogImageUrl) {
  // TODO: use pipe
  const [mask, imageRes] = await Promise.all([
    getImageMask(), axios.get(ogImageUrl, { responseType: 'arraybuffer' }),
  ]);
  const combinedData = await sharp(imageRes.data)
    .ensureAlpha()
    .joinChannel(mask)
    .toBuffer();
  return combinedData;
}

export async function getDynamicNFTImage(classId, classData) {
  // TODO: use real og
  let { ogImageUrl } = classData;
  if (!ogImageUrl) {
    const randomHex = Math.floor(Math.random() * 16777215).toString(16);
    ogImageUrl = `https://singlecolorimage.com/get/${randomHex}/512x512`;
  }
  return getMaskedNFTImage(ogImageUrl);
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
    image: `https://${EXTERNAL_HOSTNAME}/likernft/metadata/image/class_${classId}.png`,
    backgroundColor,
  };
}

export async function getISCNDocByClassID(classId) {
  const iscnQuery = await likeNFTCollection.where('classId', '==', classId).limit(1).get();
  if (!iscnQuery.docs.length) {
    throw new ValidationError('NFT_CLASS_NOT_FOUND');
  }
  return iscnQuery.docs[0];
}

export default getLikerNFTDynamicData;
