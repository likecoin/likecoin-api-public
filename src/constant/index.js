export const { IS_TESTNET } = process.env;

export const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.CI;

export const ETH_NETWORK_NAME = IS_TESTNET ? 'rinkeby' : 'mainnet';

export const INFURA_HOST = IS_TESTNET ? 'https://rinkeby.infura.io/v3/9a6771595426445cb247e83d4ad85645' : 'https://mainnet.infura.io/v3/9a6771595426445cb247e83d4ad85645';

/* TEMP: reformat medium referrer into medium post */
export const MEDIUM_REGEX = /^(?:https?:\/\/)?[^/]*\/media\/[a-zA-Z0-9_]+(?:\?postId=([a-zA-Z0-9_]+))?/;

export const PUBSUB_TOPIC_MISC = 'misc';

export const LOGIN_MESSAGE = 'Login - Reinventing the Like';

export const EXTERNAL_HOSTNAME = IS_TESTNET ? 'rinkeby.like.co' : 'like.co';

export const GETTING_STARTED_TASKS = ['taskSocial', 'taskOnepager', 'taskVideo', 'taskPaymentPage'];

export const TRANSACTION_QUERY_LIMIT = 10;

export const EXTRA_EMAIL_BLACLIST = [
  'tutye.com',
];

export const LOGIN_CONNECTION_LIST = [
  'google',
  'facebook',
  'twitter',
];

export const OTHER_CONNECTION_LIST = [
  'medium',
  'flickr',
];

export const IS_LOGIN_SOCIAL = new Set(LOGIN_CONNECTION_LIST);

export const LINK_ICON_TYPES = ['profile', 'blog', 'photo', 'mail', 'contact', 'link'];

export const DISPLAY_SOCIAL_MEDIA_OPTIONS = [
  'all', // default
  'wp',
  'medium',
];

export const SUPPORTED_AVATER_TYPE = new Set([
  'jpg',
  'png',
  'gif',
  'webp',
  'tif',
  'bmp',
]);

export const AVATAR_DEFAULT_PATH = 'https://static.like.co/likecoin_de-portrait.jpg';

export const ONE_DAY_IN_MS = 86400000;
export const CIVIC_LIKER_START_DATE = 1546272000000; // 2019-01-01T00:00:00+0800
export const SUBSCRIPTION_GRACE_PERIOD = 7 * ONE_DAY_IN_MS;

export const AUTH_COOKIE_OPTION = {
  maxAge: 31556926000, // 365d
  domain: TEST_MODE ? undefined : '.like.co',
  secure: !TEST_MODE,
  httpOnly: true,
};

export const CSRF_COOKIE_OPTION = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
};

// TODO: duplicate with ../../constant.js
export const W3C_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
export const EMAIL_REGEX = IS_TESTNET ? /.*/ : W3C_EMAIL_REGEX;

export const TWITTER_USER_ID_STR = '913375304357339136'; // likecoin_fdn
export const TWITTER_STATUS_ID_STR = '1107503672349515777';

export const OICE_API_HOST = IS_TESTNET ? 'https://oice.com/api' : 'https://oicetest.lakoo.com/api';
