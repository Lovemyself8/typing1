import {readFile} from 'node:fs/promises';
for(const f of ['public/index.html','public/app.js','public/style.css','public/game-core.js','netlify/functions/game.mjs'])await readFile(f);
console.log('Static files and function entry verified.');
