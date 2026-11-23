// Punto de entrada (node src/start.js, o PM2)
import { start } from './index.js';

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
