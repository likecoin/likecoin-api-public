export function getLinkOrderMap(socialCol) {
  const linkOrderMap = {};
  socialCol.docs.forEach((doc) => {
    if (doc.id === 'meta') {
      const { externalLinkOrder } = doc.data();
      if (externalLinkOrder) {
        externalLinkOrder.forEach((id, index) => {
          linkOrderMap[id] = index;
        });
      }
    }
  });
  return linkOrderMap;
}

export default getLinkOrderMap;
