import { Router } from 'express';
import axios from 'axios';
import {
  ONE_DAY_IN_S, API_EXTERNAL_HOSTNAME, WRITING_NFT_COLLECTION_ID, API_HOSTNAME,
} from '../../constant';
import { likeNFTCollection, iscnInfoCollection } from '../../util/firebase';
import { filterLikeNFTMetadata } from '../../util/ValidationHelper';
import { getISCNPrefixByClassId } from '../../util/api/likernft';
import {
  getClassMetadata,
  getBasicImage,
  getResizedImage,
  DEFAULT_NFT_IMAGE_WIDTH,
  parseImageURLFromMetadata,
} from '../../util/api/likernft/metadata';
import { getNFTClassDataById, getNFTISCNData, getNFTOwner } from '../../util/cosmos/nft';
import { fetchISCNPrefixAndClassId } from '../../middleware/likernft';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../config/config';
import { ValidationError } from '../../util/ValidationError';
import { sleep } from '../../util/misc';
import { BOOK_MODEL_GLTF, CLASS_ID_PLACEHOLDER, IMAGE_URI_PLACEHOLDER } from '../../constant/model';

const router = Router();

router.get(
  '/metadata',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId, iscnPrefix } = res.locals;
      const {
        iscnOwner,
        iscnData,
        metadata,
      } = await getClassMetadata({ classId, iscnPrefix });
      res.set('Cache-Control', `public, max-age=${60}, s-maxage=${60}, stale-if-error=${ONE_DAY_IN_S}`);
      res.json(filterLikeNFTMetadata({
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
  '/metadata/owners',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId, iscnPrefixDocName } = res.locals;
      const nftQuery = await likeNFTCollection.doc(iscnPrefixDocName)
        .collection('class').doc(classId)
        .collection('nft')
        .where('ownerWallet', '!=', LIKER_NFT_TARGET_ADDRESS)
        .get();
      const nftIds = nftQuery.docs.map((n) => n.id);
      const ownerMap = {
        // don't include api holded wallet
        // LIKER_NFT_TARGET_ADDRESS: apiOwnedNFTIds,
      };
      const owners = await Promise.all(nftIds.map((id) => getNFTOwner(classId, id)));
      owners.forEach((owner, index) => {
        ownerMap[owner] = ownerMap[owner] || [];
        ownerMap[owner].push(nftIds[index]);
      });
      res.set('Cache-Control', `public, max-age=${6}, s-maxage=${6}, stale-if-error=${ONE_DAY_IN_S}`);
      res.json(ownerMap);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  ['/image/class_(:classId)(.png)?', '/metadata/image/class_(:classId)(.png)?'],
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { size: inputSizeStr = DEFAULT_NFT_IMAGE_WIDTH } = req.query;
      const inputSizeNum = parseInt(inputSizeStr as string, 10);
      if (Number.isNaN(inputSizeNum)) {
        throw new ValidationError('Invalid size');
      }
      const size = Math.min(Math.max(inputSizeNum, 1), 1920);
      const iscnPrefix = await getISCNPrefixByClassId(classId);
      const [{ data: ISCNData }, chainData] = await Promise.all([
        getNFTISCNData(iscnPrefix),
        getNFTClassDataById(classId),
      ]);
      if (!chainData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      if (!ISCNData) throw new ValidationError('ISCN_NOT_FOUND', 404);
      const iscnId = ISCNData && ISCNData['@id'] as string;
      if (!iscnId) throw new ValidationError('ISCN_ID_NOT_FOUND', 404);
      const { image: chainImage } = chainData.data.metadata;
      let iscnData = await iscnInfoCollection.doc(encodeURIComponent(iscnId)).get();
      if (!iscnData.exists) {
        await axios.post(
          `https://${API_EXTERNAL_HOSTNAME}/like/info`,
          { iscnId },
        );
        await sleep(1000);
        iscnData = await iscnInfoCollection.doc(encodeURIComponent(iscnId)).get();
      }
      let iscnImage = '';
      let title = 'Writing NFT';
      if (iscnData.exists) {
        ({ image: iscnImage, title = 'Writing NFT' } = iscnData.data());
      }
      const {
        image: basicImage,
        contentType,
        isDefault: isImageMissing,
      } = await getBasicImage(iscnImage, parseImageURLFromMetadata(chainImage), title);
      const resizedImage = getResizedImage(size);
      // Disable image mask for now
      // const combinedImage = await getCombinedImage();
      const cacheTime = isImageMissing ? 60 : 3600;
      res.set('Cache-Control', `public, max-age=${cacheTime}, s-maxage=${cacheTime}, stale-if-error=${ONE_DAY_IN_S}`);
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
  ['/model/class_(:classId).gltf', '/metadata/model/class_(:classId).gltf'],
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const chainData = await getNFTClassDataById(classId);
      if (!chainData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const {
        is_custom_image: isCustomImage,
        nft_meta_collection_id: collectionId,
        image = '',
      } = chainData.data.metadata;
      if (collectionId !== WRITING_NFT_COLLECTION_ID) throw new ValidationError('NOT_WRITING_NFT');
      const imageUrl = isCustomImage ? parseImageURLFromMetadata(image) : `https://${API_HOSTNAME}/likernft/metadata/image/class_${classId}?size=1024`;
      let model = BOOK_MODEL_GLTF.replace(new RegExp(CLASS_ID_PLACEHOLDER, 'g'), classId);
      model = model.replace(new RegExp(IMAGE_URI_PLACEHOLDER, 'g'), imageUrl);
      res.set('Cache-Control', `public, max-age=3600, s-maxage=3600, stale-if-error=${ONE_DAY_IN_S}`);
      res.type('model/gltf+json');
      res.status(200).send(model);
      return;
    } catch (err) {
      next(err);
    }
  },
);

export default router;
