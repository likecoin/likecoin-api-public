import { Router } from 'express';
import axios from 'axios';
import { ONE_DAY_IN_S, API_EXTERNAL_HOSTNAME } from '../../constant';
import { likeNFTCollection, iscnInfoCollection } from '../../util/firebase';
import { filterLikeNFTMetadata } from '../../util/ValidationHelper';
import { getISCNIdByClassId } from '../../util/api/likernft';
import {
  getLikerNFTDynamicData, getImage,
} from '../../util/api/likernft/metadata';
import { getNFTISCNData, getNFTClassDataById, getNFTOwner } from '../../util/cosmos/nft';
import { fetchISCNIdAndClassId } from '../../middleware/likernft';
import { getISCNPrefix } from '../../util/cosmos/iscn';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../config/config';
import { ValidationError } from '../../util/ValidationError';
import { sleep } from '../../util/misc';

const router = Router();

router.get(
  '/metadata',
  fetchISCNIdAndClassId,
  async (_, res, next) => {
    try {
      const { classId, iscnId, iscnPrefix } = res.locals;
      const classDocRef = likeNFTCollection.doc(iscnPrefix).collection('class').doc(classId);

      const classDoc = await classDocRef.get();
      const classData = classDoc.data();
      if (!classData) {
        res.status(404).send('NFT_DATA_NOT_FOUND');
        return;
      }
      const [{ owner: iscnOwner, data: iscnData }, chainData, dynamicData] = await Promise.all([
        getNFTISCNData(iscnId).catch((err) => { console.error(err); return {}; }),
        getNFTClassDataById(classId).catch(err => console.error(err)),
        getLikerNFTDynamicData(classId, classData).catch(err => console.error(err)),
      ]);
      if (!iscnData) throw new ValidationError('ISCN_NOT_FOUND');
      if (!chainData) throw new ValidationError('NFT_CLASS_NOT_FOUND');
      if (!dynamicData) throw new ValidationError('NFT_CLASS_NOT_REGISTERED');

      res.set('Cache-Control', `public, max-age=${60}, s-maxage=${60}, stale-if-error=${ONE_DAY_IN_S}`);
      res.json(filterLikeNFTMetadata({
        iscnId: getISCNPrefix(iscnId),
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
  fetchISCNIdAndClassId,
  async (_, res, next) => {
    try {
      const { classId, iscnPrefix } = res.locals;
      const nftQuery = await likeNFTCollection.doc(iscnPrefix)
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
      res.set('Cache-Control', `public, max-age=${60}, s-maxage=${60}, stale-if-error=${ONE_DAY_IN_S}`);
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
      const iscnId = await getISCNIdByClassId(classId);
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
      let title = '';
      if (iscnData.exists) {
        ({ image, title } = iscnData.data());
      }
      const finalPng = await getImage(image, title);
      res.set('Cache-Control', `public, max-age=${60}, s-maxage=${60}, stale-if-error=${ONE_DAY_IN_S}`);
      finalPng.pipe(res);
      return;
    } catch (err) {
      next(err);
    }
  },
);

export default router;
