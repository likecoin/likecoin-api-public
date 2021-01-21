import { Router } from 'express';
import { userCollection as dbRef } from '../../../util/firebase';
import { jwtAuth } from '../../../middleware/jwt';
import { getCosmosDelegatorAddress, signISCNTransaction } from '../../../util/cosmos/iscn';
import { ValidationError } from '../../../util/ValidationError';

const router = Router();

router.post('/sign', jwtAuth('write'), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) throw new ValidationError('MISSING_MESSAGE');
    const { value: { iscnKernel } = {}, type } = message;
    if (type !== 'likechain/MsgCreateISCN') throw new ValidationError('INVALID_MESSAGE_TYPE');
    const {
      content,
      rights: { rights },
      stakeholders: { stakeholders },
      version,
      parent = null,
      timestamp,
    } = iscnKernel;
    if (version !== 1) throw new ValidationError('INVALID_ISCN_VERSION');
    if (!content || !rights || !stakeholders) {
      throw new ValidationError('MISSING_REQUIRED_PAYLOAD');
    }
    const { user } = req.user;
    const userDoc = await dbRef.doc(user).get();
    const userData = userDoc.data();
    if (!userData || !userData.cosmosWallet) {
      throw new ValidationError('MISSING_COSMOS_ADDRESS');
    }
    const [{ stakeholder } = {}] = stakeholders;
    const [{ holder } = {}] = rights;
    if (!stakeholder
      || !holder
      || stakeholder.id !== userData.cosmosWallet
      || holder.id !== userData.cosmosWallet) {
      throw new ValidationError('LOGIN_NEEDED');
    }
    const signedTx = await signISCNTransaction({
      type: 'likechain/MsgCreateISCN',
      value: {
        from: getCosmosDelegatorAddress(),
        iscnKernel: {
          content,
          rights: { rights },
          stakeholders: { stakeholders },
          parent,
          timestamp: process.env.CI ? timestamp : `${new Date().toISOString().substring(0, 19)}Z`,
          version: 1,
        },
      },
    });
    return res.json({ signedTx });
  } catch (err) {
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});

export default router;
