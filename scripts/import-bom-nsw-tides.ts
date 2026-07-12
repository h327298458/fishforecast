import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyMigrations } from '../server/db/applyMigrations.js';
import { importBomNswTideFile } from '../server/providers/bomNswTide.js';

const root=resolve(process.argv[2]??'./data/raw/tides/bom-nsw');const manifest=JSON.parse(readFileSync(resolve(root,'downloads-manifest.json'),'utf8').replace(/^\uFEFF/,'')) as Array<{filename:string;sourceUrl:string;downloadedAtUtc:string;stationId:string}>;const db=new Database(process.env.DATABASE_PATH??'./data/tideline.db');applyMigrations(db);const results=[];
try{for(const record of manifest){const binary=readFileSync(resolve(root,record.filename));const document=await getDocument({data:new Uint8Array(binary)}).promise;const pages=[];for(let pageNumber=1;pageNumber<=document.numPages;pageNumber+=1){const page=await document.getPage(pageNumber),content=await page.getTextContent();pages.push(content.items.map(item=>'str' in item?item.str:'').join(' '));}results.push(importBomNswTideFile(db,{text:pages.join(' '),binary,filename:basename(record.filename),sourceUrl:record.sourceUrl,downloadedAtUtc:record.downloadedAtUtc,stationId:record.stationId}));}}finally{db.close();}
console.log(JSON.stringify(results,null,2));
