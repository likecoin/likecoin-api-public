import { getISCNQueryClient } from './iscn';

export async function getISCNFromNFTClassId(classId) {
  const client = await getISCNQueryClient();
  const res = await client.likenft.ISCNByClass(classId);
  if (!res) return null;
  const { iscnIdPrefix, owner } = res;
  return {
    iscnIdPrefix,
    owner,
  };
}

export default getISCNFromNFTClassId;
