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
config.FIRESTORE_NFT_SUBSCRIPTION_USER_ROOT = process.env.FIRESTORE_NFT_SUBSCRIPTION_USER_ROOT;
config.FIRESTORE_NFT_FREE_MINT_TX_ROOT = process.env.FIRESTORE_NFT_FREE_MINT_TX_ROOT;
config.FIRESTORE_LIKER_NFT_BOOK_CART_ROOT = process.env.FIRESTORE_LIKER_NFT_BOOK_CART_ROOT;
config.FIRESTORE_LIKER_NFT_BOOK_CMS_TAG_ROOT = process.env.FIRESTORE_LIKER_NFT_BOOK_CMS_TAG_ROOT;
config.FIRESTORE_LIKER_NFT_BOOK_ROOT = process.env.FIRESTORE_LIKER_NFT_BOOK_ROOT;
config.FIRESTORE_LIKER_NFT_BOOK_USER_ROOT = process.env.FIRESTORE_LIKER_NFT_BOOK_USER_ROOT;
config.FIRESTORE_LIKER_PLUS_GIFT_CART_ROOT = process.env.FIRESTORE_LIKER_PLUS_GIFT_CART_ROOT;
config.FIRESTORE_OAUTH_CLIENT_ROOT = process.env.FIRESTORE_OAUTH_CLIENT_ROOT;
config.FIRESTORE_ISCN_INFO_ROOT = process.env.FIRESTORE_ISCN_INFO_ROOT;
config.FIRESTORE_ISCN_ARWEAVE_TX_ROOT = process.env.FIRESTORE_ISCN_ARWEAVE_TX_ROOT;
config.FIRESTORE_SUPERLIKE_USER_ROOT = process.env.FIRESTORE_SUPERLIKE_USER_ROOT;
config.FIRESTORE_LIKE_URL_ROOT = process.env.FIRESTORE_LIKE_URL_ROOT;
config.FIRESTORE_ISCN_LIKER_URL_ROOT = process.env.FIRESTORE_ISCN_LIKER_URL_ROOT;
config.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;

config.COSMOS_LCD_INDEXER_ENDPOINT = 'https://node.testnet.like.co';
config.COSMOS_LCD_ENDPOINT = 'https://node.testnet.like.co';
config.COSMOS_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';
config.COSMOS_CHAIN_ID = 'likecoin-public-testnet-5';
config.COSMOS_DENOM = 'nanoekil';
config.NFT_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';

config.LIKE_NFT_EVM_INDEXER_API = 'https://likenft-indexer.pandawork.com/api';
config.LIKE_NFT_EVM_INDEXER_API_KEY = '';

config.EVM_RPC_ENDPOINT_OVERRIDE = '';
config.EVM_BASE_FEE_MULTIPLIER = 3;

// Alchemy Gas Manager (sponsored gas for Magic Link users via EIP-7702).
// The webhook secret guards the custom-rules endpoint Alchemy POSTs to; it is
// embedded in the configured webhookUrl path (Alchemy sends no auth header).
config.ALCHEMY_GAS_POLICY_ID = process.env.ALCHEMY_GAS_POLICY_ID || '';
config.ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET = process.env.ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET || '';

config.LIKER_PLUS_TRIAL_CONVERSION_RATE = 0.5;
config.LIKER_PLUS_LTV = 100;
config.LIKER_PLUS_PRODUCT_ID = '';
config.LIKER_PLUS_20_COUPON_ID = '';
config.LIKER_PLUS_MONTHLY_PRICE_ID = '';
config.LIKER_PLUS_YEARLY_PRICE_ID = '';
config.LIKER_PLUS_GIFT_MONTHLY_PRICE_ID = '';
config.LIKER_PLUS_GIFT_YEARLY_PRICE_ID = '';
config.LIKER_PLUS_BOOK_PROMO_COUPON_CODE = '';

// RevenueCat (mobile IAP) — bridges App/Play Store Plus subscriptions.
config.REVENUECAT_WEBHOOK_AUTHORIZATION = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION || ''; // shared secret set in RC dashboard's webhook Authorization header
config.REVENUECAT_PLUS_ENTITLEMENT_ID = process.env.REVENUECAT_PLUS_ENTITLEMENT_ID || 'plus'; // RC entitlement identifier that grants Liker Plus
// Product-id lists stay raw comma-separated strings here; the consumer parses them.
config.REVENUECAT_PLUS_MONTHLY_PRODUCT_IDS = process.env.REVENUECAT_PLUS_MONTHLY_PRODUCT_IDS || ''; // comma-separated store product ids for the monthly period
config.REVENUECAT_PLUS_YEARLY_PRODUCT_IDS = process.env.REVENUECAT_PLUS_YEARLY_PRODUCT_IDS || ''; // comma-separated store product ids for the yearly period

