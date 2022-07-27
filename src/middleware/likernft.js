import { ValidationError } from '../util/ValidationError';
import {
  getISCNIdByClassId, getCurrentClassIdByISCNId, getISCNPrefixDocName,
} from '../util/api/likernft';

export const fetchISCNIdAndClassId = async (req, res, next) => {
  try {
    let { iscn_id: iscnId, class_id: classId } = req.query;
    if (!iscnId && !classId) throw new ValidationError('MISSING_ISCN_OR_CLASS_ID');

    if (!iscnId) {
      iscnId = await getISCNIdByClassId(classId);
    }
    if (!classId) {
      classId = await getCurrentClassIdByISCNId(iscnId);
    }
    res.locals.iscnId = iscnId;
    res.locals.classId = classId;
    res.locals.iscnPrefix = getISCNPrefixDocName(iscnId);
    next();
  } catch (err) {
    next(err);
  }
};

export default fetchISCNIdAndClassId;
