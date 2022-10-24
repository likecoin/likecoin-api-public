const userData = require('../data/user.json');
const txData = require('../data/tx.json');
const subscriptionData = require('../data/subscription.json');

//
// test data
//
export const testingWallet0 = '0x4aa15ea87D6fFb649343E3daBb92f244f3327518';
export const testingCosmosWallet0 = 'cosmos187290tx4vj6npyl7fdfgdvxr2n9d5qyell50d4';
export const testingLikeWallet0 = 'like187290tx4vj6npyl7fdfgdvxr2n9d5qyevrgdww';

export const {
  id: testingUser1,
  displayName: testingDisplayName1,
  email: testingEmail1,
  wallet: testingWallet1,
  cosmosWallet: testingCosmosWallet1,
  likeWallet: testingLikeWallet1,
  locale: testingUser1Locale,
  creatorPitch: testingUser1CreatorPitch,
} = userData.users[0];
export const {
  since: testingCivicLikerSince1,
  currentPeriodEnd: testingCivicLikerEnd1,
} = subscriptionData.subscriptions[0];
export const {
  id: testingUser2,
  email: testingEmail2,
  wallet: testingWallet2,
} = userData.users[1];
export const invalidWallet = '4b25758E41f9240C8EB8831cEc7F1a02686387fa';
export const testingWallet3 = '0x9113EC0624802E6BB2b13d7e123C91Aa5D130314'; // wallet that is not used
export const testingCosmosWallet3 = 'cosmos154xjc0r3770jahjnjs46qrdtezqm9htplr0cjl'; // wallet that is not used
export const testingLikeWallet3 = 'like154xjc0r3770jahjnjs46qrdtezqm9htpvln63y'; // wallet that is not used
export const {
  id: testingUser4,
  wallet: testingWallet4,
} = userData.users[4];
export const {
  id: testingUser5,
  wallet: testingWallet5,
} = userData.users[5];

export const {
  id: txHash,
  from: txFrom,
  to: txTo,
  value: txValue,
} = txData.tx[0];

export const {
  id: txHashMul,
  from: txFromMul,
  to: txToMul,
  value: txValueMul,
  toIds: txToIdsMul,
} = txData.tx[1];

export const {
  id: txHashMul2,
  from: txFromMul2,
  to: txToMul2,
  value: txValueMul2,
  toIds: txToIdsMul2,
} = txData.tx[2];

export const {
  id: txHashMul3,
  from: txFromMul3,
  to: txToMul3,
  value: txValueMul3,
  toId: txToIdMul3,
} = txData.tx[3];

export const {
  id: txHashMul4,
  from: txFromMul4,
  to: txToMul4,
  value: txValueMul4,
  toId: txToIdMul4,
} = txData.tx[4];

// confidential
export const privateKey0 = '0xbad2b5497cf7f9f3938990cb17e5b4f6f2073e435f43b5c17ed48a8e267ed56c';
export const privateKey1 = '0x3b298aeb848c19257e334160b52aae9790fbae9607bd68aea8cfcfc89572cb15';
export const privateKey2 = '0x8163e9a0e9ec131844c520d292380bd93f39fd45d1bbce5c8ae3d2a4ef0a702b';
export const privateKey3 = '0xd9d199217049b92cb321d3e636b1d6642d89af0cef08b56d61bf04467b4d3862';


export const cosmosPrivateKeyNew = '6a47b2c6557573c1e4dd82563c64a6db3abefad4ea722093b4eeec204ebd9a3a';
export const cosmosPrivateKeyDelete = 'e5c510dfa57564a887ad76bbed56dae555b3a92fd37842aaf96cb29e14242bb3';
