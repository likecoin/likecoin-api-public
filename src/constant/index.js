export const { IS_TESTNET } = process.env;

export const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.CI;

export const ETH_NETWORK_NAME = IS_TESTNET ? 'rinkeby' : 'mainnet';

export const INFURA_HOST = IS_TESTNET ? 'https://rinkeby.infura.io/v3/9a6771595426445cb247e83d4ad85645' : 'https://mainnet.infura.io/v3/9a6771595426445cb247e83d4ad85645';

export const PUBSUB_TOPIC_MISC = 'misc';

export const LOGIN_MESSAGE = 'Login - Reinventing the Like';

export const EXTERNAL_HOSTNAME = IS_TESTNET ? 'rinkeby.like.co' : 'like.co';

export const GETTING_STARTED_TASKS = ['taskSocial', 'taskOnepager', 'taskVideo', 'taskPaymentPage'];

export const DISPLAY_SOCIAL_MEDIA_OPTIONS = [
  'all', // default
  'wp',
  'medium',
];

export const AVATAR_DEFAULT_PATH = 'https://static.like.co/likecoin_de-portrait.jpg';

export const ONE_DAY_IN_MS = 86400000;
export const SUBSCRIPTION_GRACE_PERIOD = 7 * ONE_DAY_IN_MS;

