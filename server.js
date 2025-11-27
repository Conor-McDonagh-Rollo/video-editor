const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuid } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const exportsDir = path.join(__dirname, 'exports');
const listFonts = () => {
  const fontsDir = path.join(__dirname, 'fonts');
  if (!fs.existsSync(fontsDir)) return [];
  return fs
    .readdirSync(fontsDir)
    .filter((f) => f.toLowerCase().endsWith('.ttf'))
    .map((file) => ({
      name: path.parse(file).name,
      path: `/fonts/${file}`,
      file: path.join(fontsDir, file),
    }));
};

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/exports', express.static(exportsDir));
app.get('/config.js', (_req, res) => {
  const config = {
    apiEndpoint: process.env.API_ENDPOINT || '',
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '',
  };
  res.type('application/javascript').send(`window.APP_CONFIG=${JSON.stringify(config)};`);
});
app.use('/fonts', express.static(path.join(__dirname, 'fonts')));
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/fonts', (_req, res) => {
  res.json(listFonts());
});

app.get('/api/exports/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    exportId: job.exportId,
    status: job.status,
    progress: job.progress,
    downloadUrl: job.downloadUrl,
    logUrl: job.logUrl,
    error: job.error,
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Video editor ready on http://localhost:${PORT}`);
});
