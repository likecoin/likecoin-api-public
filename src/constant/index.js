export const { IS_TESTNET } = process.env;

export const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.CI;

export const ETH_NETWORK_NAME = IS_TESTNET ? 'rinkeby' : 'mainnet';

export const INFURA_HOST = IS_TESTNET ? 'https://rinkeby.infura.io/v3/9a6771595426445cb247e83d4ad85645' : 'https://mainnet.infura.io/v3/9a6771595426445cb247e83d4ad85645';

export const MIN_USER_ID_LENGTH = 7;

export const MAX_USER_ID_LENGTH = 20;

/* TEMP: reformat medium referrer into medium post */
export const MEDIUM_REGEX = /^(?:https?:\/\/)?[^/]*\/media\/[a-zA-Z0-9_]+(?:\?postId=([a-zA-Z0-9_]+))?/;

export const PUBSUB_TOPIC_MISC = 'misc';

export const LOGIN_MESSAGE = 'Login - Reinventing the Like';

export const EXTERNAL_HOSTNAME = process.env.EXTERNAL_HOSTNAME || (IS_TESTNET ? 'rinkeby.like.co' : 'like.co');

export const API_EXTERNAL_HOSTNAME = process.env.API_EXTERNAL_HOSTNAME || `api.${EXTERNAL_HOSTNAME}`;

export const GETTING_STARTED_TASKS = ['taskSocial', 'taskOnepager', 'taskVideo', 'taskPaymentPage'];

export const TRANSACTION_QUERY_LIMIT = 10;

export const KNOWN_EMAIL_HOSTS = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'yahoo.com.tw',
  'yahoo.com.hk',
  'protonmail.com',
  'qq.com',
  'vip.qq.com',
  'sina.com',
  '163.com',
  'privaterelay.appleid.com',
  'icloud.com',
];

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

export const SUPPORTED_AVATAR_TYPE = new Set([
  'jpg',
  'png',
  'gif',
  'webp',
  'tif',
  'bmp',
]);

export const AVATAR_DEFAULT_PATH = 'https://static.like.co/likecoin_de-portrait.jpg';

export const DEFAULT_FOLLOW_IDS = [
  'foundation',
  'hi176-matters',
];

export const QUERY_STRING_TO_REMOVE = [
  'fbclid',
  'gclid',
  'gi',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  '__cf_chl_captcha_tk__',
  '__cf_chl_jschl_tk__',
  'ldtag_cl',
];

export const ONE_HOUR_IN_S = 3600;
export const ONE_DAY_IN_S = 86400;
export const ONE_DAY_IN_MS = 86400000;
export const CIVIC_LIKER_START_DATE = 1546272000000; // 2019-01-01T00:00:00+0800
export const SUBSCRIPTION_GRACE_PERIOD = 0 * ONE_DAY_IN_MS;

export const COMMON_COOKIE_OPTION = {
  maxAge: 31556926000, // 365d
  secure: !TEST_MODE,
  httpOnly: true,
};

export const AUTH_COOKIE_OPTION = {
  ...COMMON_COOKIE_OPTION,
  domain: TEST_MODE ? undefined : '.like.co',
  sameSite: TEST_MODE ? false : 'lax',
};

export const BUTTON_COOKIE_OPTION = {
  ...COMMON_COOKIE_OPTION,
  domain: TEST_MODE ? undefined : `.${IS_TESTNET ? 'rinkeby.' : ''}like.co`,
  sameSite: TEST_MODE ? false : 'none',
};

export const RPC_TX_UPDATE_COOKIE_KEY = 'like_rpc_update_token';

// TODO: duplicate with ../../constant.js
export const W3C_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
export const EMAIL_REGEX = IS_TESTNET ? /.*/ : W3C_EMAIL_REGEX;

export const API_DEFAULT_SIZE_LIMIT = 4096;

export const TWITTER_USER_ID_STR = '913375304357339136'; // likecoin_fdn
export const TWITTER_STATUS_ID_STR = '1126374337575972864';

export const OICE_API_HOST = IS_TESTNET ? 'https://oice.com/api' : 'https://oicetest.lakoo.com/api';

export const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/coins/likecoin?localization=false';
export const COINMARKETCAP_PRICE_URL = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest';
export const LIKE_DEFAULT_PRICE = 0.0082625;

export const KICKBOX_DISPOSIBLE_API = 'https://open.kickbox.com/v1/disposable';

export const COINGECKO_AR_LIKE_PRICE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=arweave,likecoin&vs_currencies=usd';

export const LIKECOIN_DARK_GREEN_THEME_COLOR = '#28646E';

export const APP_LIKE_CO_ISCN_VIEW_URL = `https://app.${IS_TESTNET ? 'rinkeby.' : ''}like.co/view/`;
