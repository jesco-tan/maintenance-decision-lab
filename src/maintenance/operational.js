import { validateLives } from './data.js';

// One complete observed life per engine. Requests join a queue after leadTime;
// repairs occupy a bay for repairDuration periods, including the service start.
// Failures occur at end of cycle and join the repair queue for the next period.
export function simulateOperational(lives, policy, { failureCost=5, replacementCost=1, unusedLifeCostPerCycle=.01, slotsPerCycle=1, leadTime=0, repairDuration=1, failuresShareCapacity=false, startCycles={} }={}) {
  validateLives(lives);
  if (![slotsPerCycle,leadTime,repairDuration].every(Number.isInteger)||slotsPerCycle<1||leadTime<0||repairDuration<1) throw new Error('Invalid operational parameters');
  const horizon=Math.max(...lives.map(l=>(startCycles[l.id]??1)+l.rows.length-1));
  const active=new Set(lives.map(l=>l.id)); const pending=new Map(); const busy=[];const failureQueue=[];const outcomes=[];let busySlotPeriods=0;
  for(let period=1;period<=horizon;period++) {
    for(let i=busy.length-1;i>=0;i--)if(busy[i]<period)busy.splice(i,1);
    // Failure work has priority at the next service allocation, never retroactively.
    while(failureQueue.length && busy.length<slotsPerCycle){failureQueue.shift();busy.push(period+repairDuration-1);}
    const ready=[];
    for(const life of lives){
      const start=startCycles[life.id]??1;
      if(!active.has(life.id)||period<start)continue;
      const cycle=period-start+1;
      if(!pending.has(life.id)){
        const r=policy.request({engineId:life.id,cycle,period,history:life.rows.slice(0,cycle)});
        if(r.request)pending.set(life.id,{eligible:period+leadTime,priority:r.priority??0});
      }
      const job=pending.get(life.id);
      if(job&&job.eligible<=period)ready.push({life,cycle,...job});
    }
    ready.sort((a,b)=>b.priority-a.priority||a.life.id-b.life.id);
    for(const job of ready){
      if(busy.length>=slotsPerCycle)break;
      busy.push(period+repairDuration-1);active.delete(job.life.id);pending.delete(job.life.id);
      const unusedLife=job.life.rows.length-job.cycle;
      outcomes.push({engineId:job.life.id,outcome:'planned_replacement',period,cycle:job.cycle,unusedLife,cost:replacementCost+unusedLife*unusedLifeCostPerCycle});
    }
    busySlotPeriods+=busy.length;
    for(const life of lives){
      if(!active.has(life.id))continue;
      const start=startCycles[life.id]??1;const cycle=period-start+1;
      if(cycle===life.rows.length){
        active.delete(life.id);pending.delete(life.id);
        outcomes.push({engineId:life.id,outcome:'unexpected_failure',period,cycle,unusedLife:0,cost:failureCost});
        if(failuresShareCapacity)failureQueue.push(life.id);
      }
    }
  }
  if(outcomes.length!==lives.length)throw new Error('Incomplete operational replay');
  return {policy:policy.name,horizon,offeredSlotPeriods:horizon*slotsPerCycle,busySlotPeriods,utilization:busySlotPeriods/(horizon*slotsPerCycle),unfinishedFailureRepairs:failureQueue.length,outcomes,totalCost:outcomes.reduce((s,x)=>s+x.cost,0),failures:outcomes.filter(x=>x.outcome==='unexpected_failure').length};
}
