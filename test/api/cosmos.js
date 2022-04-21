const secp256k1 = require('secp256k1');
const bech32 = require('bech32');
const createHash = require('create-hash');
const jsonStringify = require('fast-json-stable-stringify');

export const ISCN_SECRET_ADDRESS = 'cosmos1l3e9pgs3mmwuwrh95fecme0s0qtn2880f2jmfe';

export const TEST_COSMOS_ADDRESS = 'cosmos187290tx4vj6npyl7fdfgdvxr2n9d5qyell50d4';
export const TEST_LIKE_ADDRESS = 'like187290tx4vj6npyl7fdfgdvxr2n9d5qyevrgdww';
export const TEST_COSMOS_PRIVATE_KEY = '6a47b2c6557573c1e4dd82563c64a6db3abefad4ea722093b4eeec204ebd9a3a';

function signFormatter(signPayload) {
  return {
    memo: jsonStringify(signPayload),
    msgs: [],
    fee: { gas: '1', amount: { denom: 'nanolike', amount: '0' } },
    sequence: '0',
    account_number: '0',
  };
}

function createSigner(privateKey) {
  const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
  const publicKey = Buffer.from(publicKeyArr);
  const sha256 = createHash('sha256');
  const ripemd = createHash('ripemd160');
  sha256.update(publicKey);
  ripemd.update(sha256.digest());
  const rawAddr = ripemd.digest();
  const cosmosAddress = bech32.encode('cosmos', bech32.toWords(rawAddr));
  const sign = (msg) => {
    const msgSha256 = createHash('sha256');
    msgSha256.update(jsonStringify(msg));
    const msgHash = msgSha256.digest();
    const { signature: signatureArr } = secp256k1.sign(msgHash, privateKey);
    const signature = Buffer.from(signatureArr);
    return {
      signed: msg,
      signature: {
        signature: signature.toString('base64'),
        pub_key: { value: publicKey.toString('base64') },
      },
    };
  };
  return { cosmosAddress, sign };
}

export function signWithPrivateKey(payload, privateKey) {
  const signBytes = signFormatter(payload);
  const privKey = Buffer.from(privateKey, 'hex');
  const signer = createSigner(privKey);
  return signer.sign(signBytes, privateKey);
}

export default ISCN_SECRET_ADDRESS;
