/* eslint-disable @typescript-eslint/no-unused-vars */
export async function getLIKEPrice({ raw = false } = {}) {
  return Promise.resolve(raw ? 0.0015 : 0.001);
}

export async function getMaticPriceInLIKE() {
  return Promise.resolve(600);
}

export default getLIKEPrice();
