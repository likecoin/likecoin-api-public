import secp256k1 from 'secp256k1';
import bech32 from 'bech32';
import createHash from 'create-hash';
import jsonStringify from 'fast-json-stable-stringify';

export const ISCN_SECRET_ADDRESS = 'cosmos1l3e9pgs3mmwuwrh95fecme0s0qtn2880f2jmfe';

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
    const { signature: signatureArr } = secp256k1.ecdsaSign(msgHash, privateKey);
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
  return signer.sign(signBytes);
}

export default ISCN_SECRET_ADDRESS;
