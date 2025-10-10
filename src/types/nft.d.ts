// NFT-related types

export interface LikeNFTISCNData {
  iscnId: string;
  classId: string;
  nextNewNFTId?: number;
  totalCount?: number;
  currentPrice?: number;
  basePrice?: number;
  soldCount?: number;
  classUri?: string;
  creatorWallet?: string;
  ownerWallet?: string;
  collectExpiryAt?: number;
  [key: string]: any;
}

export interface LikeNFTMetadata {
  image?: string;
  externalUrl?: string;
  description?: string;
  name?: string;
  backgroundColor?: string;
  animationUrl?: string;
  youtubeUrl?: string;
  iscnOwner?: string;
  iscnStakeholders?: any;
  iscnId?: string;
  iscnRecordTimestamp?: number;
  [key: string]: any;
}

export interface LikeNFTMetadataFiltered {
  image?: string;
  /* eslint-disable camelcase */
  external_url?: string;
  description?: string;
  name?: string;
  background_color?: string;
  animation_url?: string;
  youtube_url?: string;
  iscn_id?: string;
  iscn_owner?: string;
  iscn_record_timestamp?: number;
  iscn_stakeholders?: any;
  /* eslint-enable camelcase */
  [key: string]: any;
}

export interface FreeMintTxData {
  userId: string;
  classId?: string;
  txHash?: string;
  status?: string;
  ts?: number;
  [key: string]: any;
}
