export function getFirebaseProviderId(platform) {
  switch (platform) {
    case 'facebook':
    case 'github':
    case 'google':
    case 'twitter':
      return `${platform}.com`;
    default:
      throw new Error('Platform not exist');
  }
}

export function getFirebaseUserProviderUserInfo(firebaseUser, platform) {
  const providerId = getFirebaseProviderId(platform);
  return firebaseUser.providerData.find(p => (p.providerId === providerId));
}
