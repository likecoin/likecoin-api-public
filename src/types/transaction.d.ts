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
  key?: string;
  [key: string]: any;
}
