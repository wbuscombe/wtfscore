// WTFScore - browser entry point. Mounts the score-first board; the logic
// lives in lib/board.mjs so the Node tests drive the same handlers.

import { mountBoard } from './lib/board.mjs';

mountBoard({ win: window, doc: document, root: document.getElementById('app') });
