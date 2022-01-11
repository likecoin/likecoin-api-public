export function checkFileValid(req, res, next) {
  if (!(req.files && req.files.length)) {
    res.status(400).send('MISSING_FILE');
    return;
  }
  const { files } = req;
  if (files.length > 1 && !files.find(f => f.fieldname === 'index.html')) {
    res.status(400).send('MISSING_INDEX_FILE');
    return;
  }
  next();
}

export function convertMulterFiles(files) {
  return files.map((f) => {
    const { mimetype, buffer } = f;
    return {
      key: f.fieldname,
      mimetype,
      buffer,
    };
  });
}

export default convertMulterFiles;
