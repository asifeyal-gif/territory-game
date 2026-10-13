import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';

// A standard ZIP with index.html at its root; no additional npm dependency.
const html=await readFile('play.html');
const filename=Buffer.from('index.html');
const compressed=deflateRawSync(html,{level:9});
let crc=0xffffffff;
for(const byte of html){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
crc=(crc^0xffffffff)>>>0;
const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(html.length,22);local.writeUInt16LE(filename.length,26);
const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(html.length,24);central.writeUInt16LE(filename.length,28);
const directory=Buffer.concat([central,filename]);
const offset=local.length+filename.length+compressed.length;
const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await mkdir('releases',{recursive:true});
await writeFile('releases/territory-duel-web.zip',Buffer.concat([local,filename,compressed,directory,end]));
console.log(`Portal upload package: releases/territory-duel-web.zip (${Math.ceil(compressed.length/1024)} KiB), root index.html.`);
