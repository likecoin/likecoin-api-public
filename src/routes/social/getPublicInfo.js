import { Router } from 'express';

import {
  DISPLAY_SOCIAL_MEDIA_OPTIONS,
} from '../../constant';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { getLinkOrderMap } from '../../util/api/social';
import { filterSocialPlatformPublic } from '../../util/ValidationHelper';

const router = Router();

router.get('/list/:id', async (req, res, next) => {
  try {
    const username = req.params.id;
    const { type } = req.query;

    const col = await dbRef.doc(username).collection('social').get();

    const linkOrderMap = getLinkOrderMap(col);
    const replyObj = {};
    let displaySocialMediaOption = DISPLAY_SOCIAL_MEDIA_OPTIONS[0];
    col.docs.forEach((d) => {
      if (d.id === 'meta') {
        const { displaySocialMediaOption: option } = d.data();
        if (option) displaySocialMediaOption = option;
      }

      const { isLinked, isPublic, isExternalLink } = d.data();
      if ((isLinked || isExternalLink) && isPublic !== false) {
        replyObj[d.id] = filterSocialPlatformPublic({ ...d.data() });
        if (isExternalLink) replyObj[d.id].order = linkOrderMap[d.id];
      }
    });

    const shouldShowList = (
      !type
      || displaySocialMediaOption === 'all'
      || displaySocialMediaOption === type
    );
    if (shouldShowList) {
      res.json(replyObj);
    } else {
      res.json({});
    }
  } catch (err) {
    next(err);
  }
});

export default router;