config.ARWEAVE_EVM_TARGET_ADDRESS = '';
config.IPFS_ENDPOINT = 'https://ipfs.infura.io:5001/api/v0';
config.REPLICA_IPFS_ENDPOINTS = [];
config.ARWEAVE_LINK_INTERNAL_TOKEN = '';
config.ARWEAVE_SPONSORED_DAILY_UPLOAD_LIMIT = 10;
config.ARWEAVE_SPONSORED_DAILY_BYTES_LIMIT = 100 * 1024 * 1024; // 100MB
// Cloud KMS cryptoKey resource name used to wrap content keys at rest in
// Firestore. Empty = passthrough (dev/test store plaintext); prod sets this.
config.ARWEAVE_KEY_KMS_NAME = process.env.ARWEAVE_KEY_KMS_NAME || '';
// Optional pin for the Irys base-eth deposit address; asserted against /info. Empty
// falls back to the built-in per-network default in the signer.
config.ARWEAVE_IRYS_DEPOSIT_ADDRESS = process.env.ARWEAVE_IRYS_DEPOSIT_ADDRESS || '';
// Bearer secret for the admin/cron funding-reconcile endpoint.
config.ARWEAVE_RECONCILE_ADMIN_TOKEN = process.env.ARWEAVE_RECONCILE_ADMIN_TOKEN || '';
// Private CMEK-protected GCS bucket holding plaintext-at-rest protected ebooks
// (ADR 0001 Phase 3). Empty = ingest disabled.
config.EBOOK_PROTECTED_BUCKET = process.env.EBOOK_PROTECTED_BUCKET || '';

config.LIKER_NFT_TARGET_ADDRESS = '';

config.NFT_BOOK_LIKER_LAND_FEE_RATIO = 0.05;
config.NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO = 0.10;
config.NFT_BOOK_LIKER_LAND_COMMISSION_RATIO = 0.3;
config.NFT_BOOK_LIKER_LAND_ART_FEE_RATIO = 0.1;

config.NFT_BOOK_FREE_CLASS_IDS = [];

config.LIKER_NFT_FIAT_MIN_RATIO = 0.01;

config.LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES = [];

config.NFT_BOOK_LISTING_NOTIFICATION_WEBHOOK = '';
config.NFT_BOOK_SALES_NOTIFICATION_WEBHOOK = '';
config.NFT_BOOK_SALES_INVALID_CHANNEL_ID_NOTIFICATION_WEBHOOK = '';
config.NFT_BOOK_SALES_OUT_OF_STOCK_NOTIFICATION_WEBHOOK = '';
config.PLUS_SUBSCRIPTION_NOTIFICATION_WEBHOOK = '';
config.NFT_BOOK_LIKER_LAND_ART_STRIPE_WALLET = '';
config.SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD = 5;

config.AUTHCORE_PUBLIC_CERT_PATH = '';

config.JWT_PUBLIC_CERT_PATH = '';
config.JWT_PRIVATE_KEY_PATH = '';
config.ECDSA_JWT_PUBLIC_CERT_PATH = '';
config.ECDSA_JWT_PRIVATE_KEY_PATH = '';
config.PROVIDER_JWT_COMMON_SECRET = '';

config.STRIPE_KEY = 'sk_test_51J1ZQvJ8'; // random dummy key
config.STRIPE_WEBHOOK_SECRET = '';

config.FB_PIXEL_ID = '';
config.FB_ACCESS_TOKEN = '';

config.GA4_MEASUREMENT_ID = '';
config.GA4_API_SECRET = '';

config.POSTHOG_API_KEY = '';
config.POSTHOG_HOST = '';

config.INTERCOM_API_SECRET = '';
config.INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || '';

config.MATTERS_APP_ID = '';
config.MATTERS_APP_SECRET = '';

config.SENDGRID_API_KEY = '';

config.REGISTER_LIMIT_WINDOW = 3600000; // 1hour
config.REGISTER_LIMIT_COUNT = 0; // 0 = disable
config.NEW_USER_BONUS_COOLDOWN = 259200000; // 3 days

config.GCLOUD_PUBSUB_MAX_MESSAGES = 10;
config.GCLOUD_PUBSUB_MAX_WAIT = 1000;
config.GCLOUD_PUBSUB_ENABLE = false;
config.APP_SERVER = 'likecoin-api-public';

config.CMC_API_CACHE_S = 300;

config.LIKER_LAND_GET_WALLET_SECRET = '';

config.WNFT_BATCH_PURCHASE_LIMIT = 100;

config.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
config.AIRTABLE_BASE_ID = '';
config.AIRTABLE_AUTOMATION_TOKEN = process.env.AIRTABLE_AUTOMATION_TOKEN;

// Shared secret for the internal Plus reading-usage ingest endpoint, called
// server-to-server by the 3ook.com backend.
config.PLUS_READING_SERVICE_TOKEN = process.env.PLUS_READING_SERVICE_TOKEN;
// Guards the admin-triggered Plus reading revenue-share settle endpoint.
config.PLUS_SETTLE_ADMIN_TOKEN = process.env.PLUS_SETTLE_ADMIN_TOKEN;

config.SLACK_COMMAND_TOKEN = '';

config.USER_ALLOWED_CHANNEL_IDS = '';
config.USER_ALLOWED_USER_IDS = '';
config.WALLET_ALLOWED_USER_IDS = '';
config.WALLET_ALLOWED_CHANNEL_IDS = '';
config.TEAM_WALLET_TABLE = {};
config.BOOK_ADMIN_ALLOWED_CHANNEL_IDS = '';
config.BOOK_ADMIN_ALLOWED_USER_IDS = '';

config.MAGIC_SECRET_API_KEY = process.env.MAGIC_SECRET_API_KEY;

module.exports = config;
