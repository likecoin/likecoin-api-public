export async function getLIKEPrice({ raw = false } = {}) {
  return Promise.resolve(raw ? 0.0015 : 0.001);
}

export async function getMaticPriceInLIKE() {
  return Promise.resolve(700);
}

export async function getArweavePriceInLIKE() {
  return Promise.resolve(5000);
}

export default getLIKEPrice();
