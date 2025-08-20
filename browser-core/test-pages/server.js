import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Serve static files from the "public" directory
app.use(express.static(__dirname));
app.use('/dist', express.static(path.join(__dirname, "..", "dist")));

// // Optional: catch-all route for single-page apps
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public/index.html'));
// });

app.listen(port, () => {
  console.log(`Test page @ http://localhost:${port}/recorder-player/`);
  console.log(`Test page @ http://localhost:${port}/stylesheets/`);
});