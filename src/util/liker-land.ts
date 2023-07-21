import { LIKER_LAND_HOSTNAME } from '../constant';

export const getLikerLandURL = (path = '', { language = 'en' }: { language?: string } = {}) => `https://${LIKER_LAND_HOSTNAME}${language ? `/${language}` : ''}${path}`;

export const getLikerLandNFTClassPageURL = ({ classId, language }: { classId: string, language?: string }) => getLikerLandURL(`/nft/class/${classId}`, { language });

export const getLikerLandNFTPortfolioPageURL = ({ wallet, language }: { wallet: string, language?: string }) => getLikerLandURL(`/${wallet}`, { language });

export const getLikerLandNFTClaimPageURL = ({
  classId,
  paymentId,
  token,
  type = '',
  language,
  redirect = false,
}: {
  classId: string;
  paymentId: string;
  token: string;
  type?: string;
  language?: string;
  redirect?: boolean;
}) => getLikerLandURL(`/nft/claim?class_id=${classId}&payment_id=${paymentId}&claiming_token=${token}${redirect ? '&redirect=1' : ''}${type ? `&type=${type}` : ''}`, { language });

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

export const getLikerLandNFTSubscriptionSuccessPageURL = ({
  creatorWallet,
  language,
}: {
  creatorWallet: string;
  language?: string;
}) => getLikerLandURL(`/${creatorWallet}/subscription/success`, { language });
