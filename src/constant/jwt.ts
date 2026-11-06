export const PERMISSION_GROUPS = {
  likebutton: [
    'read:like.button',
    'write:like.button',
    'read:civic_liker',
    'write:iscn',
  ],
};

// Scopes /wallet/authorize may grant: the union of what 3ook.com and publish.3ook.com sign for.
// Anything else in the signed payload is dropped, so no caller can mint itself a privileged scope.
export const WALLET_AUTHORIZE_PERMISSIONS = [
  'profile',
  'email',
  'write',
  'read:nftbook',
  'write:nftbook',
  'read:iscn',
  'write:iscn',
  'read:plus',
  'write:plus',
  'read:preferences',
  'write:preferences',
  'read:profile',
  'write:profile',
];

export default PERMISSION_GROUPS;
