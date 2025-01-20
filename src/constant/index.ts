export const { IS_TESTNET } = process.env;

export const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.CI;

export const ETH_NETWORK_NAME = IS_TESTNET ? 'rinkeby' : 'mainnet';

export const INFURA_HOST = IS_TESTNET ? 'https://goerli.infura.io/v3/9a6771595426445cb247e83d4ad85645' : 'https://mainnet.infura.io/v3/9a6771595426445cb247e83d4ad85645';

export const MIN_USER_ID_LENGTH = 5;

export const MAX_USER_ID_LENGTH = 20;

/* TEMP: reformat medium referrer into medium post */
export const MEDIUM_REGEX = /^(?:https?:\/\/)?[^/]*\/media\/[a-zA-Z0-9_]+(?:\?postId=([a-zA-Z0-9_]+))?/;

export const PUBSUB_TOPIC_MISC = 'misc';

export const PUBSUB_TOPIC_WNFT = 'wnft';

export const LOGIN_MESSAGE = 'Login - Reinventing the Like';

export const EXTERNAL_HOSTNAME = process.env.EXTERNAL_HOSTNAME || (IS_TESTNET ? 'rinkeby.like.co' : 'like.co');

export const API_HOSTNAME = IS_TESTNET ? 'api.rinkeby.like.co' : 'api.like.co';

export const LIKER_LAND_HOSTNAME = IS_TESTNET ? 'rinkeby.liker.land' : 'liker.land';

export const NFT_BOOKSTORE_HOSTNAME = IS_TESTNET ? 'likecoin-nft-book-press-testnet.netlify.app' : 'likecoin.github.io/nft-book-press';

export const APP_LIKE_CO_HOSTNAME = IS_TESTNET ? 'app.rinkeby.like.co' : 'app.like.co';

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

export const WNFT_DEFAULT_PATH = 'https://static.like.co/writing-nft.jpg';

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

export const LIKECOIN_DARK_GREEN_THEME_COLOR = '#28646E';

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

export const APP_LIKE_CO_ISCN_VIEW_URL = `https://app.${IS_TESTNET ? 'rinkeby.' : ''}like.co/view/`;

export const FIRESTORE_IN_QUERY_LIMIT = 10;

export const FIRESTORE_BATCH_SIZE = 200;

export const NFT_BOOK_SALE_DESCRIPTION = {
  likenft19symzw3xmh42gukzts858wf6rsdkn6e4jtc9wp8jh4kphfmffy5s6acyxg: '「天覆地載，物號數萬。從石器到陶瓷，從日晷到鐘錶，從毛筆到鉛字，從算盤到電腦，從書本到 NFT，人和物自古也是一體。我們都是『人物』，而『人物』都有故事。」\n- 董啟章《天工開物．栩栩如真》再版的話\n\n這是董啟章的第一次NFT出版實驗，也邀請你一起進入可能的世界——回溯舊物承載的香港歷史，在想像的文字工場裡感受創造。本書加入全新章節，新版序言帶你緩緩睜開雙眼，在人工智能、虛擬貨幣、區塊鏈與NFT之間穿梭冒險⋯⋯天工開物，所以迷人。',
};

export const NFT_BOOK_DEFAULT_FROM_CHANNEL = 'liker_land';

export const LIST_OF_BOOK_SHIPPING_COUNTRY = [
  'AU', 'AT', 'BE', 'CA', 'CN', 'HK', 'MO', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'GL', 'HU', 'IS', 'IT', 'JP', 'KR', 'LU', 'SG', 'MY', 'NZ', 'NO', 'PH', 'ES', 'SE', 'CH', 'TW', 'TH', 'GB', 'US', 'VN',
];

export const MAXIMUM_CUSTOM_PRICE_IN_DECIMAL = 99999999;

export const STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS = [
  'latest_charge.balance_transaction',
  'latest_charge.application_fee',
];

export const CUSTOMER_SERVICE_URL = 'https://go.crisp.chat/chat/embed/?website_id=5c009125-5863-4059-ba65-43f177ca33f7';
export const CUSTOMER_SERVICE_EMAIL = '"Liker Land Bookstore CS" <cs@liker.land>';
export const SALES_EMAIL = '"Liker Land Bookstore Sales" <sales@liker.land>';

export const LIKER_LAND_WAIVED_CHANNEL = 'liker_land_waived';

export const ARWEAVE_GATEWAY = IS_TESTNET ? 'https://gateway.irys.xyz' : 'https://arweave.net';

export const MIN_BOOK_PRICE_DECIMAL = 90; // 0.90 USD
export const NFT_BOOK_TEXT_LOCALES = ['en', 'zh'];
export const NFT_BOOK_TEXT_DEFAULT_LOCALE = NFT_BOOK_TEXT_LOCALES[0];
