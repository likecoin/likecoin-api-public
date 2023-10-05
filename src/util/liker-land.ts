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
}: {
  classId: string;
  paymentId: string;
  free?: boolean,
  token: string;
  type?: string;
  language?: string;
  redirect?: boolean;
  priceIndex?: number;
}) => getLikerLandURL(`/nft/claim?class_id=${classId}&payment_id=${paymentId}&claiming_token=${token}${redirect ? '&redirect=1' : ''}${type ? `&type=${type}` : ''}${free ? '&free=1' : ''}${priceIndex !== undefined ? `&price_index=${priceIndex}` : ''}`, { language });

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
