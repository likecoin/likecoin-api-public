import test from 'ava';
import axiosist from './axiosist';
import {
  testingUser1,
  testingDisplayName1,
  testingCosmosWallet1,
  testingUser2,
} from './data';
import { ISCN_SECRET_ADDRESS } from './cosmos';

const { jwtSign } = require('./jwt');

function getMessage(id, displayName, cosmosWallet) {
  return {
    type: 'likechain/MsgCreateISCN',
    value: {
      from: ISCN_SECRET_ADDRESS,
      iscnKernel: {
        content: {
          fingerprint: 'ipfs://QmcTD5FbyBimKbd3EZ8PtR19PyeMnouZ7hZ178z75hZGrs',
          tags: [
            'iscn',
          ],
          title: 'iscn',
          type: 'article',
          version: 1,
        },
        parent: null,
        rights: {
          rights: [
            {
              holder: {
                description: `LikerID: ${id}`,
                id: cosmosWallet,
                name: displayName,
              },
              period: {
                from: '2021-01-20T08:06:42Z',
              },
              terms: {
                '/': 'QmRvpQiiLA8ttSLAXEd5RArmXeG4qWEsKPmrB7KeiLSuE4',
              },
              type: 'License',
            },
          ],
        },
        stakeholders: {
          stakeholders: [
            {
              sharing: 100,
              stakeholder: {
                description: `LikerID: ${id}`,
                id: cosmosWallet,
                name: displayName,
              },
              type: 'Creator',
            },
            {
              sharing: 0,
              stakeholder: {
                description: 'Matters is a decentralized, cryptocurrency driven content creation and discussion platform.',
                id: 'https://matters.news/',
                name: 'Matters',
              },
              type: 'Publisher',
            },
          ],
        },
        timestamp: '2021-01-20T08:06:42Z',
        version: 1,
      },
    },
  };
}

test('ISCN: Sign. Case: success', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const message = getMessage(testingUser1,
    testingDisplayName1,
    testingCosmosWallet1);
  const res = await axiosist.post('/api/cosmos/iscn-dev/signer/sign',
    { message },
    {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
  t.is(res.status, 200);
  t.is(res.data.signedTx.signatures[0].sequence, '0');
  t.is(res.data.signedTx.signatures[0].signature, 'kFpv7tcPjbSIdabq6ihod69/NxQsj93zerUZ27Dy3gJAWleySXrlQzSygvIM0vF9tJHcGikonaCyPNl8v6h58g==');
});

test('ISCN: Sign. Case: wrong user', async (t) => {
  const user = testingUser2;
  const token = jwtSign({ user });
  const message = getMessage(testingUser2,
    testingDisplayName1,
    testingCosmosWallet1);
  const res = await axiosist.post('/api/cosmos/iscn-dev/signer/sign',
    { message },
    {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
  t.is(res.status, 400);
  t.is(res.data, 'LOGIN_NEEDED');
});

test('ISCN: Sign. Case: Invalid message type', async (t) => {
  const user = testingUser1;
  const token = jwtSign({ user });
  const message = getMessage(testingUser1,
    testingDisplayName1,
    testingCosmosWallet1);
  message.type = 'transfer';
  const res = await axiosist.post('/api/cosmos/iscn-dev/signer/sign',
    { message },
    {
      headers: {
        Accept: 'application/json',
        Cookie: `likecoin_auth=${token}`,
      },
    });
  t.is(res.status, 400);
  t.is(res.data, 'INVALID_MESSAGE_TYPE');
});
