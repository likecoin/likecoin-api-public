import { Router } from 'express';
import {
  ONE_DAY_IN_S, WRITING_NFT_COLLECTION_ID, API_HOSTNAME,
} from '../../constant';
import { filterLikeNFTMetadata, sendValidatedJSON } from '../../util/ValidationHelper';
import {
  getClassMetadata,
  getBasicImage,
  getResizedImage,
  DEFAULT_NFT_IMAGE_WIDTH,
  parseImageURLFromMetadata,
} from '../../util/api/likernft/metadata';
import { getNFTClassDataById } from '../../util/cosmos/nft';
import { fetchISCNPrefixAndClassId, normalizeClassIdParam } from '../../middleware/likernft';
import { validateParams, validateQuery } from '../../middleware/validate';
import {
  LikernftClassQuerySchema,
  LikernftClassIdParamsSchema,
  LikernftImageQuerySchema,
  LikeNFTMetadataResponseSchema,
} from '../../util/api/likernft/schemas';
import { ValidationError } from '../../util/ValidationError';
import { BOOK_MODEL_GLTF, CLASS_ID_PLACEHOLDER, IMAGE_URI_PLACEHOLDER } from '../../constant/model';

const router = Router();

router.param('classId', normalizeClassIdParam);

// Classes without decodable ClassData carry no `data`, so default it rather
// than let the destructure throw a 500 on what is really a 404-ish class.
async function getClassChainData(classId: string) {
  const chainData = await getNFTClassDataById(classId);
  if (!chainData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
  const { name, data: { metadata = {} } = {} } = chainData;
  return { name, metadata };
}

router.get(
  '/metadata',
  validateQuery(LikernftClassQuerySchema),
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId, iscnPrefix } = res.locals;
      const {
        iscnOwner,
        iscnData,
        metadata,
      } = await getClassMetadata({ classId, iscnPrefix });
      res.set('Cache-Control', `public, max-age=${60}, s-maxage=${60}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      sendValidatedJSON(res, LikeNFTMetadataResponseSchema, filterLikeNFTMetadata({
        iscnId: iscnPrefix,
        iscnOwner,
        iscnStakeholders: iscnData.stakeholders,
        iscnRecordTimestamp: iscnData.recordTimestamp,
        ...metadata,
      }));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  ['/image/class_:classId', '/image/class_:classId.png', '/metadata/image/class_:classId', '/metadata/image/class_:classId.png'],
  validateParams(LikernftClassIdParamsSchema),
  validateQuery(LikernftImageQuerySchema),
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { size: inputSizeStr = DEFAULT_NFT_IMAGE_WIDTH } = req.query;
      const inputSizeNum = parseInt(inputSizeStr as string, 10);
      if (Number.isNaN(inputSizeNum)) {
        throw new ValidationError('Invalid size');
      }
      const size = Math.min(Math.max(inputSizeNum, 1), 1920);
      const { name, metadata } = await getClassChainData(classId);
      const { image: chainImage } = metadata;
      const title = name || 'Writing NFT';
      const {
        image: basicImage,
        contentType,
        isDefault: isImageMissing,
      } = await getBasicImage(parseImageURLFromMetadata(chainImage), title);
      const resizedImage = getResizedImage(size);
      // Disable image mask for now
      // const combinedImage = await getCombinedImage();
      const cacheTime = isImageMissing ? 60 : 3600;
      res.set('Cache-Control', `public, max-age=${cacheTime}, s-maxage=${cacheTime}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      res.type(contentType);
      basicImage
        .pipe(resizedImage)
        // .pipe(combinedImage)
        .pipe(res);
      return;
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  ['/model/class_:classId.gltf', '/metadata/model/class_:classId.gltf'],
  validateParams(LikernftClassIdParamsSchema),
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { metadata } = await getClassChainData(classId);
      const {
        is_custom_image: isCustomImage,
        nft_meta_collection_id: collectionId = '',
        uri,
        image = '',
      } = metadata;
      if (!(collectionId === WRITING_NFT_COLLECTION_ID || collectionId.includes('book'))) {
        throw new ValidationError('NOT_WRITING_NFT_OR_NFT_BOOK');
      }
      const imageUrl = (isCustomImage || !uri) ? parseImageURLFromMetadata(image) : `https://${API_HOSTNAME}/likernft/metadata/image/class_${classId}?size=1024`;
      let model = BOOK_MODEL_GLTF.replace(new RegExp(CLASS_ID_PLACEHOLDER, 'g'), classId as string);
      model = model.replace(new RegExp(IMAGE_URI_PLACEHOLDER, 'g'), imageUrl);
      res.set('Cache-Control', `public, max-age=3600, s-maxage=3600, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      res.type('model/gltf+json');
      res.status(200).send(model);
      return;
    } catch (err) {
      next(err);
    }
  },
);

export default router;
