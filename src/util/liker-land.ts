import { LIKER_LAND_HOSTNAME } from '../constant';

export const getLikerLandURL = (path = '', { language = 'en' }: { language?: string } = {}) => `https://${LIKER_LAND_HOSTNAME}${language ? `/${language}` : ''}${path}`;

export const getLikerLandNFTClassPageURL = ({ classId, language }: { classId: string, language?: string }) => getLikerLandURL(`/nft/class/${classId}`, { language });

export const getLikerLandNFTClaimPageURL = ({
  classId,
  paymentId,
  free = false,
  token,
  type = '',
  language,
  redirect = false,
  priceIndex,
  from,
}: {
  classId: string;
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
    class_id: classId,
    payment_id: paymentId,
    claiming_token: token,
  };
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
