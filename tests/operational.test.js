import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateOperational } from '../src/maintenance/operational.js';
const life=(id,n)=>({id,rows:Array.from({length:n},(_,i)=>({cycle:i+1,settings:[0,0,0],sensors:[i]}))});
const policy={name:'request',request:()=>({request:true,priority:1})};
test('lead time allows terminal failure before service',()=>{
 const r=simulateOperational([life(1,2)],policy,{leadTime:2});assert.equal(r.failures,1);
});
test('repair duration holds bays and common horizon includes idle periods',()=>{
 const r=simulateOperational([life(1,3),life(2,3)],policy,{repairDuration:3});assert.equal(r.failures,1);assert.equal(r.offeredSlotPeriods,3);assert.equal(r.busySlotPeriods,3);
});
test('failure repairs consume capacity from next allocation',()=>{
 const p={name:'later',request:({engineId,cycle})=>({request:engineId===2&&cycle>=2})};
 const r=simulateOperational([life(1,1),life(2,3)],p,{repairDuration:2,failuresShareCapacity:true});assert.equal(r.failures,2);
});
test('immediate one-period service and deterministic ID tie break',()=>{
 const r=simulateOperational([life(1,3),life(2,3)],policy);assert.equal(r.failures,0);assert.deepEqual(r.outcomes.map(x=>x.engineId),[1,2]);assert.equal(r.offeredSlotPeriods,3);
});
