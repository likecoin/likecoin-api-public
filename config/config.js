const config = {};

config.FIRESTORE_USER_ROOT = process.env.FIRESTORE_USER_ROOT;
config.FIRESTORE_USER_AUTH_ROOT = process.env.FIRESTORE_USER_AUTH_ROOT;
config.FIRESTORE_SUBSCRIPTION_USER_ROOT = process.env.FIRESTORE_SUBSCRIPTION_USER_ROOT;
config.FIRESTORE_TX_ROOT = process.env.FIRESTORE_TX_ROOT;
config.FIRESTORE_IAP_ROOT = process.env.FIRESTORE_IAP_ROOT;
config.FIRESTORE_PAYOUT_ROOT = process.env.FIRESTORE_PAYOUT_ROOT;
config.FIRESTORE_MISSION_ROOT = process.env.FIRESTORE_MISSION_ROOT;
config.FIRESTORE_CONFIG_ROOT = process.env.FIRESTORE_CONFIG_ROOT;
config.FIRESTORE_COUPON_ROOT = process.env.FIRESTORE_COUPON_ROOT;
config.FIRESTORE_LIKER_NFT_ROOT = process.env.FIRESTORE_LIKER_NFT_ROOT;
config.FIRESTORE_OAUTH_CLIENT_ROOT = process.env.FIRESTORE_OAUTH_CLIENT_ROOT;
config.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;
config.FIRESTORE_ISCN_INFO_ROOT = process.env.FIRESTORE_ISCN_INFO_ROOT;

config.COSMOS_LCD_INDEXER_ENDPOINT = 'https://node.testnet.like.co';
config.COSMOS_LCD_ENDPOINT = 'https://node.testnet.like.co';
config.COSMOS_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';
config.COSMOS_SIGNING_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';
config.COSMOS_CHAIN_ID = 'likecoin-public-testnet-5';
config.ISCN_DEV_LCD_ENDPOINT = 'localhost:1317';
config.ISCN_DEV_CHAIN_ID = 'iscn-dev-chain';
config.COSMOS_DENOM = 'nanoekil';
config.NFT_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';
config.NFT_SIGNING_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';
config.NFT_CHAIN_ID = 'likecoin-public-testnet-5';
config.NFT_COSMOS_DENOM = 'nanoekil';

config.ARWEAVE_LIKE_TARGET_ADDRESS = '';
config.IPFS_ENDPOINT = 'https://ipfs.infura.io:5001/api/v0';
config.REPLICA_IPFS_ENDPOINTS = [];

config.LIKER_NFT_TARGET_ADDRESS = '';
config.LIKER_NFT_FEE_ADDRESS = '';
config.LIKER_NFT_STARTING_PRICE = 8;
config.LIKER_NFT_PRICE_MULTIPLY = 2;
config.LIKER_NFT_PRICE_DECAY = 0.2;
config.LIKER_NFT_DECAY_START_BATCH = 13;
config.LIKER_NFT_DECAY_END_BATCH = 18;
config.LIKER_NFT_GAS_FEE = '200000';


config.AUTHCORE_API_ENDPOINT = '';
config.AUTHCORE_PUBLIC_CERT_PATH = '';
config.AUTHCORE_PRIVATE_KEY_PATH = '';
config.AUTHCORE_SERVICE_ACCOUNT_ID = '';
config.AUTHCORE_SECRETD_STATIC_KEY = '';
config.AUTHCORE_WEB_HOOK_SECRET = '';

config.LIKECO_INTERNAL_API_ENDPOINT = '';
config.LIKECO_INTERNAL_API_KEY = '';

config.JWT_PUBLIC_CERT_PATH = '';
config.JWT_PRIVATE_KEY_PATH = '';
config.ECDSA_JWT_PUBLIC_CERT_PATH = '';
config.ECDSA_JWT_PRIVATE_KEY_PATH = '';
config.PROVIDER_JWT_COMMON_SECRET = '';

config.INTERCOM_USER_HASH_SECRET = '';
config.INTERCOM_USER_ANDROID_HASH_SECRET = '';
config.INTERCOM_USER_IOS_HASH_SECRET = '';

config.CRISP_USER_HASH_SECRET = '';

config.TWITTER_CONSUMER_KEY = '';
config.TWITTER_CONSUMER_SECRET = '';
config.TWITTER_ACCESS_TOKEN = '';
config.TWITTER_ACCESS_TOKEN_SECRET = '';

config.TWITTER_API_KEY = '';
config.TWITTER_API_SECRET = '';

config.FACEBOOK_APP_ID = '';
config.FACEBOOK_APP_SECRET = '';

config.FLICKR_APP_KEY = '';
config.FLICKR_APP_SECRET = '';

config.MEDIUM_APP_ID = '';
config.MEDIUM_APP_SECRET = '';

config.MATTERS_APP_ID = '';
config.MATTERS_APP_SECRET = '';

config.REGISTER_LIMIT_WINDOW = 3600000; // 1hour
config.REGISTER_LIMIT_COUNT = 0; // 0 = disable
config.NEW_USER_BONUS_COOLDOWN = 259200000; // 3 days

config.GCLOUD_PUBSUB_MAX_MESSAGES = 10;
config.GCLOUD_PUBSUB_MAX_WAIT = 1000;
config.GCLOUD_PUBSUB_ENABLE = false;
config.APP_SERVER = 'likecoin-api-pulic';

config.CMC_PRO_API_KEY = '';
config.CMC_API_CACHE_S = 300;

config.IS_CHAIN_UPGRADING = false;

module.exports = config;
