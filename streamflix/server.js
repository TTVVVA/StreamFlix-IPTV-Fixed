const path = require('path');
const { createStreamFlixApp } = require('./lib/streamflix-app');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = __dirname;
const app = createStreamFlixApp({ staticDir: path.join(ROOT_DIR) });

app.listen(PORT, () => {
  console.log(`StreamFlix server running on http://localhost:${PORT}`);
});
