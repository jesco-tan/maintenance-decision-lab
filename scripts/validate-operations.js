import { readFile,writeFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadFd001 } from '../src/maintenance/data.js';
import { features } from '../src/maintenance/features.js';
import { fixedInterval,sensorThreshold,learnedRisk } from '../src/maintenance/policies.js';
import { simulateOperational } from '../src/maintenance/operational.js';
const report=JSON.parse(await readFile('outputs/report-fd001.json','utf8'));
const old=JSON.parse(execFileSync('git',['show','HEAD:outputs/report-fd001.json'],{encoding:'utf8',maxBuffer:32*1024*1024}));
const baseline=report.comparisons.find(x=>x.assumptions.slotsPerCycle===1&&x.assumptions.failureCost===5);
const prior=old.comparisons.find(x=>x.assumptions.slotsPerCycle===1&&x.assumptions.failureCost===5);
const reconciliation=baseline.results.map(x=>({policy:x.kind,current:x.totalCost,previous:prior.results.find(y=>y.kind===x.kind).totalCost}));
const all=await loadFd001('data/raw/train_FD001.txt');const held=all.filter(l=>report.engineIds.test.includes(l.id));
const sig=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const model={predict(history){
 // Predict from the published fitted weights, not new fitting data.
 const f=features(history);const m=report.model;
 const raw=sig(m.weights[0]+f.reduce((sum,v,i)=>sum+m.weights[i+1]*(v-m.means[i])/m.scales[i],0));
 const clipped=Math.max(1e-6,Math.min(1-1e-6,raw));return sig(m.calibration.slope*Math.log(clipped/(1-clipped))+m.calibration.intercept);
}};
const policies=baseline.results.filter(x=>x.kind!=='oracle').map(x=>{
 if(x.kind==='fixed')return fixedInterval(Number(x.policy.split('-')[1]));
 if(x.kind==='risk')return learnedRisk(model,Number(x.policy.split('-')[1]));
 const m=x.policy.match(/^sensor-(\d+)-(high|low)-(.+)$/);return sensorThreshold(Number(m[3]),Number(m[1]),m[2]==='high'?1:-1);
});
// Cache each frozen policy's per-engine/cycle response before scenario replay.
const cachedPolicies=policies.map(p=>{const entries=new Map(held.map(l=>[l.id,l.rows.map((_,i)=>p.request({engineId:l.id,cycle:i+1,period:i+1,history:l.rows.slice(0,i+1)}))]));return {name:p.name,request:({engineId,cycle})=>entries.get(engineId)[cycle-1]};});
const scenarios=[];
for(const leadTime of [0,3,7])for(const repairDuration of [1,3])for(const failuresShareCapacity of [false,true])for(const stagger of [0,60]){
 const startCycles=Object.fromEntries(held.map(l=>[l.id,stagger?1+((Math.imul(l.id,2654435761)+23)>>>0)%stagger:1]));
 const assumptions={...baseline.assumptions,leadTime,repairDuration,failuresShareCapacity,startCycles};
 const results=cachedPolicies.map(p=>simulateOperational(held,p,assumptions));
 scenarios.push({leadTime,repairDuration,failuresShareCapacity,stagger,results,winner:results.toSorted((a,b)=>a.totalCost-b.totalCost)[0].policy});
}
let state=20261103;const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};
const risk=baseline.results.find(x=>x.kind==='risk');const sensor=baseline.results.find(x=>x.kind==='sensor');
const differences=risk.outcomes.map(o=>o.cost-sensor.outcomes.find(s=>s.engineId===o.engineId).cost);
const boot=Array.from({length:10000},()=>Array.from({length:differences.length},()=>differences[Math.floor(rand()*differences.length)]).reduce((s,x)=>s+x,0)/differences.length).sort((a,b)=>a-b);
const output={status:'complete',reconciliation,allOriginalCostsMatch:reconciliation.every(x=>Math.abs(x.current-x.previous)<1e-8),
 uncertainty:{unit:'engine',seed:20261103,draws:10000,estimand:'paired mean per-engine cost difference, risk minus sensor, for fixed fitted policies and observed replay outcomes',mean:differences.reduce((s,x)=>s+x,0)/differences.length,percentile95:[boot[250],boot[9749]],limitation:'Resamples observed engine outcomes, not capacity-coupled fleet replays. Descriptive conditional uncertainty only; no coverage guarantee under capacity interference. Excludes refitting uncertainty.'},
 contract:'Persistent request queue; eligible after lead time, frozen request priority. Failures join shared repair queue next period if enabled. Repairs occupy bays including service period. Common horizon is latest natural failure across all engines and arrivals, identical across policies within a scenario. Repair work beyond horizon is censored. Frozen baseline policies are stress-tested, not retuned.',scenarios};
await writeFile('outputs/operational-validation.json',JSON.stringify(output,null,2)+'\n');
const refits=[];
for(const seed of [23,17,47]){
 const file=seed===23?'outputs/report-fd001.json':`outputs/report-fd001-seed${seed}.json`;
 const fitted=JSON.parse(await readFile(file,'utf8'));
 const comparison=fitted.comparisons.find(x=>x.assumptions.slotsPerCycle===1&&x.assumptions.failureCost===5);
 refits.push({seed,test_engine_ids:fitted.engineIds.test,costs:Object.fromEntries(comparison.results.map(x=>[x.kind,x.totalCost]))});
}
await writeFile('outputs/refit-sensitivity.json',JSON.stringify({scope:'Refit, recalibration and retuning on alternative partitions of the same finite engine pool, not independent-sample uncertainty.',results:refits},null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs={};for(const name of await readdir('src/maintenance'))if(name.endsWith('.js'))inputs['src/maintenance/'+name]=sha(await readFile('src/maintenance/'+name));
inputs['scripts/validate-operations.js']=sha(await readFile('scripts/validate-operations.js'));
for(const file of ['outputs/report-fd001.json','outputs/report-fd001-seed17.json','outputs/report-fd001-seed47.json'])inputs[file]=sha(await readFile(file));
await writeFile('outputs/operational-manifest.json',JSON.stringify({status:'complete',node:process.version,inputs,retrievalManifestSha256:sha(await readFile('outputs/retrieval-manifest.json')),outputSha256:sha(await readFile('outputs/operational-validation.json')),parameters:{bootstrapSeed:20261103,draws:10000,splitSeed:23},tolerance:'Original costs absolute 1e-8; deterministic replay outputs exact on recorded Node version.'},null,2)+'\n');
console.log(JSON.stringify({reconciliation,uncertainty:output.uncertainty,winners:[...new Set(scenarios.map(s=>s.winner))]},null,2));
