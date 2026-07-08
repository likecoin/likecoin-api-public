// Transaction-related types

export interface TxData {
  from?: string;
  fromId?: string;
  to?: string;
  toId?: string;
  toIds?: string[];
  value?: string | number;
  amount?: string | number;
  status: string;
  type: string;
  remarks?: string;
  httpReferrer?: string;
  completeTs?: number;
  ts: number;
  txHash?: string;
  metadata?: any;
  updateToken?: string;
  cosmosWallet?: string;
  likeWallet?: string;
  chainId?: string;
  rawSignedTx?: string;
  nonce?: number;
  delegatorAddress?: string;
  [key: string]: any;
}

export interface ArweaveTxData {
  txHash?: string;
  iscnId?: string;
  status?: string;
  ts?: number;
  token?: string;
  ipfsHash?: string;
  fileSize?: number;
  ownerWallet?: string;
  timestamp?: any;
  lastUpdateTimestamp?: any;
  arweaveId?: string;
  isRequireAuth?: boolean;
  key?: string; // legacy plaintext content key; superseded by encryptedKey
  encryptedKey?: string; // base64 KMS-wrapped content key (AAD = txHash)
  fileSHA256?: string; // hex SHA-256 of the plaintext content (provenance anchor)
  contentBucketPath?: string; // object path in the protected GCS bucket once ingested
  accessToken?: string;
  isSponsored?: boolean;
  sponsoredETH?: string;
  // Irys funding lifecycle for this upload: the on-chain top-up tx and whether the
  // node credited it. `sent` = broadcast + persisted before notify; `credited` =
  // indexer acknowledged. Pending (`sent`) docs are replayed by the reconcile job.
  fundingTxHash?: string;
  fundingStatus?: 'sent' | 'credited';
  fundingETH?: string;
  fundingTimestamp?: any;
  [key: string]: any;
}
