import { Router } from 'express';
import axios from 'axios';
import { ONE_DAY_IN_S, API_EXTERNAL_HOSTNAME } from '../../constant';
import { likeNFTCollection, iscnInfoCollection } from '../../util/firebase';
import { filterLikeNFTMetadata } from '../../util/ValidationHelper';
import { getISCNPrefixByClassId } from '../../util/api/likernft';
import {
  getLikerNFTDynamicData, getBasicImage, /* getCombinedImage, */ getResizedImage,
} from '../../util/api/likernft/metadata';
import { getNFTISCNData, getNFTClassDataById, getNFTOwner } from '../../util/cosmos/nft';
import { fetchISCNPrefixAndClassId } from '../../middleware/likernft';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../config/config';
import { ValidationError } from '../../util/ValidationError';
import { sleep } from '../../util/misc';

const router = Router();

router.get(
  '/metadata',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId, iscnPrefixDocName, iscnPrefix } = res.locals;
      const classDocRef = likeNFTCollection.doc(iscnPrefixDocName).collection('class').doc(classId);

      const classDoc = await classDocRef.get();
      const classData = classDoc.data();
      if (!classData) {
        res.status(404).send('NFT_DATA_NOT_FOUND');
        return;
      }
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

      res.set('Cache-Control', `public, max-age=${60}, s-maxage=${60}, stale-if-error=${ONE_DAY_IN_S}`);
      res.json(filterLikeNFTMetadata({
        iscnId: iscnPrefix,
        iscnOwner,
        iscnStakeholders: iscnData.stakeholders,
        ...(classData.metadata || {}),
        ...chainData,
        ...dynamicData,
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
      const nftIds = nftQuery.docs.map(n => n.id);
      const ownerMap = {
        // don't include api holded wallet
        // LIKER_NFT_TARGET_ADDRESS: apiOwnedNFTIds,
      };
      const owners = await Promise.all(nftIds.map(id => getNFTOwner(classId, id)));
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
  '/metadata/image/class_(:classId)(.png)?',
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const iscnPrefix = await getISCNPrefixByClassId(classId);
      const { data } = await getNFTISCNData(iscnPrefix);
      if (!data) throw new ValidationError('ISCN_NOT_FOUND');
      const iscnId = (data && data['@id']);
      let iscnData = await iscnInfoCollection.doc(encodeURIComponent(iscnId)).get();
      if (!iscnData.exists) {
        await axios.post(
          `https://${API_EXTERNAL_HOSTNAME}/like/info`,
          { iscnId },
        );
        await sleep(1000);
        iscnData = await iscnInfoCollection.doc(encodeURIComponent(iscnId)).get();
      }
      let image = '';
      let title = 'Writing NFT';
      if (iscnData.exists) {
        ({ image, title = 'Writing NFT' } = iscnData.data());
      }
      const { image: basicImage, isDefault: isImageMissing } = await getBasicImage(image, title);
      const resizedImage = getResizedImage();
      // Disable image mask for now
      // const combinedImage = await getCombinedImage();
      const cacheTime = isImageMissing ? 60 : 3600;
      res.set('Cache-Control', `public, max-age=${cacheTime}, s-maxage=${cacheTime}, stale-if-error=${ONE_DAY_IN_S}`);
      res.type('png');
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

export default router;
