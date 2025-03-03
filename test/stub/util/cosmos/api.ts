/* eslint-disable @typescript-eslint/no-unused-vars */
const stubCosmosAPI = {
  get(path) {
    let value = {};
    if (path.startsWith('/auth/accounts/')) {
      value = {
        sequence: '0', account_number: '0',
      };
    }
    return { status: 200, data: { result: { value } } } as any;
  },
  post() {
    const value = {};
    return { status: 200, data: { result: { value } } } as any;
  },
};

console.log('Using stub (cosmos/api.js)'); /* eslint no-console: "off" */

export const createAPIEndpoint = (_: string) => stubCosmosAPI;

export default createAPIEndpoint;
