import { LIKER_LAND_HOSTNAME } from '../constant';

export const getLikerLandURL = (path = '', { language = 'en' }: { language?: string } = {}) => `https://${LIKER_LAND_HOSTNAME}${language ? `/${language}` : ''}${path}`;

export const getLikerLandNFTClassPageURL = ({ classId, language }: { classId: string, language?: string }) => getLikerLandURL(`/nft/class/${classId}`, { language });
export const getLikerLandNFTCollectionPageURL = ({ collectionId, language }: { collectionId: string, language?: string }) => getLikerLandURL(`/nft/collection/${collectionId}`, { language });

export const getLikerLandNFTClaimPageURL = ({
  classId,
  collectionId,
  paymentId,
  free = false,
  token,
  type = '',
  language,
  redirect = false,
  priceIndex,
  from,
}: {
  classId?: string;
  collectionId?: string;
  paymentId: string;
  free?: boolean,
  token: string;
  type?: string;
  language?: string;
  redirect?: boolean;
  priceIndex?: number;
  from?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
    claiming_token: token,
  };

  if (classId) {
    qsPayload.class_id = classId;
  }

  if (collectionId) {
    qsPayload.collection_id = collectionId;
  }

  if (redirect) {
    qsPayload.redirect = '1';
  }
  if (type) {
    qsPayload.type = type;
  }
  if (free) {
    qsPayload.free = '1';
  }
  if (priceIndex !== undefined) {
    qsPayload.price_index = priceIndex;
  }
  if (from) {
    qsPayload.from = from;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/nft/claim?${qs}`, { language });
};

export const getLikerLandNFTGiftPageURL = ({
  classId,
  collectionId,
  paymentId,
  type = '',
  language,
  redirect = false,
  priceIndex,
  from,
}: {
  classId?: string;
  collectionId?: string;
  paymentId: string;
  type?: string;
  language?: string;
  redirect?: boolean;
  priceIndex?: number;
  from?: string;
}) => {
  const qsPayload: any = {
    payment_id: paymentId,
  };

  if (classId) {
    qsPayload.class_id = classId;
  }

  if (collectionId) {
    qsPayload.collection_id = collectionId;
  }

  if (redirect) {
    qsPayload.redirect = '1';
  }
  if (type) {
    qsPayload.type = type;
  }
  if (priceIndex !== undefined) {
    qsPayload.price_index = priceIndex;
  }
  if (from) {
    qsPayload.from = from;
  }
  const qs = Object.entries(qsPayload).map(([key, value]) => `${key}=${value}`).join('&');
  return getLikerLandURL(`/nft/gift?${qs}`, { language });
};

export const getLikerLandNFTFiatStripePurchasePageURL = ({
  classId,
  paymentId,
  wallet,
  token,
  language,
}: {
  classId: string;
  paymentId: string;
  wallet: string;
  token: string;
  language?: string;
}) => getLikerLandURL(`/nft/fiat/stripe?class_id=${classId}&payment_id=${paymentId}${wallet ? '' : `&claiming_token=${token}`}`, { language });
