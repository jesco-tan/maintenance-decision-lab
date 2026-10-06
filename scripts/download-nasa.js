import { mkdir, writeFile } from 'node:fs/promises';

const api = 'https://data.nasa.gov/api/3/action/package_show?id=cmapss-jet-engine-simulated-data';
const response = await fetch(api);
if (!response.ok) throw new Error(`NASA metadata request failed: HTTP ${response.status}`);
const metadata = await response.json();
if (!metadata.success) throw new Error('NASA metadata response was unsuccessful');
const resource = metadata.result.resources.find(item => item.id === '5224bcd1-ad61-490b-93b9-2817288accb8');
if (!resource?.url) throw new Error('Expected ZIP resource not found');
const archive = await fetch(resource.url);
if (!archive.ok) throw new Error(`NASA ZIP request failed: HTTP ${archive.status}`);
const bytes = Buffer.from(await archive.arrayBuffer());
if (bytes.subarray(0, 2).toString() !== 'PK') throw new Error('Response is not a ZIP file');
await mkdir('data/raw', { recursive: true });
await writeFile('data/raw/CMAPSSData.zip', bytes);
console.log(`Saved ${bytes.length} bytes to data/raw/CMAPSSData.zip; inspect contents and terms before use.`);
