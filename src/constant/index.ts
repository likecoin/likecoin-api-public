export const { IS_TESTNET } = process.env;

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = process.env.PORT || '3000';

export const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.CI;

export const ETH_NETWORK_NAME = IS_TESTNET ? 'rinkeby' : 'mainnet';

export const MIN_USER_ID_LENGTH = 5;

export const MAX_USER_ID_LENGTH = 20;

/* TEMP: reformat medium referrer into medium post */
export const MEDIUM_REGEX = /^(?:https?:\/\/)?[^/]*\/media\/[a-zA-Z0-9_]+(?:\?postId=([a-zA-Z0-9_]+))?/;

export const PUBSUB_TOPIC_MISC = 'misc';

export const PUBSUB_TOPIC_WNFT = 'wnft';

export const LOGIN_MESSAGE = 'Login - Reinventing the Like';

export const EXTERNAL_HOSTNAME = process.env.EXTERNAL_HOSTNAME || (IS_TESTNET ? 'rinkeby.like.co' : 'like.co');

export const INTERNAL_HOSTNAME = `${HOST}:${PORT}`;

export const API_HOSTNAME = IS_TESTNET ? 'api.rinkeby.like.co' : 'api.like.co';

export const LIKER_LAND_HOSTNAME = IS_TESTNET ? 'rinkeby.liker.land' : 'liker.land';

export const NFT_BOOKSTORE_HOSTNAME = IS_TESTNET ? 'publish.sepolia.3ook.com' : 'publish.3ook.com';

export const APP_LIKE_CO_HOSTNAME = IS_TESTNET ? 'app.rinkeby.like.co' : 'app.like.co';

export const API_EXTERNAL_HOSTNAME = process.env.API_EXTERNAL_HOSTNAME || `api.${EXTERNAL_HOSTNAME}`;

export const BOOK3_HOSTNAME = IS_TESTNET ? 'sepolia.3ook.com' : '3ook.com';

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

export const DEFAULT_AVATAR_SIZE = 400;

export const DEFAULT_FOLLOW_IDS = [
  'foundation',
  'hi176-matters',
];

export const QUERY_STRING_TO_REMOVE = [
  'fbclid',
  'gclid',
  'gi',
  'gad_source',
  'utm_id',
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

export const USD_TO_HKD_RATIO = 7.8;

export const KICKBOX_DISPOSIBLE_API = 'https://open.kickbox.com/v1/disposable';

export const COINGECKO_AR_LIKE_PRICE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=arweave,matic-network,likecoin&vs_currencies=usd';

export const WRITING_NFT_COLLECTION_ID = 'likerland_writing_nft';

export const NFT_GEM_COLOR = [
  '#F7F7F7',
  '#EBEBEB',
  '#EBEBEB',
  '#EBEBEB',
  '#D0D0D0',
  '#D0D0D0',
  '#50E3C2',
  '#50E3C2',
  '#6CCAFF',
  '#6CCAFF',
  '#FDAFFF',
  '#FDAFFF',
  '#FFD748',
  '#FFD748',
  '#FF6464',
  '#C0E1FF',
];

export const FIRESTORE_IN_QUERY_LIMIT = 10;

export const FIRESTORE_BATCH_SIZE = 200;

export const NFT_BOOK_DEFAULT_FROM_CHANNEL = 'liker_land';

export const MAXIMUM_CUSTOM_PRICE_IN_DECIMAL = 99999999;

export const STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS = [
  'latest_charge.balance_transaction',
  'latest_charge.application_fee',
];

export const CUSTOMER_SERVICE_URL = 'mailto:cs@3ook.com';
export const CUSTOMER_SERVICE_EMAIL = '"3ook.com" <cs@3ook.com>';
export const SALES_EMAIL = '"3ook.com" <sales@3ook.com>';
export const SYSTEM_EMAIL = '"3ook.com" <cs@3ook.com>';

export const LIKER_LAND_WAIVED_CHANNEL = 'liker_land_waived';

export const ARWEAVE_GATEWAY = 'https://gateway.irys.xyz';

export const MIN_BOOK_PRICE_DECIMAL = 90; // 0.90 USD
export const NFT_BOOK_TEXT_LOCALES = ['zh', 'en'];
export const NFT_BOOK_TEXT_DEFAULT_LOCALE = NFT_BOOK_TEXT_LOCALES[0];

export const CACHE_BUCKET = IS_TESTNET ? 'liker-land-ebook-cache-dev' : 'liker-land-ebook-cache-main';
export const MAX_PNG_FILE_SIZE = 1 * 1024 * 1024; // 1MB

export const PLUS_MONTHLY_PRICE = 9.99;
export const PLUS_YEARLY_PRICE = 99.99;
