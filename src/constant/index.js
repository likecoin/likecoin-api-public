export const { IS_TESTNET } = process.env;

export const ETH_NETWORK_NAME = IS_TESTNET ? 'rinkeby' : 'mainnet';

export const PUBSUB_TOPIC_MISC = 'misc';

export const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.CI;

export const EXTERNAL_HOSTNAME = IS_TESTNET ? 'rinkeby.like.co' : 'like.co';

export const AVATAR_DEFAULT_PATH = 'https://static.like.co/likecoin_de-portrait.jpg';
