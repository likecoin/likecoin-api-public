const config = {};

config.COSMOS_LCD_ENDPOINT = 'https://node.testnet.like.co';
config.COSMOS_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';
config.COSMOS_SIGNING_RPC_ENDPOINT = 'https://node.testnet.like.co/rpc/';
config.ISCN_DEV_LCD_ENDPOINT = 'localhost:1317';
config.IPFS_ENDPOINT = 'http://like-co-ipfs:5001/api/v0';

config.LIKER_NFT_LIKE_TO_USD_CONVERT_RATIO = 1024;
config.LIKER_NFT_MIN_USD_PRICE = 0.5;
config.LIKER_NFT_STRIPE_FEE_USD_INTERCEPT = 0.3;
config.LIKER_NFT_STRIPE_FEE_USD_SLOPE = 0.054;

module.exports = config;
